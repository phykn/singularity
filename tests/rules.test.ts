import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '../design/schema.ts';
import { rules } from '../src/game/rules.ts';

const copy = () => structuredClone(rules);

test('the rules file matches its schema', () => {
  assert.deepEqual(validate(rules), []);
});

test('reversed stage starts fail the schema', () => {
  const cfg = copy();
  [cfg.stages[1].start, cfg.stages[2].start] = [cfg.stages[2].start, cfg.stages[1].start];
  assert.ok(validate(cfg).some((e) => e.includes('stages[].start')));
});

test('a common evolution fails the schema', () => {
  const cfg = copy();
  cfg.growth.evolution.chance = 0.1;
  cfg.growth.evolution.maxChance = 0.2;
  assert.ok(validate(cfg).some((e) => e.includes('evolution.chance')));
});

test('unknown and missing keys fail the schema', () => {
  const cfg = copy() as unknown as Record<string, Record<string, unknown>>;
  cfg.orbit.extra = 1;
  delete cfg.time.tickRate;
  const errors = validate(cfg);
  assert.ok(errors.includes('rules.orbit.extra: unknown key'));
  assert.ok(errors.includes('rules.time.tickRate: missing'));
});
