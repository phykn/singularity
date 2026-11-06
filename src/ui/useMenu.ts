import { useEffect, useRef, useState } from 'react';
import type { SkillId } from '../game/rules.ts';
import type { Session } from '../session/Session.ts';

type Panel = { kind: 'guide' | 'settings' | 'quit' } | { kind: 'skill'; id: SkillId };

// Help, settings, skill details and quit confirmation; Escape and focus return.
export function useMenu(session: Session, pause: (paused: boolean) => void) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const arena = useRef<HTMLElement>(null),
    wasPaused = useRef(session.paused),
    game = session.game;

  // Inspecting a skill pauses the run; closing the details resumes it.
  function inspect(id: SkillId) {
    if (game.phase !== 'running' || session.paused) return;
    pause(true);
    setPanel({ kind: 'skill', id });
  }
  function close() {
    if (panel?.kind === 'skill') pause(false);
    setPanel(null);
  }

  // Back to the arena after a pause, so Space and Enter tap the beat again.
  useEffect(() => {
    if (wasPaused.current && !session.paused && game.phase === 'running' && !game.choice)
      arena.current?.focus({ preventScroll: true });
    wasPaused.current = session.paused;
  });

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      if (panel) close();
      else if (session.ready && game.phase !== 'ready' && game.phase !== 'result')
        pause(!session.paused);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });

  return {
    panel,
    arena,
    open: (kind: 'guide' | 'settings' | 'quit') => setPanel({ kind }),
    inspect,
    close,
    // Leaving the pause menu by resuming or quitting closes any panel.
    pause: (paused: boolean) => {
      pause(paused);
      setPanel(null);
    },
  };
}
