import { isPact, isSkill, isStat, rarityIds } from '../game/rules.ts';
import type { RuleSet } from '../game/rules.ts';
import { particleIds } from '../game/particles.ts';
import { particleNames, particleSymbols } from './i18n.ts';
import { ParticleIcon, SkillIcon } from './icons.tsx';
import { iconIds } from '../art/skills.ts';
import { pactText, skillValue } from './skillText.ts';
import { Dialog } from './Dialog.tsx';
import { copy } from './i18n.ts';
import { formatTime, numberText } from '../format.ts';
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
        <p>{c.guideGoal(formatTime(rules.boss.final.time))}</p>
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
        <p>
          {c.guideLate(
            rules.boss.stages.map((stage) => formatTime(stage.time)),
            formatTime(rules.critical.time),
          )}
        </p>
        <p>
          {c.guideEvolve(
            numberText(rules.evolution.chance * 100),
            numberText(rules.evolution.maxChance * 100),
            rules.pacts.max,
          )}
        </p>
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
          {iconIds.map((id) => (
            <div key={id}>
              <details>
                <summary>
                  <SkillIcon id={id} />
                  <strong>{c.upgrades[id].name}</strong>
                </summary>
                <div className="guide-skill-body">
                  <p>{c.upgrades[id].description}</p>
                  {isPact(id) ? (
                    <span className="guide-rank">
                      {pactText(id, language, rules).gain} · {pactText(id, language, rules).cost}
                    </span>
                  ) : (
                    <>
                      {!isStat(id) && <span className="guide-rarity">{c.rarities.common}</span>}
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
                    </>
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
        <p className="muted">{c.guideLimits(rules.skillSlots, rules.boss.slotKills[0])}</p>
      </div>
    </Dialog>
  );
}
