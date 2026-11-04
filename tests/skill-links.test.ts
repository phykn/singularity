import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { blankRanks, rules, skillIds } from '../src/game/rules.ts';
import type { RuleSet, SkillId } from '../src/game/rules.ts';
import type { TimedSkill } from '../src/game/skills.ts';
import type { Target } from '../src/game/types.ts';
import { skillLinks } from '../src/ui/skillText.ts';
import { copy, languages } from '../src/ui/i18n.ts';
import { target } from './helpers.ts';

const instantCharge: RuleSet = {
  ...rules,
  skills: { ...rules.skills, charge: { ...rules.skills.charge, threshold: Array(6).fill(1) } },
};
const slowCharge: RuleSet = {
  ...rules,
  skills: { ...rules.skills, charge: { ...rules.skills.charge, threshold: Array(6).fill(1e6) } },
};

function scene(skills: SkillId[], cfg: RuleSet = rules, hp?: (index: number) => number) {
  const game = new Game(42, { combat: false, rules: cfg });
  game.start();
  game.ranks = { ...blankRanks(), ...Object.fromEntries(skills.map((id) => [id, 1])) };
  const { x, y } = game.position;
  const targets: Target[] = [];
  // Wounded and fragile enemies along the orbit, so kills can arc and strikes can aim.
  for (let i = 0; i < 24; i++) {
    const angle = game.angle + (i - 6) * 0.08,
      radius = game.radius + (i % 3) * 14;
    const enemy = target(
      i,
      180 + Math.cos(angle) * radius,
      260 + Math.sin(angle) * radius,
      hp?.(i) ?? 1e6,
    );
    enemy.maxHp = enemy.hp / 0.05;
    targets.push(enemy);
  }
  game.targets = targets.sort(
    (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
  );
  return game;
}

function fire(game: Game, id: SkillId) {
  if (id === 'surge') {
    for (let i = 0; i < 100 && !game.combat.status('surge').active; i++)
      game.combat.killed(target(-1, 0, 0, 1));
  } else game.combat.fireSkill(id as TimedSkill);
  game.advance(800);
}

function hits(game: Game) {
  return game.events.flatMap((event) =>
    event.kind === 'hit' ? [event.data as { damage: number }] : [],
  );
}

const chargeProgress = (skills: SkillId[]) => {
  const game = scene(['charge', ...skills], slowCharge);
  game.combat.fireBasic();
  game.advance(800);
  return game.combat.status('charge').progress;
};

function linked(effect: SkillId, attacker: SkillId): void {
  const label = `${effect} on ${attacker}`;
  if (effect === 'charge') {
    const baseline = chargeProgress([]);
    assert.ok(chargeProgress([attacker]) > baseline, label);
    return;
  }
  if (attacker === 'charge' || attacker === 'return') {
    const power = rules.baseHitDamage;
    if (effect === 'burst') {
      // Enemy 6 is nearest. It survives the basic hit, so only the linked follow-up can land the kill.
      const game = scene(['burst', attacker], attacker === 'charge' ? instantCharge : rules, (i) =>
        i === 6 ? power + 1 : 1e6,
      );
      game.combat.fireBasic();
      game.advance(800);
      assert.ok(game.combat.activations.burst !== undefined, label);
      return;
    }
    const game = scene([effect, attacker], attacker === 'charge' ? instantCharge : rules);
    game.combat.fireBasic();
    game.advance(800);
    const forms = game.forms;
    const source =
      attacker === 'charge' ? power * forms.charge.damage : power * forms.return.damage;
    const damage =
      source * (effect === 'chain' ? rules.skills.chain.falloff : rules.skills.pierce.damage);
    assert.ok(
      hits(game).some((hit) => Math.abs(hit.damage - damage) < 1e-6),
      label,
    );
    return;
  }
  const game = scene([effect, attacker], rules, effect === 'burst' ? () => 0.5 : undefined);
  fire(game, attacker);
  assert.ok(game.combat.activations[effect] !== undefined, label);
}

test('every link shown on a card is a real combat interaction', () => {
  let pairs = 0;
  for (const id of skillIds)
    for (const other of skillIds) {
      if (id === other) continue;
      const [link] = skillLinks(id, [other]);
      if (!link) continue;
      assert.equal(link.skill, other);
      pairs++;
      linked(link.effect, link.effect === id ? other : id);
    }
  assert.ok(pairs > 0);
});

test('links are selective: Spark and Static Field ignore Fork and Repeat', () => {
  for (const attacker of ['spark', 'field'] as const)
    for (const effect of ['multi', 'repeat'] as const) {
      assert.deepEqual(skillLinks(effect, [attacker]), []);
      const game = scene([effect, attacker]);
      fire(game, attacker);
      assert.equal(game.combat.activations[effect], undefined, `${effect} on ${attacker}`);
    }
  for (const id of ['fission', 'overcharge', 'tempo'] as const)
    assert.deepEqual(skillLinks(id, skillIds), []);
  assert.deepEqual(skillLinks('power', skillIds), []);
  assert.deepEqual(skillLinks('strike', ['satellite', 'spark']), []);
  assert.deepEqual(skillLinks('chain', ['chain']), []);
});

test('a card names each linked owned skill in order, and every language has the text', () => {
  assert.deepEqual(skillLinks('strike', ['chain', 'satellite', 'charge']), [
    { skill: 'chain', effect: 'chain' },
  ]);
  assert.deepEqual(skillLinks('chain', ['strike', 'satellite']), [
    { skill: 'strike', effect: 'chain' },
    { skill: 'satellite', effect: 'chain' },
  ]);
  const effects = new Set(
    skillIds.flatMap((id) => skillLinks(id, skillIds).map((link) => link.effect)),
  );
  for (const { id } of languages) {
    assert.ok(copy[id].link);
    for (const effect of effects) assert.ok(copy[id].links[effect], `${id} ${effect}`);
  }
  assert.equal(effects.size, 7);
});
