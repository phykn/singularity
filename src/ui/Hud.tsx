import { critChance, statIds } from '../game/rules.ts';
import { ChargeIcon, SkillIcon, ControlIcon } from './icons.tsx';
import { currentSkillValue } from './skillText.ts';
import { formatTime } from '../format.ts';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

const statNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 0,
});
const rateNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
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
  const percent = Math.floor(game.finalProgress * 100),
    due = game.finalProgress >= 1;
  const boss = game.phase === 'running' ? game.boss : undefined;
  return (
    <section className="hud" aria-label={c.hud} data-critical={game.critical}>
      <div className="hud-top">
        {game.endless ? (
          <div className="beyond-symbol" aria-label={c.beyond}>
            ∞
          </div>
        ) : (
          <div
            className={`charge ${due ? 'energy-full' : ''}`}
            role="progressbar"
            aria-label={due ? c.finalBossDue : c.charge}
            aria-valuenow={Math.min(Math.floor(game.time), rules.boss.final.time)}
            aria-valuemin={0}
            aria-valuemax={rules.boss.final.time}
          >
            <ChargeIcon progress={percent / 100} />
            <b>{percent}%</b>
          </div>
        )}
        <div className="boosts" aria-label={c.stats}>
          {statIds.map((id) => (
            <div
              className="boost"
              data-acquired={game.notice === id && game.time < game.noticeUntil}
              key={id}
              aria-label={c.upgrades[id].short + ', ' + currentSkillValue(game, id, language)}
              title={c.upgrades[id].short + ', ' + currentSkillValue(game, id, language)}
            >
              <SkillIcon id={id} size={14} />
              <b>
                {(id === 'rate' ? rateNumber : statNumber).format(
                  id === 'power'
                    ? game.damage
                    : id === 'rate'
                      ? game.rate
                      : id === 'range'
                        ? game.range
                        : id === 'crit'
                          ? critChance(game.boosts.crit, rules) * 100
                          : game.boosts.luck,
                )}
                {id === 'rate' && '×'}
                {id === 'crit' && '%'}
              </b>
            </div>
          ))}
        </div>
        <time aria-label={game.endless ? c.survived : undefined}>
          {formatTime(game.endless ? game.endlessSeconds : game.seconds)}
        </time>
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
          <ControlIcon id="pause" />
        </button>
      </div>
      {boss && (
        <div
          className="boss-bar"
          role="progressbar"
          aria-label={boss.boss ? c.bossNames[boss.boss] : c.bossName}
          data-final={Boolean(boss.final)}
          aria-valuenow={Math.ceil((boss.hp / boss.maxHp) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: (boss.hp / boss.maxHp) * 100 + '%' }} />
        </div>
      )}
    </section>
  );
}
