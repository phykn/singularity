import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game.ts';
import type { SkillId } from '../game/rules.ts';

type Panel = { kind: 'guide' | 'settings' | 'quit' } | { kind: 'skill'; id: SkillId };

export function useGameMenu(
  game: Game,
  renderReady: boolean,
  pauseGame: (paused: boolean) => void,
  replaceGame: () => void,
) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [homecoming, setHomecoming] = useState(false);
  const arena = useRef<HTMLElement>(null);
  const wasPaused = useRef(game.manualPaused);

  function pause(paused: boolean) {
    pauseGame(paused);
    setPanel(null);
  }

  function replace() {
    setHomecoming(game.result?.outcome === 'success');
    replaceGame();
    setPanel(null);
  }

  function inspectSkill(id: SkillId) {
    if (game.phase !== 'running' || game.manualPaused) return;
    pauseGame(true);
    setPanel({ kind: 'skill', id });
  }

  function close() {
    if (panel?.kind === 'skill') pauseGame(false);
    setPanel(null);
  }

  useEffect(() => {
    if (wasPaused.current && !game.manualPaused && game.phase === 'running' && !game.choice)
      arena.current?.focus({ preventScroll: true });
    wasPaused.current = game.manualPaused;
  }, [game.manualPaused, game.phase, game.choice]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      if (panel) close();
      else if (renderReady && game.phase !== 'ready' && game.phase !== 'result')
        pauseGame(!game.manualPaused);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [game, panel, renderReady, pauseGame]);

  return {
    panel,
    arena,
    homecoming,
    modal: panel !== null || game.manualPaused || game.phase === 'result',
    open: (kind: 'guide' | 'settings' | 'quit') => setPanel({ kind }),
    inspectSkill,
    close,
    pause,
    replace,
  };
}
