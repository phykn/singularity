import { skillIds } from '../game/rules.ts';
import type { SkillId, UpgradeId } from '../game/rules.ts';
import type { SkillStatus } from '../game/types.ts';
import { SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import { skillValue } from './skillText.ts';
import type { Game } from '../game/model.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function ownedSkills(game: Game): SkillId[] {
  return skillIds
    .filter((id) => game.rank(id))
    .sort(
      (a, b) =>
        game.selections.findIndex((s) => s.id === a) - game.selections.findIndex((s) => s.id === b),
    );
}

export function Loadout({ game, language }: { game: Game; language: Language }) {
  const c = copy[language],
    rules = game.rules,
    owned = ownedSkills(game);
  const progress = game.levelProgress;
  const xpPercent = progress.required
    ? Math.min(100, (progress.current / progress.required) * 100)
    : 100;
  const value = (id: UpgradeId, rank = game.rank(id)) =>
    skillValue(id, rank, game.rarities[id], language, rules);
  return (
    <div className="play-footer">
      <div className="xp-status">
        <div>
          <span className="level">
            Lv. <b>{game.level.toString().padStart(2, '0')}</b>
          </span>
          <span>XP</span>
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
      <div className="loadout" aria-label={c.loadout}>
        {Array.from({ length: 4 }, (_, i) => {
          const id = owned[i];
          const status = id ? game.combat.status(id) : null;
          return (
            <div
              className={`slot ${id ? '' : 'empty'}`}
              key={id ? id + game.rank(id) : i}
              data-skill={id}
              data-mode={status?.mode}
              data-active={status?.active}
              data-fired={status?.fired}
              data-acquired={game.notice === id && game.time < game.noticeUntil}
              data-rarity={id ? game.rarities[id] : undefined}
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
                    rules.maxRank
                  : c.empty
              }
              title={id ? c.upgrades[id].name + ' · ' + value(id) : undefined}
            >
              {id && status ? (
                <SkillSlot id={id} status={status} rank={game.rank(id)} max={rules.maxRank} />
              ) : (
                <i />
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
}: {
  id: SkillId;
  status: SkillStatus;
  rank: number;
  max: number;
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
        <SkillIcon id={id} size={16} />
      </span>
      <span className={'slot-mode ' + status.mode} aria-hidden="true" />
      {rank >= max ? (
        <span className="slot-max" aria-hidden="true">
          MAX
        </span>
      ) : (
        <Rank value={rank} max={max} />
      )}
    </>
  );
}
