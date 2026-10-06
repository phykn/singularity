import { useEffect, useState } from 'react';
import { ControlIcon } from '../ui/icons.tsx';
import { GameCanvas } from '../render/GameCanvas.tsx';
import { Hud } from '../ui/Hud.tsx';
import { Loadout } from '../ui/Loadout.tsx';
import { UpgradeFeedback } from '../ui/UpgradeFeedback.tsx';
import { Choices } from '../ui/Choices.tsx';
import { Guide } from '../ui/Guide.tsx';
import { Result } from '../ui/Result.tsx';
import { Settings } from '../ui/Settings.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { LanguagePicker } from '../ui/controls.tsx';
import { copy } from '../ui/i18n.ts';
import { useGame } from './useGame.ts';
import { version } from '../../package.json';

export default function App() {
  const {
    game,
    getGame,
    getLaunch,
    language,
    settings,
    best,
    bestBeyond,
    storageOk,
    audioUnavailable,
    renderReady,
    launching,
    playbackSpeed,
    cycleSpeed,
    pauseOnChoice,
    toggleChoicePause,
    onRenderReady,
    begin,
    continueBeyond,
    select,
    changeLanguage,
    toggleSound,
    ...actions
  } = useGame();
  const c = copy[language];
  const [panel, setPanel] = useState<'guide' | 'settings' | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [homecoming, setHomecoming] = useState(false);
  const ready = game.phase === 'ready';
  const modal = panel !== null || game.manualPaused || game.phase === 'result';

  function replace() {
    setHomecoming(game.result?.outcome === 'success');
    actions.replace();
    setExitConfirm(false);
    setPanel(null);
  }
  function pause(paused: boolean) {
    actions.pause(paused);
    setExitConfirm(false);
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      if (exitConfirm) setExitConfirm(false);
      else if (panel !== null) setPanel(null);
      else if (renderReady && game.phase !== 'ready' && game.phase !== 'result') {
        actions.pause(!game.manualPaused);
        setExitConfirm(false);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [game, panel, exitConfirm, renderReady, actions.pause]);

  const notice = (audioUnavailable || !storageOk) && (
    <p className="setting-notice" role="status">
      {audioUnavailable ? c.audioFailed : c.storageFailed}
    </p>
  );
  const settingsControls = (
    <Settings settings={settings} language={language} toggleSound={toggleSound} />
  );

  return (
    <main
      className={`app ${game.charged ? 'is-charged' : ''} ${game.endless ? 'is-beyond' : ''} ${ready ? 'is-ready' : ''} ${launching ? 'is-launching' : ''} ${ready && homecoming ? 'is-homecoming' : ''} ${game.choice ? 'has-choice' : ''}`}
    >
      <div className="play-layout" inert={modal || launching || (!ready && !renderReady)}>
        {ready ? (
          <header className="topbar">
            <a
              className="github-link"
              href="https://github.com/phykn/singularity"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              title="GitHub"
            >
              <ControlIcon id="github" />
              <span>GitHub</span>
              <ControlIcon id="star" className="github-star" />
            </a>
            <div className="header-actions">
              <button
                className="icon-button"
                aria-label={c.guide}
                onClick={() => setPanel('guide')}
              >
                <ControlIcon id="help" />
              </button>
              <button
                className="icon-button"
                aria-label={c.settings}
                onClick={() => setPanel('settings')}
              >
                <ControlIcon id="settings" />
              </button>
            </div>
          </header>
        ) : (
          <Hud
            game={game}
            language={language}
            playbackSpeed={playbackSpeed}
            onSpeed={cycleSpeed}
            onPause={() => pause(true)}
          />
        )}
        <section className="arena" aria-label={c.arena}>
          <GameCanvas getGame={getGame} getLaunch={getLaunch} onReady={onRenderReady} />
          {!ready && !renderReady && (
            <p className="render-status" role="status">
              {c.loading}
            </p>
          )}
          {!ready && !storageOk && (
            <p className="save-notice" role="status">
              {c.storageFailed}
            </p>
          )}
          {ready ? (
            <div className="arena-caption">
              <h1 lang="en">SINGULARITY</h1>
            </div>
          ) : (
            <>
              {game.phase === 'running' &&
                !game.charged &&
                game.margin < game.rules.dangerMargin && (
                  <span className="sr-only danger-status" role="status">
                    {c.danger}
                  </span>
                )}
              <UpgradeFeedback game={game} language={language} />
              {game.phase === 'crossing' && (
                <span className="sr-only" role="status">
                  {c.beyond}
                </span>
              )}
              {game.phase === 'collapse' && (
                <span className="sr-only" role="status">
                  {game.successfulEnding ? c.ready : c.collapse}
                </span>
              )}
              {game.phase === 'ending' && (
                <span className="sr-only" role="status">
                  {game.successfulEnding ? c.success : c.failure}
                </span>
              )}
            </>
          )}
        </section>
        <section className="footer" aria-label={ready ? 'START' : c.loadout}>
          {ready ? (
            <div className="preparation">
              <button
                className="primary start"
                onClick={begin}
                disabled={!renderReady || launching}
              >
                <span>{renderReady ? 'START' : c.loading}</span>
                <ControlIcon id="next" />
              </button>
              <LanguagePicker value={language} onChange={changeLanguage} />
              <small className="title-meta">
                <span>© 2026 phykn</span>
                <span>v{version}</span>
              </small>
              {notice}
            </div>
          ) : (
            <Loadout game={game} language={language} />
          )}
        </section>
        {!ready && (
          <Choices
            game={game}
            language={language}
            onSelect={select}
            pauseOnChoice={pauseOnChoice}
            onTogglePause={toggleChoicePause}
          />
        )}
      </div>

      {panel === 'guide' && (
        <Guide rules={game.rules} language={language} onClose={() => setPanel(null)} />
      )}
      {panel === 'settings' && (
        <Dialog titleId="settings-title" className="settings-panel">
          <div className="dialog-title">
            <h2 id="settings-title">{c.settings}</h2>
            <button className="text-button" onClick={() => setPanel(null)}>
              {c.close}
            </button>
          </div>
          <div className="dialog-body">
            {settingsControls}
            <LanguagePicker value={language} onChange={changeLanguage} />
            {notice}
          </div>
        </Dialog>
      )}
      {game.manualPaused && panel === null && (
        <Dialog
          titleId="pause-title"
          className="pause-panel"
          focusKey={exitConfirm ? 'quit' : 'pause'}
        >
          <div className="dialog-body">
            <h2 id="pause-title">{exitConfirm ? c.quitTitle : c.pause}</h2>
            {exitConfirm ? (
              <p>{game.endless ? c.quitBeyondNote : c.quitNote}</p>
            ) : (
              <>
                {settingsControls}
                <LanguagePicker value={language} onChange={changeLanguage} />
                {notice}
              </>
            )}
          </div>
          <div className="dialog-actions">
            {exitConfirm ? (
              <>
                <button className="primary" onClick={replace}>
                  {c.quitConfirm}
                </button>
                <button className="text-button" onClick={() => setExitConfirm(false)}>
                  {c.back}
                </button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => pause(false)}>
                  {c.resume}
                </button>
                <button className="text-button" onClick={() => setPanel('guide')}>
                  {c.guide}
                </button>
                <button className="text-button" onClick={() => setExitConfirm(true)}>
                  {c.quit}
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
      <Result
        game={game}
        language={language}
        best={best}
        bestBeyond={bestBeyond}
        notice={notice}
        onRetry={replace}
        onBeyond={continueBeyond}
      />
    </main>
  );
}
