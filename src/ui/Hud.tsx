import { Pause } from 'pixelarticons/react';
import { statIds } from '../game/rules.ts';
import type { UpgradeId } from '../game/rules.ts';
import { ChargeIcon, SkillIcon } from './icons.tsx';
import { skillValue } from './skillText.ts';
import { formatTime } from '../format.ts';
import type { Game } from '../game/model.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

const statNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumSignificantDigits: 2,
});
export function Hud({
  game,
  language,
  playbackSpeed,
  onSpeed,
  onPause,
}: {
  game: Game;
  language: Language;
  playbackSpeed: number;
  onSpeed: () => void;
  onPause: () => void;
}) {
  const c = copy[language],
    rules = game.rules;
  const energyPercent = Math.min(100, Math.floor((game.xp / rules.energyGoal) * 100));
  const value = (id: UpgradeId, rank = game.rank(id)) =>
    skillValue(id, rank, game.rarities[id], language, rules, game.reach);
  return (
    <section className="hud" aria-label={c.hud}>
      <div className="hud-top">
        <div
          className={`charge ${game.charged ? 'charged-label' : ''}`}
          role="progressbar"
          aria-label={game.charged ? c.ready : c.charge}
          aria-valuenow={Math.min(game.xp, rules.energyGoal)}
          aria-valuemin={0}
          aria-valuemax={rules.energyGoal}
        >
          <ChargeIcon progress={energyPercent / 100} />
          <b>{energyPercent}%</b>
        </div>
        <div className="boosts" aria-label={c.stats}>
          {statIds.map((id) => (
            <div
              className="boost"
              data-acquired={game.notice === id && game.time < game.noticeUntil}
              key={id}
              aria-label={c.upgrades[id].short + ', ' + value(id)}
              title={c.upgrades[id].short + ', ' + value(id)}
            >
              <SkillIcon id={id} size={14} />
              <b>
                {statNumber.format(
                  id === 'power'
                    ? game.damage
                    : id === 'rate'
                      ? game.rate
                      : id === 'range'
                        ? game.range
                        : game.speed,
                )}
                {id === 'rate' && '×'}
              </b>
            </div>
          ))}
        </div>
        <time>{formatTime(game.seconds)}</time>
        <button
          className="icon-button speed-button"
          onClick={onSpeed}
          disabled={game.phase !== 'running'}
          aria-label={`${c.playbackSpeed} ${playbackSpeed}×`}
          title={c.playbackSpeed}
        >
          {playbackSpeed}×
        </button>
        <button
          className="icon-button pause-button"
          onClick={onPause}
          disabled={game.phase === 'result'}
          aria-label={c.pause}
        >
          <Pause aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
