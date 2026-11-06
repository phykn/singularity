import { GameSession } from '../src/app/GameSession.ts';
import type { Game } from '../src/game/Game.ts';
import { isPact, isSkill, rarityScale } from '../src/game/rules.ts';
import type { Card, SkillId } from '../src/game/rules.ts';

// A reproducible, visible-state choice heuristic; this is not a human clear-rate estimate.
const strength: Record<SkillId, number> = {
  multi: 10,
  chain: 9,
  repeat: 8,
  pierce: 8,
  burst: 7,
  spark: 7,
  strike: 6,
  satellite: 6,
  field: 6,
  fission: 6,
  overcharge: 5,
  charge: 4,
  surge: 4,
  return: 4,
  mark: 4,
  tempo: 4,
};
function value(g: Game, card: Card) {
  const { id, rarity } = card;
  if (card.evolve) return 40;
  if (isPact(id)) return g.margin > g.rules.autoPactMargin ? 11 : 0;
  const scale = rarityScale(rarity, g.rules);
  if (id === 'recover') return g.margin < 30 ? 30 : g.mass > 65 ? 10 : 1;
  if (id === 'power') return (g.boosts.power < 3 ? 12 : 7) * scale;
  if (id === 'rate') return (g.boosts.rate < 3 ? 9 : 5) * scale;
  if (id === 'range') return (g.boosts.range < 2 ? 6 : 3) * scale;
  if (id === 'crit') return (g.boosts.crit < 4 ? 7 : 2) * scale;
  if (id === 'luck') return 3 * scale;
  if (isSkill(id)) return strength[id] * scale * (g.ranks[id] ? 1.15 : 1);
  return 0;
}
export const guidedCard = (g: Game): Card =>
  g.choice!.cards.reduce((a, b) => (value(g, b) > value(g, a) ? b : a));

// Drive the shipped session at 60 Hz, including hit stop, choices and orbit-based judgment.
export function playRhythm(
  game: Game,
  choose: (game: Game) => Card = (g) => g.automaticCard!,
  qte = true,
  onFrame?: () => void,
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
    onFrame?.();
    if (game.choice) {
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
    hits: game.resonances.filter((input) => input.beat > 0).length,
    misses,
    wallSeconds: wall / 1000,
  };
}
