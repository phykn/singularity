import { GameSession } from '../src/app/GameSession.ts';
import type { Game } from '../src/game/Game.ts';
import type { Card } from '../src/game/rules.ts';

// Drive the shipped session at 60 Hz, including hit stop, choices and orbit-based judgment.
export function playRhythm(
  game: Game,
  choose: (game: Game) => Card = (g) => g.automaticCard!,
  qte = true,
) {
  const session = new GameSession(
    game,
    {
      enabled: false,
      update() {},
      suspend() {},
      destroy() {},
      async unlock() {
        return true;
      },
    },
    { sound: () => false, recordResult() {}, audioUnlocked() {}, redraw() {} },
  );
  session.setRenderReady(true, 0);
  session.begin(0);
  let misses = 0;
  let wall = 0;
  for (let frame = 1; !game.result && game.seconds < 1800; frame++) {
    wall = (frame * 1000) / 60;
    session.step(wall);
    if (game.choice && !game.charged) {
      session.select(choose(game).id, game.choice.number, wall);
      continue;
    }
    const r = session.rhythm;
    if (r.feedback === 'miss' && r.feedbackAge === 0) misses++;
    if (qte && session.rhythmAvailable && r.open && r.due <= r.age) session.tapRhythm(wall);
  }
  session.dispose();
  return {
    completed: session.rhythm.completed,
    hits: game.resonances.length,
    misses,
    wallSeconds: wall / 1000,
  };
}
