import { isSkill, rarityIds, skillIds, statIds } from '../game/rules.ts';
import type { UpgradeId } from '../game/rules.ts';
import type { RuleSet } from '../game/rules.ts';
import { particleIds } from '../game/particles.ts';
import { particleNames, particleSymbols } from './i18n.ts';
import { ParticleIcon, SkillIcon } from './icons.tsx';
import { skillValue } from './skillText.ts';
import { Dialog } from './Dialog.tsx';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
export function Guide({
  rules,
  language,
  onClose,
}: {
  rules: RuleSet;
  language: Language;
  onClose: () => void;
}) {
  const c = copy[language];
  return (
    <Dialog titleId="guide-title" className="guide">
      <div className="dialog-title">
        <h2 id="guide-title">{c.guideTitle}</h2>
        <button className="text-button" onClick={onClose}>
          {c.close}
        </button>
      </div>
      <div className="dialog-body">
        <p>{c.guideEnergy}</p>
        <p>{c.guideGoal(rules.energyGoal)}</p>
        <p>{c.guideChoice}</p>
        <p>{c.guideRhythm}</p>
        <div className="rarity-guide">
          {rarityIds.map((rarity) => (
            <span key={rarity} data-rarity={rarity}>
              {c.rarities[rarity]}
              <b>{rules.rarity[rarity].chance}%</b>
            </span>
          ))}
        </div>
        <p>{c.guideRarity}</p>
        <p>{c.guideCombo}</p>
        <div className="particle-guide">
          {particleIds.map((id) => (
            <div key={id}>
              <ParticleIcon id={id} />
              <b>{particleSymbols[id]}</b>
              <span>{particleNames[language][id]}</span>
            </div>
          ))}
        </div>
        <div className="skill-guide">
          {([...statIds, 'recover', ...skillIds] as UpgradeId[]).map((id) => (
            <div key={id}>
              <details>
                <summary>
                  <SkillIcon id={id} />
                  <strong>{c.upgrades[id].name}</strong>
                </summary>
                <div className="guide-skill-body">
                  <p>{c.upgrades[id].description}</p>
                  <span className="guide-rarity">{c.rarities.common}</span>
                  <span>
                    {Array.from(
                      { length: id === 'recover' ? 1 : rules.maxRank },
                      (_, i) => i + 1,
                    ).map((rank) => (
                      <span className="guide-rank" key={rank}>
                        {id === 'recover' ? c.instant : rank} ·{' '}
                        {skillValue(id, rank, 'common', language, rules)}
                      </span>
                    ))}
                  </span>
                  {!isSkill(id) && id !== 'recover' && <p className="muted">{c.unlimited}</p>}
                </div>
              </details>
            </div>
          ))}
        </div>
        <p className="muted">{c.guideLimits}</p>
      </div>
    </Dialog>
  );
}
