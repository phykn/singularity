import type { Game } from '../game/Game.ts';
import { formatTime } from './format.ts';
import { ControlIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

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
  const c = copy[language],
    { current, required } = game.levelProgress;
  return (
    <section className="hud" aria-label={c.hud}>
      <div className="hud-top">
        <div className="charge" aria-label={`${c.level} ${game.level}`}>
          <b>
            {c.level} {game.level}
          </b>
        </div>
        <div
          className="boosts"
          role="progressbar"
          aria-label={c.xp}
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={required}
        >
          <b>
            {c.xp} {game.xp}
          </b>
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
