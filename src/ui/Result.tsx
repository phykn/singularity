import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { statIds } from '../game/rules.ts';
import { particleIds } from '../game/particles.ts';
import { particleNames, languages } from './i18n.ts';
import { ParticleIcon, SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import { Dialog } from './Dialog.tsx';
import { formatTime } from '../format.ts';
import type { BestRecord, BeyondRecord } from '../app/storage.ts';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function Result({
  game,
  language,
  best,
  bestBeyond,
  notice,
  onRetry,
  onBeyond,
}: {
  game: Game;
  language: Language;
  best: BestRecord | null;
  bestBeyond: BeyondRecord | null;
  notice: ReactNode;
  onRetry: () => void;
  onBeyond: () => void;
}) {
  const crossing = game.phase === 'crossing';
  const result = crossing ? game.clearResult : game.result;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    if (!result) return;
    const timer = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(timer);
  }, [result]);
  const departure = crossing ? (game.phaseProgress * game.rules.endless.entrySeconds) / 0.35 : 0;
  if (!result || departure >= 1 || (crossing && game.manualPaused)) return null;
  const c = copy[language],
    rules = game.rules,
    owned = game.ownedSkills;
  const title = result.endless ? c.beyond : result.outcome === 'success' ? c.success : c.failure;
  const canContinue = !result.endless && result.outcome === 'success';
  return (
    <div style={{ opacity: 1 - departure }} inert={crossing}>
      <Dialog
        titleId="result-title"
        className={`result ${result.outcome === 'success' ? 'success' : ''}`}
        modalClassName="result-modal"
        focusKey={String(armed)}
      >
        <div className="result-heading">
          <span className="result-time">
            {result.endless ? '∞ ' : ''}
            {formatTime(result.endless?.seconds ?? result.seconds)}
          </span>
          <h2 id="result-title">{title}</h2>
          {!result.endless && result.outcome !== 'success' && <p>{c.missing(result.missingXp)}</p>}
        </div>
        <div className="dialog-body">
          <div className="result-numbers">
            <div>
              <span>{c.level}</span>
              <strong>{result.level}</strong>
            </div>
            <div>
              <span>{result.endless ? c.beyondXp : c.energy}</span>
              <strong>{result.endless?.xp ?? result.xp}</strong>
            </div>
            <div>
              <span>{c.mass}</span>
              <strong>{result.mass}</strong>
            </div>
          </div>
          <div className="result-build">
            {owned.map((id) => (
              <div key={id} data-rarity={game.rarities[id]}>
                <SkillIcon id={id} size={32} />
                <span>{c.upgrades[id].short}</span>
                <small>{c.rarities[game.rarities[id]]}</small>
                <Rank value={game.rank(id)} max={rules.maxRank} />
              </div>
            ))}
          </div>
          <details>
            <summary>{c.details}</summary>
            <p>
              {c.seed} {result.seed} ·{' '}
              {result.trigger === 'gravity'
                ? c.early
                : result.trigger === 'energy'
                  ? c.goalReached
                  : c.finish}
            </p>
            <p>
              {c.score}{' '}
              {result.score.toLocaleString(languages.find((entry) => entry.id === language)!.html)}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">{c.particle}</th>
                  <th scope="col">{c.generated}</th>
                  <th scope="col">{c.killed}</th>
                  <th scope="col">{c.absorbed}</th>
                  <th scope="col">{c.remaining}</th>
                </tr>
              </thead>
              <tbody>
                {particleIds.map((id) => {
                  const counts = result.counts[id];
                  return (
                    <tr key={id} data-particle={id}>
                      <th scope="row">
                        <span className="result-particle">
                          <ParticleIcon id={id} />
                          {particleNames[language][id]}
                        </span>
                      </th>
                      <td>{counts.generated}</td>
                      <td>{counts.killed}</td>
                      <td>{counts.absorbed}</td>
                      <td>{counts.remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>
              {c.stats} ·{' '}
              {statIds.map((id) => c.upgrades[id].short + ' ' + game.rank(id)).join(' / ')}
            </p>
            {result.selections.some((s) => s.id === 'recover') && (
              <p>{c.recoveryCount(result.selections.filter((s) => s.id === 'recover').length)}</p>
            )}
            {best && (
              <p>
                {c.best} · {best.outcome === 'success' ? c.success : c.failure} · {c.energy}{' '}
                {best.xp}
              </p>
            )}
            {result.endless && bestBeyond && (
              <p>
                {c.best} · ∞ {formatTime(bestBeyond.seconds)} · {c.beyondXp} {bestBeyond.xp}
              </p>
            )}
          </details>
          {notice}
        </div>
        <div className="dialog-actions result-actions">
          {canContinue && (
            <button
              className="primary beyond-button"
              onClick={onBeyond}
              disabled={!armed || crossing}
            >
              {c.beyond}
              <span aria-hidden="true">↗</span>
            </button>
          )}
          <button
            className={canContinue ? 'text-button' : 'primary'}
            onClick={onRetry}
            disabled={!armed || crossing}
          >
            {result.outcome === 'success' || result.endless ? c.finish : c.retry}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
