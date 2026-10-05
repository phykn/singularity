import { ArrowRight } from 'pixelarticons/react';
import { useEffect, useRef, useState } from 'react';
import type { Choice } from '../game/types.ts';
import type { Rarity, UpgradeId } from '../game/rules.ts';
import { isSkill } from '../game/rules.ts';
import { skillChange } from './skillText.ts';
import { SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import type { Game } from '../game/model.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function Choices({
  game,
  language,
  onSelect,
}: {
  game: Game;
  language: Language;
  onSelect: (id: UpgradeId, number: number) => void;
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
            <span aria-label={c.countdown(Math.ceil(secondsLeft))}>
              {c.auto} {Math.ceil(secondsLeft)}
              {c.seconds}
            </span>
          </div>
          <div className="cards">
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
                  {id === game.automaticCard?.id && (
                    <ArrowRight width={12} height={12} aria-hidden="true" />
                  )}
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
