import type { CSSProperties } from 'react';
import { skillColor } from '../art/palette.ts';
import type { Game } from '../game/Game.ts';
import type { SkillId } from '../game/rules.ts';
import { Rank, SkillIcon } from './icons.tsx';
import { currentSkillValue } from './skillText.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

// Level, XP and the owned skills; a slot flashes when its skill fires and opens its details.
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
    max = game.rules.growth.maxRank,
    open = game.skillSlots,
    slots = game.rules.growth.skillSlots + game.rules.growth.slotKills.length,
    owned = game.ownedSkills,
    { current, required } = game.levelProgress;
  return (
    <div className="play-footer">
      <div className="xp-status">
        <div>
          <span className="level">
            Lv. <b>{String(game.level).padStart(2, '0')}</b>
          </span>
          <b>{`${current} / ${required}`}</b>
        </div>
        <div
          className="xp-track"
          role="progressbar"
          aria-label={c.xp}
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={required}
        >
          <i style={{ width: Math.min(100, (current / required) * 100) + '%' }} />
        </div>
      </div>
      <div className="loadout" aria-label={c.loadout} style={{ '--slots': slots } as CSSProperties}>
        {Array.from({ length: slots }, (_, i) => {
          const id = owned[i];
          if (!id)
            return (
              <div className="slot-cell" key={i}>
                <div
                  className={`slot empty ${i >= open ? 'locked' : ''}`}
                  role="img"
                  aria-label={i >= open ? c.locked : c.empty}
                >
                  <i />
                </div>
              </div>
            );
          const status = game.combat.status(id),
            filling = status.mode !== 'conditional',
            evolved = !!game.evolved[id];
          return (
            <div className="slot-cell" key={id}>
              <div
                className="slot"
                data-skill={id}
                data-mode={status.mode}
                data-active={status.active}
                data-fired={status.fired}
                data-rarity={game.rarities[id]}
                data-evolved={evolved}
                style={{ '--skill': skillColor(id) } as CSSProperties}
                role={filling ? 'progressbar' : 'img'}
                aria-valuemin={filling ? 0 : undefined}
                aria-valuemax={filling ? 100 : undefined}
                aria-valuenow={filling ? Math.floor(status.progress * 100) : undefined}
                aria-label={`${c.rarities[game.rarities[id] ?? 'common']} ${evolved ? c.evolutions[id].name : c.upgrades[id].name}, ${c.rank} ${game.rank(id)}/${max}${evolved ? ', ' + c.evolve : ''}`}
                title={`${c.upgrades[id].name} · ${currentSkillValue(game, id, c)}`}
              >
                {filling && (
                  <i
                    className="slot-fill"
                    style={{ height: (Math.floor(status.progress * 24) * 100) / 24 + '%' }}
                  />
                )}
                <span className="slot-art">
                  <SkillIcon id={id} size={32} evolved={evolved} />
                </span>
                {game.rank(id) >= max ? (
                  <span className="slot-max" aria-hidden="true">
                    {evolved ? 'EVO' : 'MAX'}
                  </span>
                ) : (
                  <Rank value={game.rank(id)} max={max} />
                )}
              </div>
              <button
                className="slot-inspect"
                aria-label={`${c.upgrades[id].name} · ${c.skillDetails}`}
                aria-haspopup="dialog"
                onClick={() => onInspect(id)}
                disabled={game.phase !== 'running'}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
