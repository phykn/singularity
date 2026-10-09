import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { endingFrame } from '../src/render/ending.ts';
import { drawCollapse } from '../src/render/collapse.ts';
import { drawSingularity, drawAccretion } from '../src/render/singularity.ts';
import type Phaser from 'phaser';
import { KillRhythm, SoundMixer } from '../src/app/sounds.ts';

test('singularity disk is compact, occluded and quiet after its one-time light sweep', () => {
  for (const scale of [0.65, 1, 1.75]) {
    const commands: { name: string; args: number[] }[] = [];
    const graphics = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args: number[]) => {
            assert.ok(args.every(Number.isFinite));
            commands.push({ name: String(name), args });
          },
      },
    ) as Phaser.GameObjects.Graphics;
    drawSingularity(graphics, 24, scale);
    const disk = commands.findIndex((c) => c.name === 'fillCircle');
    assert.ok(disk > 0 && disk < commands.length - 1, 'Back light, black center, then front light');
    assert.equal(commands.filter((c) => c.name === 'fillCircle').length, 1);
    assert.ok(!commands.some((c) => c.name === 'strokeCircle' || c.name === 'fillRect'));
    for (const { args } of commands.filter((c) => c.name === 'lineBetween')) {
      for (let i = 0; i < 4; i += 2) {
        assert.ok(Math.hypot(args[i] - 180, args[i + 1] - 260) <= 40 + 2 / scale);
        const x = (args[i] - 180) * scale,
          y = (args[i + 1] - 260) * scale;
        assert.ok(Math.abs(x - Math.round(x)) < 1e-8 && Math.abs(y - Math.round(y)) < 1e-8);
      }
    }
    const baseline = structuredClone(commands);
    commands.length = 0;
    drawSingularity(graphics, 24, scale);
    assert.deepEqual(commands, baseline, 'No ambient jitter after the ending settles');
    commands.length = 0;
    drawAccretion(graphics, 2.1, scale);
    drawSingularity(graphics, 0, scale);
    assert.deepEqual(commands, [], 'No lingering dust or disk after contraction to a point');
  }
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
    let core = 1;
    let hud = 1;
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
      assert.ok(frame.hole >= 0 && frame.hole <= 24, 'The singularity stays at the center');
      assert.ok(frame.glow >= 0 && frame.glow <= 1);
      assert.ok(frame.hud >= 0.219 && frame.hud <= hud + 1e-8);
      hud = frame.hud;
      if (success && game.phase === 'collapse') {
        assert.ok(frame.core <= core && frame.core >= 0);
        core = frame.core;
      }
      if (frame.stage === 'quiet') {
        assert.equal(frame.hole, 24);
        assert.equal(frame.glow, 0);
        assert.equal(frame.flash, 0);
      }
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
    if (success) {
      assert.equal(endingFrame(game)!.hole, 24);
      assert.equal(endingFrame(game)!.hud, 0.22);
      assert.equal(core, 0);
    }
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
