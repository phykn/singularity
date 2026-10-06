import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { endingFrame } from '../src/render/ending.ts';
import { drawCollapse } from '../src/render/collapse.ts';
import type Phaser from 'phaser';
import { introFrame } from '../src/render/intro.ts';
import { KillRhythm, SoundMixer } from '../src/app/sounds.ts';

test('title pulses briefly and contracts smoothly without enlarging the electron or moving in reduced motion', () => {
  assert.equal(introFrame(3.5, null).pulse, 0);
  assert.ok(introFrame(3.92, null).pulse > 0.99);
  assert.equal(introFrame(4.2, null).pulse, 0);
  let radius = 1;
  for (let i = 0; i <= 30; i++) {
    const frame = introFrame(3.92, i / 30);
    assert.ok(Object.values(frame).every(Number.isFinite));
    assert.ok(frame.radius <= radius);
    assert.ok(frame.radius >= 0.099 && frame.core > 0);
    assert.ok(frame.alpha >= 0 && frame.alpha <= 1);
    radius = frame.radius;
    const reduced = introFrame(i, i / 30, true);
    assert.equal(reduced.radius, 1);
    assert.equal(reduced.core, 1);
    assert.equal(reduced.pulse, 0);
    assert.equal(reduced.angle, -0.65);
  }
  assert.deepEqual(introFrame(0, null, true), introFrame(100, null, true));
});

test('kill rhythm increases with kills, caps its rate and never drains a backlog', () => {
  const run = (killsPerSecond: number) => {
    const rhythm = new KillRhythm();
    const pulses: number[] = [];
    let kills = 0;
    for (let frame = 0; frame < 1200; frame++) {
      const time = frame / 120;
      const total = Math.floor(time * killsPerSecond);
      rhythm.add(total - kills, time);
      kills = total;
      if (rhythm.update(time) !== null) pulses.push(time);
    }
    assert.equal(rhythm.update(10.3), null, 'No stale sound after combat stops');
    for (let i = 1; i < pulses.length; i++) assert.ok(pulses[i] - pulses[i - 1] >= 1 / 12 - 1e-8);
    return pulses.length;
  };
  const counts = [1, 6, 20, 200].map(run);
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
  assert.ok(counts[3] <= 120);
  const rhythm = new KillRhythm();
  rhythm.add(10000, 0);
  assert.notEqual(rhythm.update(0), null);
  assert.equal(rhythm.update(0.25), null);
  rhythm.reset();
  assert.equal(rhythm.update(0.26), null);
});

test('sound voices stay bounded and their nodes disconnect after playback or mute', () => {
  const nodes: { end: number; onended: () => void; disconnected: boolean }[] = [];
  const param = () => ({
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
    setTargetAtTime() {},
  });
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const node = {
        end: 0,
        onended: () => {},
        disconnected: false,
        frequency: param(),
        type: '',
        start() {},
        stop(end: number) {
          this.end = end;
        },
        connect(gain: unknown) {
          return gain;
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      nodes.push(node);
      return node;
    },
    createGain() {
      return { gain: param(), connect() {}, disconnect() {} };
    },
  };
  const mixer = new SoundMixer(context as unknown as BaseAudioContext);
  for (let i = 0; i < 100; i++)
    for (const kind of ['hit', 'dense', 'kill', 'wave', 'charged', 'level']) mixer.play(kind);
  assert.equal(nodes.length, 8);
  mixer.stop();
  assert.ok(nodes.every((node) => node.end <= 0.008));
  nodes.forEach((node) => node.onended());
  assert.ok(nodes.every((node) => node.disconnected));
  assert.ok(mixer.play('hit'), 'Muted voices cannot occupy the next playback budget');
});

