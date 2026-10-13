import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { endingFrame } from '../presentation/ending.ts';
import { beyondFrame } from '../presentation/beyond.ts';
import { arenaViewport } from '../presentation/viewport.ts';
import { ControlIcon, SoundIcon } from '../ui/icons.tsx';
import { GameCanvas } from '../render/GameCanvas.tsx';
import { Hud } from '../ui/Hud.tsx';
import { Loadout } from '../ui/Loadout.tsx';
import { UpgradeFeedback } from '../ui/UpgradeFeedback.tsx';
import { Choices } from '../ui/Choices.tsx';
import { Guide } from '../ui/Guide.tsx';
import { Result } from '../ui/Result.tsx';
import { Settings } from '../ui/Settings.tsx';
import { SkillDetails } from '../ui/SkillDetails.tsx';
import { RhythmInput } from '../ui/RhythmInput.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { LanguagePicker } from '../ui/controls.tsx';
import { copy } from '../ui/i18n.ts';
import { useGame } from './useGame.ts';
import { useGameMenu } from './useGameMenu.ts';
import { version } from '../../package.json';

export default function App() {
  const {
    game,
    getGame,
    getRhythm,
    rhythm,
    tapRhythm,
    language,
    settings,
    best,
    bestBeyond,
    storageOk,
    audioUnavailable,
    renderReady,
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
  const menu = useGameMenu(game, renderReady, actions.pause, actions.replace);
  const { panel, arena, homecoming, modal, pause, replace, inspectSkill } = menu;
  const exitConfirm = panel?.kind === 'quit';
  const caption = useRef<HTMLDivElement>(null);
  const github = useRef<HTMLAnchorElement>(null);
  const ready = game.phase === 'ready';
  const crossing = beyondFrame(game);
  const hud = crossing ? 0.22 + 0.78 * crossing.expand : (endingFrame(game)?.hud ?? 1);

  useLayoutEffect(() => {
    if (!ready || !arena.current || !caption.current || !github.current) return;
    const surface = arena.current,
      title = caption.current,
      link = github.current,
      layout = surface.parentElement!;
    const position = () => {
      const bounds = surface.getBoundingClientRect();
      const viewport = arenaViewport(Math.round(bounds.width), Math.round(bounds.height));
      const orbitTop = bounds.top + viewport.centerY - game.rules.orbitRadius * viewport.scale;
      const center = (link.getBoundingClientRect().bottom + orbitTop) / 2;
      title.style.setProperty('--title-center', `${center - layout.getBoundingClientRect().top}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(layout);
    observer.observe(surface);
    observer.observe(link);
    return () => observer.disconnect();
  }, [ready, game.rules.orbitRadius]);

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
      style={{ '--scene-hud': hud } as CSSProperties}
      className={`app ${game.charged ? 'is-charged' : ''} ${game.endless ? 'is-beyond' : ''} ${ready ? 'is-ready' : ''} ${ready && homecoming ? 'is-homecoming' : ''}`}
    >
      <div className="play-layout" inert={modal || (!ready && !renderReady)}>
        {ready ? (
          <header className="topbar">
            <a
              ref={github}
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
                onClick={() => menu.open('guide')}
              >
                <ControlIcon id="help" />
              </button>
              <button
                className="icon-button"
                aria-label={c.settings}
                onClick={() => menu.open('settings')}
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
        {ready && (
          <div ref={caption} className="arena-caption">
            <h1 lang="en">SINGULARITY</h1>
          </div>
        )}
        <section ref={arena} className="arena" tabIndex={-1} aria-label={c.arena}>
          <GameCanvas getGame={getGame} getRhythm={getRhythm} onReady={onRenderReady} />
          {!modal && renderReady && game.phase === 'running' && !game.choice && !game.paused && (
            <RhythmInput rhythm={rhythm} language={language} onTap={tapRhythm} />
          )}
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
          {!ready && (
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
        <section
          className="footer"
          aria-label={ready ? 'START' : game.choice ? c.choices : c.loadout}
        >
          {ready ? (
            <div className="preparation">
              <button
                className="title-sound"
                onClick={() => void toggleSound()}
                aria-label={c.sound + ' ' + (settings.sound ? c.on : c.off)}
                aria-pressed={settings.sound}
                aria-describedby="sound-recommendation"
              >
                <SoundIcon enabled={settings.sound} />
                <span className="title-sound-label">
                  <span>{c.sound}</span>
                  <span className="sound-recommendation" id="sound-recommendation">
                    {c.soundRecommended}
                  </span>
                </span>
                <span className="title-sound-state">{settings.sound ? c.on : c.off}</span>
                <i className="switch" aria-hidden="true" />
              </button>
              <button className="primary start" onClick={begin} disabled={!renderReady}>
                <span>{renderReady ? 'START' : c.loading}</span>
                <ControlIcon id="next" />
              </button>
              <LanguagePicker value={language} onChange={changeLanguage} />
              {notice}
            </div>
          ) : (
            <Loadout game={game} language={language} onInspect={inspectSkill} />
          )}
          {!ready && (
            <Choices
              game={game}
              language={language}
              onSelect={select}
              pauseOnChoice={pauseOnChoice}
              onTogglePause={toggleChoicePause}
              interactive={renderReady && !game.paused && game.phase === 'running'}
            />
          )}
        </section>
      </div>

      {ready && (
        <small className="title-meta">
          <span>© 2026 phykn</span>
          <span>v{version}</span>
        </small>
      )}

      {panel?.kind === 'guide' && (
        <Guide rules={game.rules} language={language} onClose={menu.close} />
      )}
      {panel?.kind === 'settings' && (
        <Dialog titleId="settings-title" className="settings-panel">
          <div className="dialog-title">
            <h2 id="settings-title">{c.settings}</h2>
            <button className="text-button" onClick={menu.close}>
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
      {panel?.kind === 'skill' && (
        <SkillDetails game={game} id={panel.id} language={language} onClose={menu.close} />
      )}
      {game.manualPaused && game.phase !== 'result' && (!panel || exitConfirm) && (
        <Dialog
          titleId="pause-title"
          className={`pause-panel ${exitConfirm ? 'is-confirming' : ''}`}
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
                <button className="text-button quit-button" onClick={replace}>
                  {c.quitConfirm}
                </button>
                <button className="primary" data-autofocus onClick={menu.close}>
                  {c.back}
                </button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => pause(false)}>
                  {c.resume}
                </button>
                <button className="text-button" onClick={() => menu.open('guide')}>
                  {c.guide}
                </button>
                <button className="text-button" onClick={() => menu.open('quit')}>
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
