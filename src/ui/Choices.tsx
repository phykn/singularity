import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Choice } from '../game/types.ts';
import type { Card, RuleSet, UpgradeId } from '../game/rules.ts';
import { isPact, isSkill, isStat } from '../game/rules.ts';
import { pactText, skillChange, skillLinks } from './skillText.ts';
import { SkillIcon, ControlIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
import { useChoiceInput } from './useChoiceInput.ts';

type Links = ReturnType<typeof skillLinks>;
// What a choice showed, kept so its cards can linger for a moment after the pick.
type Shown = { choice: Choice; values: string[]; stages: number[]; links: Links[] };

export function Choices({
  game,
  language,
  onSelect,
  pauseOnChoice,
  onTogglePause,
  interactive,
}: {
  game: Game;
  language: Language;
  onSelect: (id: UpgradeId, number: number) => void;
  pauseOnChoice: boolean;
  onTogglePause: () => void;
  interactive: boolean;
}) {
  const c = copy[language],
    rules = game.rules,
    choice = game.choice,
    automatic = game.automaticCard?.id;
  const change = ({ id, rarity, evolve }: Card) =>
    evolve && isSkill(id)
      ? c.evolutions[id].summary
      : isPact(id)
        ? pactText(id, language, rules).gain
        : skillChange(id, game.rank(id), rarity, game.rarities[id], language, rules, game.mass);
  const title = ({ id, evolve }: Card) =>
    evolve && isSkill(id) ? c.evolutions[id].name : c.upgrades[id].short;
  const tag = ({ id, rarity, evolve }: Card) =>
    evolve ? c.evolve : isPact(id) ? c.pact : isStat(id) ? '' : c.rarities[rarity];
  const label = (card: Card) => {
    const { id, evolve } = card;
    const rank = game.rank(id);
    return [
      (tag(card) && tag(card) + ' ') + title(card),
      ...(id === 'recover'
        ? [c.instant]
        : evolve || isPact(id)
          ? []
          : [rank || !isSkill(id) ? c.rankUp(rank, rank + 1) : c.newSkill]),
      change(card),
      ...(isPact(id) ? [pactText(id, language, rules).cost] : []),
      ...skillLinks(id, game.ownedSkills).map(
        (link) => `${c.link}: ${c.upgrades[link.skill].name} ${c.links[link.effect]}`,
      ),
      ...(id === automatic ? [c.auto] : []),
    ].join(', ');
  };
  // The face a card shows, live or lingering after the pick.
  const face = (card: Card, value: string, rank: number, links: Links, auto = false) => {
    const { id, evolve } = card;
    return (
      <>
        <span className="card-label">
          {tag(card) && <b>{tag(card)}</b>}
          {auto && <ControlIcon id="next" size={12} />}
        </span>
        <span className="card-icon">
          <SkillIcon id={id} size={32} evolved={evolve} />
          {isSkill(id) && !evolve && <Rank value={rank} max={rules.maxRank} next={rank + 1} />}
        </span>
        <strong>{title(card)}</strong>
        <span className="card-value">{value}</span>
        <CardFoot
          id={id}
          evolve={evolve}
          rank={rank}
          links={links}
          language={language}
          rules={rules}
        />
      </>
    );
  };
  const previous = useRef<Shown | null>(null);
  const [receipt, setReceipt] = useState<(Shown & { selected: UpgradeId }) | null>(null);
  const selection = game.selections.at(-1);
  const { cards, pointerReady, accept, navigate } = useChoiceInput(choice, interactive);
  useLayoutEffect(() => {
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
          values: choice.cards.map(change),
          stages: choice.cards.map((card) => game.rank(card.id)),
          links: choice.cards.map((card) => skillLinks(card.id, game.ownedSkills)),
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
                disabled={!interactive}
              >
                <span className="choice-switch" aria-hidden="true">
                  <span>
                    <ControlIcon id={pauseOnChoice ? 'pause' : 'play'} />
                  </span>
                </span>
              </button>
            </div>
          </div>
          <div className="cards" data-ready={pointerReady} ref={cards} onKeyDown={navigate}>
            {choice.cards.map((card) => {
              const { id, rarity, evolve } = card;
              return (
                <button
                  key={`${choice.number}-${id}`}
                  className={`card ${id === automatic ? 'auto' : ''}`}
                  data-rarity={rarity}
                  data-upgrade={id}
                  data-evolve={!!evolve}
                  data-pact={isPact(id)}
                  aria-label={label(card)}
                  onClick={(event) => {
                    if (accept(event)) onSelect(id, choice.number);
                  }}
                  disabled={!interactive || !game.canUpgrade(id)}
                >
                  {face(
                    card,
                    change(card),
                    game.rank(id),
                    skillLinks(id, game.ownedSkills),
                    id === automatic,
                  )}
                </button>
              );
            })}
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
            {receipt.choice.cards.map((card, i) => {
              const { id, rarity, evolve } = card;
              return (
                <div
                  className="choice-echo"
                  data-selected={id === receipt.selected}
                  data-rarity={rarity}
                  data-upgrade={id}
                  data-evolve={!!evolve}
                  data-pact={isPact(id)}
                  key={id}
                >
                  {face(card, receipt.values[i], receipt.stages[i], receipt.links[i])}
                </div>
              );
            })}
          </div>
          <div className="choice-track" />
        </section>
      )}
    </>
  );
}

function CardFoot({
  id,
  evolve,
  rank,
  links,
  language,
  rules,
}: {
  id: UpgradeId;
  evolve?: boolean;
  rank: number;
  links: Links;
  language: Language;
  rules: RuleSet;
}) {
  const c = copy[language];
  if (evolve) return <span className="card-foot" aria-hidden="true" />;
  if (isPact(id))
    return (
      <span className="card-foot pact-cost" aria-hidden="true">
        {pactText(id, language, rules).cost}
      </span>
    );
  return (
    <span className="card-foot" aria-hidden="true">
      {isSkill(id)
        ? links.length > 0 && (
            <>
              {links.map((link) => (
                <SkillIcon key={link.skill} id={link.skill} size={16} />
              ))}
              <span>{links.length === 1 ? c.links[links[0].effect] : c.link}</span>
            </>
          )
        : id !== 'recover'
          ? `${rank}→${rank + 1}`
          : null}
    </span>
  );
}
