import type { SkillId, UpgradeId } from '../game/rules.ts';
import type { SkillStatus } from '../game/types.ts';
import { SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import { skillValue } from './skillText.ts';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
import type { CSSProperties } from 'react';
import { skillColor } from '../art/palette.ts';

export function Loadout({
  game,
  language,
  onInspect,
}: {
  game: Game;
  language: Language;
  onInspect: (id: SkillId) => void;
}) {
  const c = copy[language],
    rules = game.rules,
    owned = game.ownedSkills,
    slots = rules.skillSlots + rules.boss.slotKills.length;
  const progress = game.levelProgress;
  const xpPercent = progress.required
    ? Math.min(100, (progress.current / progress.required) * 100)
    : 100;
  const value = (id: UpgradeId, rank = game.rank(id)) =>
    skillValue(id, rank, game.rarities[id], language, rules, game.reach, game.forms);
  return (
    <div className="play-footer">
      <div className="xp-status">
        <div>
          <span className="level">
            Lv. <b>{game.level.toString().padStart(2, '0')}</b>
          </span>
          <b>{progress.current + ' / ' + progress.required}</b>
        </div>
        <div
          className="xp-track"
          role="progressbar"
          aria-label={c.xp}
          aria-valuenow={progress.current}
          aria-valuemin={0}
          aria-valuemax={progress.required}
        >
          <i style={{ width: xpPercent + '%' }} />
        </div>
      </div>
      <div className="loadout" aria-label={c.loadout} style={{ '--slots': slots } as CSSProperties}>
        {Array.from({ length: slots }, (_, i) => {
          const id = owned[i];
          const status = id ? game.combat.status(id) : null;
          const locked = i >= game.skillSlots;
          return (
            <div className="slot-cell" key={id ? id + game.rank(id) : i}>
              <div
                className={`slot ${id ? '' : 'empty'} ${locked ? 'locked' : ''}`}
                data-skill={id}
                style={id ? ({ '--skill': skillColor(id) } as CSSProperties) : undefined}
                data-mode={status?.mode}
                data-active={status?.active}
                data-fired={status?.fired}
                data-acquired={game.notice === id && game.time < game.noticeUntil}
                data-new={id && game.rank(id) === 1}
                data-rarity={id ? game.rarities[id] : undefined}
                data-evolved={id ? !!game.evolved[id] : undefined}
                role={status && status.mode !== 'conditional' ? 'progressbar' : 'img'}
                aria-valuemin={status && status.mode !== 'conditional' ? 0 : undefined}
                aria-valuemax={status && status.mode !== 'conditional' ? 100 : undefined}
                aria-valuenow={
                  status && status.mode !== 'conditional'
                    ? Math.floor(status.progress * 100)
                    : undefined
                }
                aria-label={
                  id
                    ? c.rarities[game.rarities[id]] +
                      ' ' +
                      c.upgrades[id].name +
                      ', ' +
                      c.rank +
                      ' ' +
                      game.rank(id) +
                      '/' +
                      rules.maxRank +
                      (game.evolved[id] ? ', ' + c.evolve : '')
                    : locked
                      ? c.locked
                      : c.empty
                }
                title={id ? c.upgrades[id].name + ' · ' + value(id) : undefined}
              >
                {id && status ? (
                  <SkillSlot
                    id={id}
                    status={status}
                    rank={game.rank(id)}
                    max={rules.maxRank}
                    evolved={!!game.evolved[id]}
                  />
                ) : (
                  <i />
                )}
              </div>
              {id && (
                <button
                  className="slot-inspect"
                  aria-label={c.upgrades[id].name + ' · ' + c.skillDetails}
                  aria-haspopup="dialog"
                  onClick={() => onInspect(id)}
                  disabled={game.phase !== 'running'}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkillSlot({
  id,
  status,
  rank,
  max,
  evolved,
}: {
  id: SkillId;
  status: SkillStatus;
  rank: number;
  max: number;
  evolved: boolean;
}) {
  return (
    <>
      {status.mode !== 'conditional' && (
        <i
          className="slot-fill"
          style={{ height: (Math.floor(status.progress * 24) * 100) / 24 + '%' }}
        />
      )}
      <span className="slot-art">
        <SkillIcon id={id} size={32} evolved={evolved} />
      </span>
      {rank >= max ? (
        <span className="slot-max" aria-hidden="true">
          {evolved ? 'EVO' : 'MAX'}
        </span>
      ) : (
        <Rank value={rank} max={max} />
      )}
    </>
  );
}
