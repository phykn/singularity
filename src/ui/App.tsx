import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { version } from '../../package.json';
import { Canvas } from '../render/Canvas.tsx';
import { arenaViewport, endingFrame } from '../render/timeline.ts';
import { Choices } from './Choices.tsx';
import { Dialog } from './Dialog.tsx';
import { Hud } from './Hud.tsx';
import { ControlIcon, SoundIcon } from './icons.tsx';
import { Loadout } from './Loadout.tsx';
import { Result } from './Result.tsx';
import { copy, languages } from './text/index.ts';
import type { Language } from './text/index.ts';
import { useGame } from './useGame.ts';

export default function App() {
  const g = useGame(),
    { session, game, language } = g,
    c = copy[language],
    ready = game.phase === 'ready',
    paused = session.paused && game.phase !== 'result';
  const arena = useRef<HTMLElement>(null),
    caption = useRef<HTMLDivElement>(null),
    github = useRef<HTMLAnchorElement>(null);

  // The title sits halfway between the header and the top of the orbit.
  useLayoutEffect(() => {
    if (!ready || !arena.current || !caption.current || !github.current) return;
    const surface = arena.current,
      title = caption.current,
      link = github.current,
      layout = surface.parentElement!;
    const position = () => {
      const bounds = surface.getBoundingClientRect(),
        view = arenaViewport(Math.round(bounds.width), Math.round(bounds.height)),
        orbitTop = bounds.top + view.centerY - game.rules.orbit.radius * view.scale,
        center = (link.getBoundingClientRect().bottom + orbitTop) / 2;
      title.style.setProperty('--title-center', `${center - layout.getBoundingClientRect().top}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    for (const node of [layout, surface, link]) observer.observe(node);
    return () => observer.disconnect();
  }, [ready, game.rules.orbit.radius]);

  const notice = (g.audioFailed || g.storageFailed) && (
    <p className="setting-notice" role="status">
      {g.audioFailed ? c.audioFailed : c.storageFailed}
    </p>
  );
  const soundToggle = (
    <button
      className="title-sound"
      onClick={g.toggleSound}
      aria-label={`${c.sound} ${g.sound ? c.on : c.off}`}
      aria-pressed={g.sound}
    >
      <SoundIcon enabled={g.sound} />
      <span className="title-sound-label">
        <span>{c.sound}</span>
      </span>
      <span className="title-sound-state">{g.sound ? c.on : c.off}</span>
      <i className="switch" aria-hidden="true" />
    </button>
  );
  const picker = <LanguagePicker value={language} onChange={g.changeLanguage} />;

  return (
    <main
      style={{ '--scene-hud': endingFrame(game)?.hud ?? 1 } as CSSProperties}
      className={`app ${ready ? 'is-ready' : ''}`}
    >
      <div className="play-layout" inert={paused || (!ready && !session.ready)}>
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
          </header>
        ) : (
          <Hud
            game={game}
            language={language}
            speed={session.speed}
            onSpeed={g.cycleSpeed}
            onPause={() => g.pause(true)}
          />
        )}
        {ready && (
          <div ref={caption} className="arena-caption">
            <h1 lang="en">SINGULARITY</h1>
          </div>
        )}
        <section ref={arena} className="arena" tabIndex={-1} aria-label={c.arena}>
          <Canvas session={session} onReady={g.onReady} />
          {!session.ready && (
            <p className="render-status" role="status">
              {c.loading}
            </p>
          )}
          {game.phase === 'running' && game.margin < game.rules.orbit.dangerMargin && (
            <span className="sr-only danger-status" role="status">
              {c.danger}
            </span>
          )}
        </section>
        <section
          className="footer"
          aria-label={ready ? 'START' : game.choice ? c.choices : c.loadout}
        >
          {!ready && <Loadout game={game} language={language} />}
          {!ready && (
            <Choices
              game={game}
              language={language}
              pauseOnChoice={session.pauseOnChoice}
              secondsLeft={session.choiceLeft / 1000}
              interactive={session.live}
              onSelect={g.select}
              onTogglePause={g.toggleChoicePause}
            />
          )}
          {ready && (
            <div className="preparation">
              {soundToggle}
              <button className="primary start" onClick={g.start} disabled={!session.ready}>
                <span>{session.ready ? 'START' : c.loading}</span>
                <ControlIcon id="next" />
              </button>
              {picker}
              {notice}
            </div>
          )}
        </section>
      </div>
      {ready && (
        <small className="title-meta">
          <span>© 2026 phykn</span>
          <span>v{version}</span>
        </small>
      )}
      {paused && (
        <Dialog titleId="pause-title" className="pause-panel">
          <div className="dialog-body">
            <h2 id="pause-title">{c.pause}</h2>
            {soundToggle}
            {picker}
            {notice}
          </div>
          <div className="dialog-actions">
            <button className="primary" onClick={() => g.pause(false)}>
              {c.resume}
            </button>
            <button className="text-button" onClick={g.restart}>
              {c.quit}
            </button>
          </div>
        </Dialog>
      )}
      <Result game={game} language={language} notice={notice} onRetry={g.restart} />
    </main>
  );
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div className="language-picker" role="group" aria-label={copy[value].language}>
      {languages.map(({ id, label, html }) => (
        <button key={id} lang={html} aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
