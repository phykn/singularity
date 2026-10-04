import { ArrowRight } from 'pixelarticons/react';
import type { Rarity, UpgradeId } from '../game/rules.ts';
import { skillChange } from './skillText.ts';
import { SkillPreview } from './SkillPreview.tsx';
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
  if (!choice) return null;
  const secondsLeft = Math.max(0, choice.deadline - game.time);
  const change = (id: UpgradeId, rarity: Rarity) =>
    skillChange(id, game.rank(id), rarity, game.rarities[id], language, rules);
  return (
    <section className="choices" aria-label={c.choices}>
      <div className="choice-header">
        <strong>{c.growth}</strong>
        <span aria-label={c.countdown(Math.ceil(secondsLeft))}>
          {c.auto} {Math.ceil(secondsLeft)}
          {c.seconds}
        </span>
      </div>
      <div className="cards">
        {choice.cards.map(({ id, rarity }, i) => (
          <button
            key={`${choice.number}-${id}`}
            className={`card ${i === 0 ? 'auto' : ''}`}
            data-rarity={rarity}
            aria-label={
              c.rarities[rarity] +
              ' ' +
              c.upgrades[id].name +
              ', ' +
              (game.rank(id) ? c.rankUp(game.rank(id), game.rank(id) + 1) : c.newSkill) +
              ', ' +
              change(id, rarity) +
              (i === 0 ? ', ' + c.auto : '')
            }
            onClick={() => {
              onSelect(id, choice.number);
            }}
            disabled={game.paused || game.phase !== 'running'}
          >
            <span className="card-label">
              <b>{c.rarities[rarity]}</b>
              {i === 0 && <ArrowRight width={12} height={12} aria-hidden="true" />}
            </span>
            <SkillPreview cfg={rules} id={id} rank={game.rank(id) + 1} rarity={rarity} />
            <strong>{c.upgrades[id].short}</strong>
            <span className="card-value">{change(id, rarity)}</span>
          </button>
        ))}
      </div>
      <div className="choice-track">
        <i style={{ width: (secondsLeft / rules.choiceSeconds) * 100 + '%' }} />
      </div>
    </section>
  );
}
