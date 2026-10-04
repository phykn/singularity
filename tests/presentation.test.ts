import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/model.ts';
import { endingFrame } from '../src/render/ending.ts';
import { KillRhythm, SoundMixer } from '../src/app/sounds.ts';

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
      const before = game.checkpoint();
      const frame = endingFrame(game)!;
      assert.ok(frame);
      assert.deepEqual(game.checkpoint(), before);
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
