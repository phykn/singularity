import type { Game } from '../game/Game.ts';
import type { SkillId } from '../game/rules.ts';
import { Dialog } from './Dialog.tsx';
import { SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
import { skillValue } from './skillText.ts';

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
    rarity = game.rarities[id];
  return (
    <Dialog titleId="skill-title" className="skill-details">
      <div className="dialog-title" data-rarity={rarity}>
        <SkillIcon id={id} size={32} />
        <div>
          <h2 id="skill-title">{c.upgrades[id].name}</h2>
          <span className="skill-rarity">{c.rarities[rarity]}</span>
          <span role="img" aria-label={`${c.rank} ${rank}/${game.rules.maxRank}`}>
            <Rank value={rank} max={game.rules.maxRank} />
          </span>
        </div>
      </div>
      <div className="dialog-body">
        <p>{c.upgrades[id].description}</p>
        <p className="skill-value">
          {skillValue(id, rank, rarity, language, game.rules, game.reach, game.forms)}
        </p>
      </div>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          {c.close}
        </button>
      </div>
    </Dialog>
  );
}