for (const success of [true, false]) {
  test(`${success ? 'success' : 'failure'} ending has a bounded, quiet finish without changing game state`, () => {
    const game = new Game(17, { combat: false });
    assert.equal(endingFrame(game), null);
    game.start();
    if (success) game.debugSetXp(game.rules.energyGoal);
    else {
      game.mass = 1000;
      game.radius = game.core + game.rules.electronRadius;
    }
    game.advance(1000 / game.rules.tickRate);
    const stages: string[] = [];
    let quietFrames = 0;
    let radius = Infinity;
    for (let i = 0; i < 400 && !game.result; i++) {
      const before = JSON.stringify(game, (key, value) => (key === 'combat' ? undefined : value));
      const frame = endingFrame(game)!;
      assert.ok(frame);
      assert.equal(
        JSON.stringify(game, (key, value) => (key === 'combat' ? undefined : value)),
        before,
      );
      if (stages.at(-1) !== frame.stage) stages.push(frame.stage);
      if (frame.electron) {
        assert.ok(frame.radius <= radius + 1e-8);
        radius = frame.radius;
      }
      if (frame.quiet) {
        assert.equal(frame.electron, null);
        quietFrames++;
      }
      assert.ok(frame.expansion >= 0 && frame.expansion <= 1);
      if (frame.reveal > 0)
        assert.equal(frame.expansion, 1, 'The title returns only after full coverage');
      game.advance(1000 / game.rules.tickRate);
    }
    assert.deepEqual(
      stages,
      success
        ? ['accelerate', 'compress', 'silence', 'formation', 'settle', 'quiet']
        : ['unstable', 'spiral', 'impact', 'empty'],
    );
    assert.ok(quietFrames >= 30);
    assert.ok(game.result);
    if (success) assert.ok(endingFrame(game)!.reveal > 1 - 1e-8);
    assert.ok(game.seconds >= (success ? 4 : 2) && game.seconds <= (success ? 5 : 3));
  });
}

test('collapse reaches the visible core rim and discharges there briefly at every screen scale', () => {
  const game = new Game(17, { combat: false });
  game.start();
  game.mass = 1000;
  game.radius = game.core + game.rules.electronRadius;
  game.advance(1000 / game.rules.tickRate);
  game.phaseTicks = Math.round(game.rules.collisionSeconds * game.rules.tickRate);
  const last = endingFrame(game)!;
  assert.ok(last.electron && last.contact);
  assert.ok(Math.hypot(last.electron.x - last.contact.x, last.electron.y - last.contact.y) < 2);
  assert.ok(Math.hypot(last.contact.x - 180, last.contact.y - 260) > game.core * 0.9);
  game.phaseTicks--;
  game.advance(1000 / game.rules.tickRate);
  const impact = endingFrame(game)!;
  assert.equal(impact.stage, 'impact');
  assert.equal(impact.electron, null);
  for (const scale of [0.65, 1, 1.75]) {
    const commands: { name: string; args: number[] }[] = [];
    const graphics = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args: number[]) =>
            commands.push({ name: String(name), args }),
      },
    );
    drawCollapse(graphics as Phaser.GameObjects.Graphics, impact, scale);
    assert.ok(commands.every(({ args }) => args.every(Number.isFinite)));
    const contact = commands.find(({ name }) => name === 'fillRect')!.args;
    assert.ok(Math.abs(contact[0] + contact[2] / 2 - impact.contact!.x) < 1e-8);
    assert.ok(Math.abs(contact[1] + contact[3] / 2 - impact.contact!.y) < 1e-8);
    assert.equal(contact[2] * scale, 2);
    const orbitCommands: typeof commands = [];
    const orbitGraphics = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args: number[]) =>
            orbitCommands.push({ name: String(name), args }),
      },
    );
    drawCollapse(orbitGraphics as Phaser.GameObjects.Graphics, last, scale);
    const start = orbitCommands.find(({ name }) => name === 'moveTo')!.args;
    const end = orbitCommands.filter(({ name }) => name === 'lineTo').at(-1)!.args;
    assert.ok(Math.hypot(start[0] - end[0], start[1] - end[1]) > game.core);
  }
  game.advance(250);
  const empty = endingFrame(game)!;
  assert.equal(empty.flash, 0);
  assert.equal(empty.quiet, true);
});
