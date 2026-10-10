import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import type { Rarity, SkillId } from '../src/game/rules.ts';
import type { Target } from '../src/game/types.ts';
import { sourceHash } from './engine.ts';

// node scripts/skill-trial.ts [seeds=4] [report] [rulesJson] [common,rare]
// Fixed enemy streams and orbit; direct Combat diagnostics, not natural run clear rates.
const count = Number(process.argv[2] ?? 4);
const output = process.argv[3] ?? 'artifacts/skill-trial.json';
const cfg = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : rules;
const rarities = (process.argv[5]?.split(',') ?? ['common', 'rare']) as Rarity[];
assert.ok(Number.isSafeInteger(count) && count > 0);
assert.ok(rarities.every((r) => ['common', 'rare', 'epic', 'legendary'].includes(r)));
const hash = sourceHash();
const simulationHash = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex');
const duration = 30;
const phases = [
  { name: 'early', time: 30, rank: 1, power: 1, rate: 1, range: 0, radius: 125, mass: 10 },
  { name: 'middle', time: 240, rank: 3, power: 3, rate: 2, range: 1, radius: 100, mass: 50 },
  { name: 'late', time: 480, rank: 5, power: 5, rate: 3, range: 2, radius: 75, mass: 90 },
];
const contexts: SkillId[][] = [[], ['multi', 'chain', 'satellite'], ['focus', 'repeat', 'charge']];
const rows = [];
for (const phase of phases) {
  for (const rarity of rarities) {
    for (let seed = 350000; seed < 350000 + count; seed++) {
      const source = new Game(seed, { rules: cfg, recordEvents: false });
      source.phase = 'running';
      const stream: { at: number; targets: Target[] }[] = [];
      const interval = Math.round(
        cfg.spawnSecondsByStage[phase.name === 'early' ? 0 : phase.name === 'middle' ? 2 : 4] *
          cfg.tickRate,
      );
      assert.ok(
        Number.isSafeInteger(interval) && interval > 0,
        'The ' + phase.name + ' spawn interval must round to a positive safe tick count',
      );
      for (let tick = 0; tick < duration * cfg.tickRate; tick += interval) {
        source.tick = phase.time * cfg.tickRate + tick;
        source.angle = -Math.PI / 2 + (source.speed * tick) / cfg.tickRate / phase.radius;
        source.targets = [];
        source.spawnBatch();
        stream.push({ at: tick, targets: structuredClone(source.targets) });
      }
      for (const context of contexts) {
        for (const id of ['none', ...skillIds.filter((id) => !context.includes(id))]) {
          const g = new Game(seed, { rules: cfg, recordEvents: false });
          g.phase = 'running';
          g.tick = phase.time * cfg.tickRate;
          g.radius = phase.radius;
          g.mass = phase.mass;
          Object.assign(g.boosts, {
            power: phase.power,
            rate: phase.rate,
            range: phase.range,
            speed: 1,
          });
          for (const skill of [...context, ...(id === 'none' ? [] : [id as SkillId])]) {
            g.ranks[skill] = phase.rank;
            g.rarities[skill] = rarity;
          }
          g.combat.reset();
          let damage = 0,
            overkill = 0,
            hits = 0,
            removed = 0;
          const activations: Partial<Record<SkillId, number>> = {};
          const originalHit = g.damageTarget.bind(g);
          g.damageTarget = (target, value, attack) => {
            if (target.hp > 0 && g.targets.includes(target)) {
              damage += Math.min(target.hp, value);
              overkill += Math.max(0, value - target.hp);
              hits++;
            }
            originalHit(target, value, attack);
          };
          const originalLog = g.log.bind(g);
          g.log = (kind, data) => {
            if (kind === 'vent') removed += (data as { removed: number }).removed;
            if (kind === 'skill-effect') {
              const skill = (data as { id: SkillId }).id;
              activations[skill] = (activations[skill] ?? 0) + 1;
            }
            originalLog(kind, data);
          };
          let batch = 0;
          for (let tick = 0; tick < duration * cfg.tickRate; tick++) {
            g.tick = phase.time * cfg.tickRate + tick;
            g.elapsedTicks = g.tick;
            if (stream[batch]?.at === tick) {
              for (const target of structuredClone(stream[batch++].targets)) {
                g.targets.push(target);
                g.counts[target.particle].generated++;
              }
            }
            g.moveTargets();
            g.angle += g.speed / phase.radius / cfg.tickRate;
            g.combat.update();
            g.absorbTargets();
            g.expireEffects();
            g.choice = null;
            g.pendingTicks = 0;
          }
          const killed = Object.values(g.counts).reduce((sum, c) => sum + c.killed, 0);
          const absorbed = Object.values(g.counts).reduce((sum, c) => sum + c.absorbed, 0);
          const generated = Object.values(g.counts).reduce((sum, c) => sum + c.generated, 0);
          assert.equal(generated, killed + absorbed + g.targets.length);
          assert.ok(g.mass >= 0);
          rows.push({
            phase: phase.name,
            rarity,
            seed,
            context: context.join('+') || 'solo',
            id,
            generated,
            killed,
            absorbed,
            mass: g.mass,
            removed,
            damage,
            overkill,
            hits,
            activations,
          });
        }
      }
    }
    console.log('Completed ' + phase.name + ' / ' + rarity);
  }
}
const summary = [];
for (const phase of phases)
  for (const rarity of rarities)
    for (const context of contexts) {
      const group = rows.filter(
        (r) =>
          r.phase === phase.name &&
          r.rarity === rarity &&
          r.context === (context.join('+') || 'solo'),
      );
      const avg = (set: typeof rows, key: 'killed' | 'absorbed' | 'mass' | 'damage' | 'removed') =>
        set.reduce((s, r) => s + r[key], 0) / set.length;
      const base = group.filter((r) => r.id === 'none');
      for (const id of [...new Set(group.map((r) => r.id))]) {
        const set = group.filter((r) => r.id === id);
        summary.push({
          phase: phase.name,
          rarity,
          context: context.join('+') || 'solo',
          id,
          kills: avg(set, 'killed'),
          extraKills: avg(set, 'killed') - avg(base, 'killed'),
          avoidedMass: avg(base, 'mass') - avg(set, 'mass'),
          removed: avg(set, 'removed'),
          effectiveDamage: avg(set, 'damage'),
          extraDamage: avg(set, 'damage') - avg(base, 'damage'),
          activations:
            set.reduce((s, r) => s + (r.activations[id as SkillId] ?? 0), 0) / set.length,
        });
      }
    }
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: hash,
      simulationHash,
      rules: cfg,
      duration,
      phases,
      contexts,
      scope:
        'Controlled 30-second Combat encounters. Identical seeded spawn streams, fixed orbit/stats, equal ranks and skill rarity, no QTE, growth, rush spawning or collision ending. Solo and fourth-slot marginal tests in two three-skill contexts. Measures effective HP removed (overkill excluded), kills and net mass versus a matched baseline. Not human perception or natural clear rate.',
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.table(
  summary
    .filter((r) => r.context === 'solo' && r.rarity === rarities[0] && r.id !== 'none')
    .map((r) => ({
      phase: r.phase,
      skill: r.id,
      extraKills: Number(r.extraKills.toFixed(2)),
      avoidedMass: Number(r.avoidedMass.toFixed(2)),
      extraDamage: Number(r.extraDamage.toFixed(2)),
    })),
);
console.log('Report: ' + output);
