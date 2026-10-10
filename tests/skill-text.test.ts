import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, choose } from './helpers.ts';
import { skillValue } from '../src/ui/skillText.ts';
import { copy, languages } from '../src/ui/i18n.ts';
import { numberText } from '../src/format.ts';

test('equipped skill values include the current Multi and range synergies in every language', () => {
  const game = fixture();
  for (let i = 0; i < 5; i++) choose(game, 'multi', 'legendary');
  for (const id of ['strike', 'repel', 'bridge'] as const) choose(game, id);
  game.boosts.range = 3;
  const forms = game.forms;
  assert.equal(forms.multi.count, 8);
  assert.ok(forms.bridge.angle > game.rules.skills.bridge.angles[1]);
  for (const { id: language } of languages) {
    const text = (id: 'strike' | 'repel' | 'bridge') =>
      skillValue(id, game.rank(id), game.rarities[id], language, game.rules, game.reach, forms);
    const metric = copy[language].metric;
    assert.ok(text('strike').startsWith(metric.targets(String(forms.strike.count + 7))));
    assert.ok(text('repel').startsWith(metric.targets(String(forms.repel.count + 7))));
    assert.ok(text('bridge').startsWith(numberText(forms.bridge.angle) + '°'));
    assert.notEqual(text('bridge'), skillValue('bridge', 1, 'common', language));
  }
});
