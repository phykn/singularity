import type { Game } from '../game/Game.ts';
import { statIds } from '../game/rules.ts';
import { critChance } from '../game/skills.ts';
import type { StatId } from '../game/rules.ts';
import { formatTime } from './format.ts';
import { ChargeIcon, ControlIcon, SkillIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

const compact = (digits: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: digits });
const whole = compact(0),
  fraction = compact(2);

// The value each stat shows: damage, rate multiplier, range, crit percent, luck rank.
function statValue(game: Game, id: StatId): string {
  if (id === 'rate') return fraction.format(game.combat.rate) + '×';
  if (id === 'crit')
    return whole.format(critChance(game.growth.boosts.crit, game.rules) * 100) + '%';
  return whole.format(
    id === 'power'
      ? game.combat.damage
      : id === 'range'
        ? game.combat.range
        : game.growth.boosts.luck,
  );
}

export function Hud({
  game,
  language,
  speed,
  onSpeed,
  onPause,
}: {
  game: Game;
  language: Language;
  speed: number;
  onSpeed: () => void;
  onPause: () => void;
}) {
  // Endless mode counts rounds and time beyond instead of the way to the Higgs.
  const c = copy[language],
    endless = game.endless,
    progress = endless ? game.giants.roundProgress : game.giants.higgsProgress,
    percent = Math.floor(progress * 100),
    due = progress >= 1,
    boss = game.phase === 'running' ? game.giants.boss : undefined;
  return (
    <section className="hud" aria-label={c.hud} data-critical={game.critical}>
      <div className="hud-top">
        <div
          className={`charge ${due ? 'energy-full' : ''}`}
          role="progressbar"
          aria-label={
            endless ? `${c.round} ${game.giants.round}` : due ? c.finalBossDue : c.singularity
          }
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <ChargeIcon progress={percent / 100} />
          <b>{endless ? `R${game.giants.round}` : `${percent}%`}</b>
        </div>
        <div className="boosts">
          {statIds.map((id) => (
            <div
              className="boost"
              key={id}
              aria-label={`${c.upgrades[id].short}, ${statValue(game, id)}`}
            >
              <SkillIcon id={id} size={14} />
              <b>{statValue(game, id)}</b>
            </div>
          ))}
        </div>
        <time>{endless ? '∞' + formatTime(game.endlessSeconds) : formatTime(game.seconds)}</time>
        <button
          className="icon-button speed-button"
          onClick={onSpeed}
          disabled={game.phase !== 'running'}
          aria-label={`${c.playbackSpeed} ${speed}×`}
          title={c.playbackSpeed}
        >
          {speed}×
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
