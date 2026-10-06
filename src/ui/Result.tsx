import type { ReactNode } from 'react';
import { statIds } from '../game/rules.ts';
import { particleIds } from '../game/particles.ts';
import { particleNames, languages } from './i18n.ts';
import { ParticleIcon, SkillIcon } from './icons.tsx';
import { Rank } from './controls.tsx';
import { Dialog } from './Dialog.tsx';
import { formatTime } from '../format.ts';
import type { BestRecord } from '../app/storage.ts';
import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function Result({
  game,
  language,
  best,
  notice,
  onRetry,
}: {
  game: Game;
  language: Language;
  best: BestRecord | null;
  notice: ReactNode;
  onRetry: () => void;
}) {
  const result = game.result;
  if (!result) return null;
  const c = copy[language],
    rules = game.rules,
    owned = game.ownedSkills;
  const title = result.outcome === 'success' ? c.success : c.failure;
  return (
    <Dialog
      titleId="result-title"
      className={`result ${result.outcome === 'success' ? 'success' : ''}`}
      modalClassName="result-modal"
    >
      <div className="result-heading">
        <span className="result-time">{formatTime(result.seconds)}</span>
        <h2 id="result-title">{title}</h2>
        {result.outcome !== 'success' && <p>{c.missing(result.missingXp)}</p>}
      </div>
      <div className="dialog-body">
        <div className="result-numbers">
          <div>
            <span>{c.level}</span>
            <strong>{result.level}</strong>
          </div>
          <div>
            <span>{c.energy}</span>
            <strong>{result.xp}</strong>
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
            {c.seed} {result.seed} · {result.trigger === 'gravity' ? c.early : c.goalReached}
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
              {c.best} · {best.outcome === 'success' ? c.success : c.failure} · {c.energy} {best.xp}
            </p>
          )}
        </details>
        {notice}
      </div>
      <div className="dialog-actions result-actions">
        <button className="primary" onClick={onRetry}>
          {c.retry}
        </button>
      </div>
    </Dialog>
  );
}
