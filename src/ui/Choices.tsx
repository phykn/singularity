import { useEffect, useRef, useState } from 'react';
import type { Choice } from '../game/types.ts';
import type { Rarity, UpgradeId } from '../game/rules.ts';
import { isSkill } from '../game/rules.ts';
import { skillChange } from './skillText.ts';
import { SkillIcon, ControlIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function Choices({
  game,
  language,
  onSelect,
  pauseOnChoice,
  onTogglePause,
}: {
  game: Game;
  language: Language;
  onSelect: (id: UpgradeId, number: number) => void;
  pauseOnChoice: boolean;
  onTogglePause: () => void;
}) {
  const c = copy[language],
    rules = game.rules,
    choice = game.choice;
  const change = (id: UpgradeId, rarity: Rarity) =>
    skillChange(id, game.rank(id), rarity, game.rarities[id], language, rules, game.mass);
  const previous = useRef<{ choice: Choice; values: string[]; stages: number[] } | null>(null);
  const [receipt, setReceipt] = useState<{
    choice: Choice;
    values: string[];
    stages: number[];
    selected: UpgradeId;
  } | null>(null);
  const selection = game.selections.at(-1);
  const cards = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!choice || game.paused) return;
    (
      cards.current?.querySelector<HTMLButtonElement>('button.auto') ??
      cards.current?.querySelector<HTMLButtonElement>('button')
    )?.focus({ preventScroll: true });
  }, [choice?.number, game, game.paused]);
  useEffect(() => {
    const old = previous.current;
    if (
      old &&
      old.choice.number === game.selections.length &&
      selection &&
      game.time - selection.time < 0.4
    ) {
      setReceipt({ ...old, selected: selection.id });
    }
    previous.current = choice
      ? {
          choice,
          values: choice.cards.map((card) => change(card.id, card.rarity)),
          stages: choice.cards.map((card) => game.rank(card.id)),
        }
      : null;
  }, [choice?.number, game, game.selections.length]);
  useEffect(() => {
    if (!receipt) return;
    const timer = window.setTimeout(() => setReceipt(null), 240);
    return () => clearTimeout(timer);
  }, [receipt]);
  if (game.phase !== 'running' || (!choice && !receipt)) return null;
  const secondsLeft = choice ? Math.max(0, choice.deadline - game.time) : 0;
  return (
    <>
      {choice && (
        <section className="choices" aria-label={c.choices}>
          <div className="choice-header">
            <strong>{c.growth}</strong>
            <div className="choice-actions">
              <span
                aria-label={pauseOnChoice ? c.choicePause : c.countdown(Math.ceil(secondsLeft))}
              >
                {!pauseOnChoice && c.auto + ' '}
                {Math.ceil(secondsLeft)}
                {c.seconds}
              </span>
              <button
                className="choice-pause"
                role="switch"
                aria-checked={pauseOnChoice}
                aria-label={c.choicePause}
                onClick={onTogglePause}
                disabled={game.paused}
              >
                <span className="choice-switch" aria-hidden="true">
                  <span>
                    <ControlIcon id={pauseOnChoice ? 'pause' : 'play'} />
                  </span>
                </span>
              </button>
            </div>
          </div>
          <div
            className="cards"
            ref={cards}
            onKeyDown={(event) => {
              if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                return;
              }
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              if (!buttons.length) return;
              const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (idx + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                      buttons.length;
              event.preventDefault();
              buttons[next].focus({ preventScroll: true });
            }}
          >
            {choice.cards.map(({ id, rarity }) => (
              <button
                key={`${choice.number}-${id}`}
                className={`card ${id === game.automaticCard?.id ? 'auto' : ''}`}
                data-rarity={rarity}
                data-upgrade={id}
                aria-label={
                  c.rarities[rarity] +
                  ' ' +
                  c.upgrades[id].name +
                  ', ' +
                  (id === 'recover'
                    ? c.instant
                    : game.rank(id) || !isSkill(id)
                      ? c.rankUp(game.rank(id), game.rank(id) + 1)
                      : c.newSkill) +
                  ', ' +
                  change(id, rarity) +
                  (id === game.automaticCard?.id ? ', ' + c.auto : '')
                }
                onClick={() => {
                  onSelect(id, choice.number);
                }}
                disabled={game.paused || game.phase !== 'running'}
              >
                <span className="card-label">
                  <b>{c.rarities[rarity]}</b>
                  {id === game.automaticCard?.id && <ControlIcon id="next" size={12} />}
                </span>
                <span className="card-icon">
                  <SkillIcon id={id} size={32} />
                </span>
                <strong>{c.upgrades[id].short}</strong>
                <CardStage id={id} rank={game.rank(id)} max={rules.maxRank} />
                <span className="card-value">{change(id, rarity)}</span>
              </button>
            ))}
          </div>
          <div className="choice-track">
            <i style={{ width: (secondsLeft / rules.choiceSeconds) * 100 + '%' }} />
          </div>
        </section>
      )}
      {receipt && (
        <section className="choices choice-receipt" aria-hidden="true" key={receipt.choice.number}>
          <div className="choice-header">
            <strong>{c.growth}</strong>
          </div>
          <div className="cards">
            {receipt.choice.cards.map(({ id, rarity }, i) => (
              <div
                className="choice-echo"
                data-selected={id === receipt.selected}
                data-rarity={rarity}
                data-upgrade={id}
                key={id}
              >
                <span className="card-label">
                  <b>{c.rarities[rarity]}</b>
                </span>
                <span className="card-icon">
                  <SkillIcon id={id} size={32} />
                </span>
                <strong>{c.upgrades[id].short}</strong>
                <CardStage id={id} rank={receipt.stages[i]} max={rules.maxRank} />
                <span className="card-value">{receipt.values[i]}</span>
              </div>
            ))}
          </div>
          <div className="choice-track" />
        </section>
      )}
    </>
  );
}

function CardStage({ id, rank, max }: { id: UpgradeId; rank: number; max: number }) {
  return (
    <span className="card-stage" aria-hidden="true">
      {isSkill(id) ? (
        <Rank value={rank} max={max} next={rank + 1} />
      ) : id !== 'recover' ? (
        `${rank}→${rank + 1}`
      ) : null}
    </span>
  );
}
