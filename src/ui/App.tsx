import type { CSSProperties } from 'react';
import { version } from '../../package.json';
import { Canvas } from '../render/Canvas.tsx';
import { endingFrame } from '../render/timeline.ts';
import { Choices } from './Choices.tsx';
import { EventBanner } from './EventBanner.tsx';
import { Guide } from './Guide.tsx';
import { Hud } from './Hud.tsx';
import { Loadout } from './Loadout.tsx';
import { Pause, Settings } from './Menus.tsx';
import { Notice } from './Preferences.tsx';
import { Result } from './Result.tsx';
import { RhythmInput } from './RhythmInput.tsx';
import { SkillDetails } from './SkillDetails.tsx';
import { copy } from './text/index.ts';
import { TitleFoot, TitleHead } from './Title.tsx';
import { useGame } from './useGame.ts';
import { useMenu } from './useMenu.ts';

// The title before START, then the HUD, arena and loadout of a run; menus and the result
// open over it.
export default function App() {
  const g = useGame(),
    { session, game, language } = g,
    c = copy[language],
    ready = game.phase === 'ready',
    paused = session.paused && game.phase !== 'result',
    menu = useMenu(session, g.pause),
    { panel, arena } = menu,
    confirming = panel?.kind === 'quit',
    modal = panel !== null || paused || game.phase === 'result';

  return (
    <main
      style={{ '--scene-hud': endingFrame(game)?.hud ?? 1 } as CSSProperties}
      className={`app ${game.endless ? 'is-beyond' : ''} ${ready ? 'is-ready' : ''}`}
    >
      <div className="play-layout" inert={modal || (!ready && !session.ready)}>
        {ready ? (
          <TitleHead g={g} onOpen={menu.open} />
        ) : (
          <Hud
            game={game}
            language={language}
            speed={session.speed}
            onSpeed={g.cycleSpeed}
            onPause={() => menu.pause(true)}
          />
        )}
        <section ref={arena} className="arena" tabIndex={-1} aria-label={c.arena}>
          <Canvas session={session} onReady={g.onReady} />
          {!ready && <EventBanner game={game} language={language} />}
          {session.rhythmAvailable && (
            <RhythmInput rhythm={session.rhythm} language={language} onTap={g.tap} />
          )}
          {!session.ready && (
            <p className="render-status" role="status">
              {c.loading}
            </p>
          )}
          {game.phase === 'running' && game.danger && (
            <span className="sr-only danger-status" role="status">
              {c.danger}
            </span>
          )}
        </section>
        <section
          className="footer"
          aria-label={ready ? 'START' : game.growth.choice ? c.choices : c.loadout}
        >
          {ready ? (
            <TitleFoot g={g} />
          ) : (
            <>
              <Loadout game={game} language={language} onInspect={menu.inspect} />
              <Choices
                game={game}
                language={language}
                pauseOnChoice={session.pauseOnChoice}
                secondsLeft={session.choiceLeft / 1000}
                interactive={session.live}
                onSelect={g.select}
                onTogglePause={g.toggleChoicePause}
              />
            </>
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
      {panel?.kind === 'settings' && <Settings g={g} onClose={menu.close} />}
      {panel?.kind === 'skill' && (
        <SkillDetails game={game} id={panel.id} language={language} onClose={menu.close} />
      )}
      {paused && (!panel || confirming) && (
        <Pause
          g={g}
          confirming={confirming}
          onResume={() => menu.pause(false)}
          onOpen={menu.open}
          onClose={menu.close}
        />
      )}
      <Result
        game={game}
        language={language}
        records={g.records}
        notice={<Notice g={g} />}
        onRetry={g.restart}
        onBeyond={g.beyond}
      />
    </main>
  );
}
