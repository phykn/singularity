import { iconIds } from '../art/skills.ts';
import { particleIds } from '../game/rules.ts';
import type { ParticleKind } from '../game/rules.ts';
import { isPact, isSkill, isStat, rarityIds } from '../game/rules.ts';
import type { Rules } from '../game/rules.ts';
import { Dialog } from './Dialog.tsx';
import { formatTime } from './format.ts';
import { ParticleIcon, SkillIcon } from './icons.tsx';
import { numberText, pactText, skillValue } from './skillText.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

const symbols: Record<ParticleKind, string> = {
  quark: 'q',
  proton: 'p',
  muon: 'μ',
  neutron: 'n',
  neutrino: 'ν',
  meson: 'π',
};

// Controls, the event clock, the beat, rarities, particles and every upgrade by rank.
export function Guide({
  rules,
  language,
  onClose,
}: {
  rules: Rules;
  language: Language;
  onClose: () => void;
}) {
  const c = copy[language],
    g = rules.growth;
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
        <p>{c.guideGoal(formatTime(rules.higgs.time))}</p>
        <p>{c.guideChoice}</p>
        <p>{c.guideRhythm}</p>
        <div className="rarity-guide">
          {rarityIds.map((rarity) => (
            <span key={rarity} data-rarity={rarity}>
              {c.rarities[rarity]}
              <b>{g.rarity[rarity].chance}%</b>
            </span>
          ))}
        </div>
        <p>{c.guideRarity}</p>
        <p>{c.guideCombo}</p>
        <p>
          {c.guideLate(
            rules.bosses.map((boss) => formatTime(boss.time)),
            formatTime(rules.critical.time),
          )}
        </p>
        <p>
          {c.guideEvolve(
            numberText(g.evolution.chance * 100),
            numberText(g.evolution.maxChance * 100),
            g.pacts.max,
          )}
        </p>
        <div className="particle-guide">
          {particleIds.map((id) => (
            <div key={id}>
              <ParticleIcon id={id} />
              <b>{symbols[id]}</b>
              <span>{c.particles[id]}</span>
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
                      {pactText(id, c, rules.pacts).gain} · {pactText(id, c, rules.pacts).cost}
                    </span>
                  ) : (
                    <>
                      {!isStat(id) && <span className="guide-rarity">{c.rarities.common}</span>}
                      <span>
                        {Array.from(
                          { length: id === 'recover' ? 1 : g.maxRank },
                          (_, i) => i + 1,
                        ).map((rank) => (
                          <span className="guide-rank" key={rank}>
                            {id === 'recover' ? c.instant : rank} ·{' '}
                            {skillValue(id, rank, 'common', c, rules)}
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
        <p className="muted">{c.guideLimits(g.skillSlots, g.slotKills[0])}</p>
      </div>
    </Dialog>
  );
}
