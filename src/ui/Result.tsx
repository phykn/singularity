import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game } from '../game/Game.ts';
import { Dialog } from './Dialog.tsx';
import { formatTime } from './format.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

export function Result({
  game,
  language,
  notice,
  onRetry,
}: {
  game: Game;
  language: Language;
  notice: ReactNode;
  onRetry: () => void;
}) {
  const result = game.result,
    [armed, setArmed] = useState(false);
  // A short delay keeps a tap meant for the arena from retrying at once.
  useEffect(() => {
    setArmed(false);
    if (!result) return;
    const timer = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(timer);
  }, [result]);
  if (!result) return null;
  const c = copy[language],
    success = result.outcome === 'success';
  return (
    <Dialog
      titleId="result-title"
      className={`result ${success ? 'success' : ''}`}
      modalClassName="result-modal"
      focusKey={String(armed)}
    >
      <div className="result-heading">
        <span className="result-time">{formatTime(result.seconds)}</span>
        <h2 id="result-title">{success ? c.success : c.failure}</h2>
      </div>
      <div className="dialog-body">
        <div className="result-numbers">
          <div>
            <span>{c.level}</span>
            <strong>{result.level}</strong>
          </div>
          <div>
            <span>{c.xp}</span>
            <strong>{result.xp}</strong>
          </div>
          <div>
            <span>{c.mass}</span>
            <strong>{result.mass}</strong>
          </div>
        </div>
        <p>
          {c.seed} {result.seed}
        </p>
        {notice}
      </div>
      <div className="dialog-actions result-actions">
        <button className="primary" onClick={onRetry} disabled={!armed}>
          {c.retry}
        </button>
      </div>
    </Dialog>
  );
}
