import type { Game } from '../game/Game.ts';
import type { SkillId } from '../game/rules.ts';
import { Dialog } from './Dialog.tsx';
import { Rank, SkillIcon } from './icons.tsx';
import { currentSkillValue } from './skillText.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

// An owned skill as it stands: rarity, rank, evolution and current values.
export function SkillDetails({
  game,
  id,
  language,
  onClose,
}: {
  game: Game;
  id: SkillId;
  language: Language;
  onClose: () => void;
}) {
  const c = copy[language],
    rank = game.rank(id),
    rarity = game.rarities[id] ?? 'common',
    max = game.rules.growth.maxRank,
    evolved = !!game.evolved[id];
  return (
    <Dialog titleId="skill-title" className="skill-details">
      <div className="dialog-title" data-rarity={rarity}>
        <SkillIcon id={id} size={32} evolved={evolved} />
        <div>
          <h2 id="skill-title">{c.upgrades[id].name}</h2>
          <span className="skill-rarity">{c.rarities[rarity]}</span>
          <span role="img" aria-label={`${c.rank} ${rank}/${max}`}>
            <Rank value={rank} max={max} />
          </span>
        </div>
      </div>
      <div className="dialog-body">
        <p>{c.upgrades[id].description}</p>
        {evolved && (
          <p className="skill-evolved">
            {c.evolutions[id].name} · {c.evolutions[id].description}
          </p>
        )}
        <p className="skill-value">{currentSkillValue(game, id, c)}</p>
      </div>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          {c.close}
        </button>
      </div>
    </Dialog>
  );
}
