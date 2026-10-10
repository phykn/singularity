import test from 'node:test';
import assert from 'node:assert/strict';
import { ChoiceInput } from '../src/ui/ChoiceInput.ts';
import type { Choice } from '../src/game/types.ts';

const choice = (number = 1): Choice => ({ number, opened: 0, deadline: 5, cards: [] });

test('a fresh single tap selects after appearance protection, using wall time', () => {
  const input = new ChoiceInput();
  input.show(choice(), 1000);
  input.down(1, 1450);
  assert.equal(input.up(1, 1470), true);
});

test('a touch begun during protection stays rejected even when held past it', () => {
  const input = new ChoiceInput();
  input.show(choice(), 0);
  input.down(1, 100);
  assert.equal(input.up(1, 800), false);
  assert.equal(input.remaining(999), 1);
  input.down(2, 1000);
  assert.equal(input.up(2, 1020), true);
});

test('continued rapid taps cannot select after the initial appearance delay', () => {
  const input = new ChoiceInput();
  input.show(choice(), 0);
  for (let now = 50; now <= 950; now += 100) {
    input.down(1, now);
    assert.equal(input.up(1, now + 20), false);
  }
  input.down(1, 1170);
  assert.equal(input.up(1, 1190), true);
});

test('a gesture from gameplay or a previous choice cannot select the new choice', () => {
  const input = new ChoiceInput();
  input.down(1, 0);
  input.show(choice(), 20);
  assert.equal(input.up(1, 800), false);
  input.down(2, 1000);
  input.show(choice(2), 1010);
  assert.equal(input.up(2, 1600), false);
});

test('secondary touches, cancellation and loss of focus cannot leave an armed gesture', () => {
  const input = new ChoiceInput();
  input.show(choice(), 0);
  input.down(1, 500);
  input.down(2, 520);
  assert.equal(input.up(2, 540), false);
  assert.equal(input.up(1, 560), false);
  input.down(1, 800);
  assert.equal(input.up(1, 820, true), false);
  input.down(1, 1050);
  input.cancel(1100);
  assert.equal(input.up(1, 1400), false);
  input.down(2, 1400);
  assert.equal(input.up(2, 1420), true);
});
