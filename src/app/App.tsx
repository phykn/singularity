import { useState } from 'react';
import { ArrowRight, CircleQuestion as CircleHelp, SlidersHorizontal } from 'pixelarticons/react';
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

export default function App() {
  const {
    game,
    model,
    settingsRef,
    language,
    settings,
    best,
    storageOk,
    audioUnavailable,
    renderReady,
    onRenderReady,
    begin,
    select,
    changeLanguage,
    changeSettings,
    toggleSound,
    ...actions
  } = useGame();
  const c = copy[language];
  const [panel, setPanel] = useState<'guide' | 'settings' | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const ready = game.phase === 'ready';
  const modal = panel !== null || game.manualPaused || game.phase === 'result';

  function replace(seed?: number) {
    actions.replace(seed);
    setExitConfirm(false);
    setPanel(null);
  }
  function pause(paused: boolean) {
    actions.pause(paused);
    setExitConfirm(false);
  }

  const notice = (audioUnavailable || !storageOk) && (
    <p className="setting-notice" role="status">
      {audioUnavailable ? c.audioFailed : c.storageFailed}
    </p>
  );
  const settingsControls = (
    <Settings
      settings={settings}
      language={language}
      changeSettings={changeSettings}
      toggleSound={toggleSound}
    />
  );

  return (
    <main
      className={`app ${game.charged ? 'is-charged' : ''} ${ready ? 'is-ready' : ''} ${settings.reduced ? 'is-reduced' : ''} ${game.choice ? 'has-choice' : ''}`}
    >
      <div className="play-layout" inert={modal || (!ready && !renderReady)}>
        {ready ? (
          <header className="topbar">
            <div className="header-actions">
              <button
                className="icon-button"
                aria-label={c.guide}
                onClick={() => setPanel('guide')}
              >
                <CircleHelp aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                aria-label={c.settings}
                onClick={() => setPanel('settings')}
              >
                <SlidersHorizontal aria-hidden="true" />
              </button>
            </div>
          </header>
        ) : (
          <Hud game={game} language={language} onPause={() => pause(true)} />
        )}
        <section className="arena" aria-label={c.arena}>
          <GameCanvas model={model} settings={settingsRef} onReady={onRenderReady} />
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
              <UpgradeFeedback game={game} language={language} />
              {game.phase === 'collapse' && (
                <span className="sr-only" role="status">
                  {c.collapse}
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
              <button className="primary start" onClick={begin} disabled={!renderReady}>
                <span>{renderReady ? 'START' : c.loading}</span>
                <ArrowRight aria-hidden="true" />
              </button>
              <LanguagePicker value={language} onChange={changeLanguage} />
              {notice}
            </div>
          ) : (
            <Loadout game={game} language={language} />
          )}
        </section>
        {!ready && <Choices game={game} language={language} onSelect={select} />}
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
      {game.manualPaused && (
        <Dialog
          titleId="pause-title"
          className="pause-panel"
          focusKey={exitConfirm ? 'quit' : 'pause'}
        >
          <div className="dialog-body">
            <h2 id="pause-title">{exitConfirm ? c.quitTitle : c.pause}</h2>
            {exitConfirm ? (
              <p>{c.quitNote}</p>
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
                <button className="primary" onClick={() => replace(game.seed)}>
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
        notice={notice}
        onRetry={() => replace(game.seed)}
        onNewRun={() => replace()}
      />
    </main>
  );
}
