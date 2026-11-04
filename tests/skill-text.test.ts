import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, choose } from './helpers.ts';
import { skillValue } from '../src/ui/skillText.ts';
import { copy, languages } from '../src/ui/i18n.ts';
import { numberText } from '../src/format.ts';

test('equipped skill values include the current Multi and range synergies in every language', () => {
  const game = fixture();
  for (let i = 0; i < 5; i++) choose(game, 'multi', 'legendary');
  for (const id of ['strike', 'satellite', 'field'] as const) choose(game, id);
  game.boosts.range = 3;
  const forms = game.forms;
  assert.equal(forms.multi.count, 7);
  assert.ok(forms.field.radius > game.rules.skills.field.radius[1]);
  for (const { id: language } of languages) {
    const text = (id: 'strike' | 'satellite' | 'field') =>
      skillValue(id, game.rank(id), game.rarities[id], language, game.rules, game.reach, forms);
    const metric = copy[language].metric;
    assert.ok(text('strike').startsWith(metric.targets(String(forms.strike.count + 6))));
    assert.ok(text('satellite').startsWith(metric.satellites(String(forms.satellite.count))));
    assert.ok(text('field').startsWith(`${metric.radius} ${numberText(forms.field.radius)}`));
    assert.notEqual(text('field'), skillValue('field', 1, 'common', language));
  }
});
