import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game } from '../game/Game.ts';
import type { Records } from '../session/storage.ts';
import { Dialog } from './Dialog.tsx';
import { formatTime } from './format.ts';
import { Rank, SkillIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

export function Result({
  game,
  language,
  records,
  notice,
  onRetry,
  onBeyond,
}: {
  game: Game;
  language: Language;
  records: Records;
  notice: ReactNode;
  onRetry: () => void;
  onBeyond: () => void;
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
    success = result.outcome === 'success',
    beyond = result.endless;
  return (
    <Dialog
      titleId="result-title"
      className={`result ${success ? 'success' : ''}`}
      modalClassName="result-modal"
      focusKey={String(armed)}
    >
      <div className="result-heading">
        <span className="result-time">
          {beyond ? '∞' + formatTime(beyond.seconds) : formatTime(result.seconds)}
        </span>
        <h2 id="result-title">{beyond ? c.beyond : success ? c.success : c.failure}</h2>
      </div>
      <div className="dialog-body">
        <div className="result-numbers">
          <div>
            <span>{c.level}</span>
            <strong>{result.level}</strong>
          </div>
          <div>
            <span>{beyond ? c.beyondXp : c.xp}</span>
            <strong>{beyond ? beyond.xp : result.xp}</strong>
          </div>
          {beyond ? (
            <div>
              <span>{c.round}</span>
              <strong>{result.round}</strong>
            </div>
          ) : (
            <div>
              <span>{c.mass}</span>
              <strong>{result.mass}</strong>
            </div>
          )}
        </div>
        <div className="result-build">
          {game.growth.ownedSkills.map((id) => (
            <div key={id} data-rarity={result.rarities[id]} data-evolved={!!result.evolved[id]}>
              <SkillIcon id={id} size={32} evolved={!!result.evolved[id]} />
              <span>{result.evolved[id] ? c.evolutions[id].name : c.upgrades[id].short}</span>
              <small>{c.rarities[result.rarities[id] ?? 'common']}</small>
              <span
                role="img"
                aria-label={`${c.rank} ${result.ranks[id]}/${game.rules.growth.maxRank}`}
              >
                <Rank value={result.ranks[id]} max={game.rules.growth.maxRank} />
              </span>
            </div>
          ))}
        </div>
        <p>
          {c.seed} {result.seed}
        </p>
        {records.improved && <p className="new-best">{c.newBest}</p>}
        <Best records={records} language={language} />
        {notice}
      </div>
      <div className="dialog-actions result-actions">
        {game.canContinue && (
          <button className="primary beyond-button" onClick={onBeyond} disabled={!armed}>
            {c.beyond}
          </button>
        )}
        <button
          className={game.canContinue ? 'text-button' : 'primary'}
          onClick={onRetry}
          disabled={!armed}
        >
          {c.retry}
        </button>
      </div>
    </Dialog>
  );
}

// The best clear-or-loss run and the longest run beyond the singularity.
export function Best({ records, language }: { records: Records; language: Language }) {
  const c = copy[language],
    { best, beyond } = records;
  if (!best && !beyond) return null;
  return (
    <dl className="records">
      {best && (
        <div>
          <dt>{c.best}</dt>
          <dd>
            {best.outcome === 'success' ? c.success : c.failure} · {c.energy} {best.xp}
          </dd>
        </div>
      )}
      {beyond && (
        <div>
          <dt>{c.beyond}</dt>
          <dd>
            ∞ {formatTime(beyond.seconds)} · {c.beyondXp} {beyond.xp}
          </dd>
        </div>
      )}
    </dl>
  );
}
