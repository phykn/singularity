import type { Game } from '../game/Game.ts';
import { critChance, statIds } from '../game/rules.ts';
import type { StatId } from '../game/rules.ts';
import { formatTime } from './format.ts';
import { ControlIcon, SkillIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

const compact = (digits: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: digits });
const whole = compact(0),
  fraction = compact(2);

// The value each stat shows: damage, rate multiplier, range, crit percent, luck rank.
function statValue(game: Game, id: StatId): string {
  if (id === 'rate') return fraction.format(game.rate) + '×';
  if (id === 'crit') return whole.format(critChance(game.boosts.crit, game.rules) * 100) + '%';
  return whole.format(
    id === 'power' ? game.damage : id === 'range' ? game.range : game.boosts.luck,
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
  const c = copy[language];
  return (
    <section className="hud" aria-label={c.hud}>
      <div className="hud-top">
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
        <time>{formatTime(game.seconds)}</time>
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
    </section>
  );
}
