import type { CSSProperties } from 'react';
import { skillColor } from '../art/palette.ts';
import type { Game } from '../game/Game.ts';
import { Rank, SkillIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

// Level, XP and the owned skills; a slot flashes when its skill fires.
export function Loadout({ game, language }: { game: Game; language: Language }) {
  const c = copy[language],
    max = game.rules.growth.maxRank,
    slots = game.skillSlots,
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
                <div className="slot empty" role="img" aria-label={c.empty}>
                  <i />
                </div>
              </div>
            );
          const fired = game.time - (game.combat.fired[id] ?? -Infinity) < 0.15;
          return (
            <div className="slot-cell" key={id}>
              <div
                className="slot"
                data-skill={id}
                data-fired={fired}
                data-rarity={game.rarities[id]}
                style={{ '--skill': skillColor(id) } as CSSProperties}
                role="img"
                aria-label={`${c.rarities[game.rarities[id] ?? 'common']} ${c.upgrades[id].name}, ${c.rank} ${game.rank(id)}/${max}`}
              >
                <span className="slot-art">
                  <SkillIcon id={id} size={32} />
                </span>
                {game.rank(id) >= max ? (
                  <span className="slot-max" aria-hidden="true">
                    MAX
                  </span>
                ) : (
                  <Rank value={game.rank(id)} max={max} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
