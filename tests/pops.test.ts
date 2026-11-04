import test from 'node:test';
import assert from 'node:assert/strict';
import { orbit } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import { renderSound } from '../src/audio/samples.ts';
import { SoundComposer } from '../src/audio/SoundComposer.ts';
import { audioContext } from './audioContext.ts';
import { close, fixture, stationarySkill, target } from './helpers.ts';

const hitsOn = (events: { kind: string; data: unknown; time: number }[], id: number) =>
  events.filter((e) => e.kind === 'hit' && (e.data as { id: number }).id === id);

test('kills in one tick pop in sequence', () => {
  const ts = [0, 1, 2, 3].map((i) => target(i, 200 + i * 10, 140, 1));
  const g = fixture({}, ts);
  for (const t of [...ts]) g.damageTarget(t, 2);
  const kills = g.effects.filter((fx) => fx.kind === 'kill');
  assert.deepEqual(
    kills.map((fx) => fx.delay),
    [0, 0.03, 0.06, 0.09],
  );
  assert.ok(kills.every((fx) => fx.particle === 'quark' && fx.life === 0.4 + fx.delay!));
  g.advance(1000);
  const late = target(9, 220, 150, 1);
  g.targets.push(late);
  g.damageTarget(late, 2);
  assert.equal(g.effects.find((fx) => fx.kind === 'kill')!.delay, 0, 'A later tick starts over');
});

test('static marks detonate as a chain once enough live particles carry one', () => {
  const threshold = rules.skills.mark.threshold[1];
  const ts = Array.from({ length: threshold }, (_, i) => target(i, 160 + i * 9, 140, 1000));
  const g = stationarySkill({ mark: 1 }, ts);
  assert.equal(g.forms.mark.threshold, threshold);
  for (const t of ts.slice(0, threshold - 1)) g.combat.fireBasic(t);
  assert.ok(ts.slice(0, threshold - 1).every((t) => t.marked));
  close(g.combat.status('mark').progress, (threshold - 1) / threshold);
  g.advance(1000);
  assert.equal(ts[threshold - 1].hp, 1000, 'Marks wait for the threshold');
  g.combat.fireBasic(ts[threshold - 1]);
  assert.ok(
    ts.every((t) => !t.marked),
    'Detonation clears every mark',
  );
  let arcs = 0;
  for (let tick = 0; tick < rules.tickRate; tick++) {
    g.advance(1000 / rules.tickRate);
    arcs += g.effects.filter(
      (fx) => fx.kind === 'bolt' && fx.source === 'mark' && fx.born === g.seconds,
    ).length;
  }
  assert.equal(arcs, threshold, 'Each pop draws its own arc');
  for (const t of ts) close(1000 - t.hp, g.damage * (1 + g.forms.mark.damage));
  const pops = ts.map((t) => hitsOn(g.events, t.id).at(-1)!.time).sort((a, b) => a - b);
  for (let i = 1; i < pops.length; i++)
    assert.ok(pops[i] - pops[i - 1] >= rules.skills.mark.popSeconds - 1 / rules.tickRate);
  assert.ok(g.combat.activations.mark !== undefined);
});

test('static detonation pops nearest-first from the electron', () => {
  const g = stationarySkill({ mark: 5 }, []);
  const at = (i: number, distance: number) => {
    const p = orbit(g.angle, g.radius + distance);
    return target(i, p.x, p.y, 1000);
  };
  const ts = [at(0, 60), at(1, 10), at(2, 35), at(3, 20), at(4, 50), at(5, 5)];
  g.targets = ts;
  for (const t of ts) g.combat.fireBasic(t);
  g.advance(1000);
  const order = ts
    .map((t) => ({ id: t.id, time: hitsOn(g.events, t.id).at(-1)!.time }))
    .sort((a, b) => a.time - b.time)
    .map((t) => t.id);
  assert.deepEqual(order, [5, 1, 3, 2, 4, 0]);
});

test('tempo sweeps forward along the orbit on each beat, popping in order', () => {
  const g = stationarySkill({ tempo: 1 }, []);
  const on = (i: number, delta: number, offset = 0) => {
    const p = orbit(g.angle + delta, g.radius + offset);
    return target(i, p.x, p.y, 1000);
  };
  const count = g.forms.tempo.count;
  // Ahead on the orbit, one inside it, one beyond the band and one just behind the electron.
  const ts = [
    ...Array.from({ length: count }, (_, i) => on(i, 0.1 + i * 0.1)),
    on(count, 0.05, -60),
    on(count + 1, 0.07, g.forms.tempo.band + 20),
    on(count + 2, -0.1),
  ];
  g.targets = ts;
  g.combat.sweep(1);
  g.advance(1000);
  const struck = ts
    .filter((t) => t.hp < 1000)
    .map((t) => ({ id: t.id, time: hitsOn(g.events, t.id)[0].time }))
    .sort((a, b) => a.time - b.time)
    .map((t) => t.id);
  assert.deepEqual(
    struck,
    [count, ...Array.from({ length: count - 1 }, (_, i) => i)],
    'Nearest ahead first, inside the orbit included, beyond the band skipped, up to the count',
  );
  for (const id of struck) close(1000 - ts[id].hp, g.damage * g.forms.tempo.damage);

  const h = stationarySkill({ tempo: 1 }, []);
  h.targets = Array.from({ length: 12 }, (_, i) => {
    const p = orbit(h.angle + 0.1 + i * 0.1, h.radius);
    return target(i, p.x, p.y, 1000);
  });
  h.combat.sweep(3);
  h.advance(1000);
  assert.equal(
    h.targets.filter((t) => t.hp < 1000).length,
    h.forms.tempo.count * rules.skills.tempo.finishScale,
  );
});

test('tempo answers accepted beats and stays silent without the skill', () => {
  for (const rank of [0, 1]) {
    const g = stationarySkill({ tempo: rank }, []);
    const p = orbit(g.angle + 0.2, g.radius);
    g.targets = [target(0, p.x, p.y, 1000)];
    assert.ok(g.resonate(1));
    g.advance(500);
    assert.equal(g.combat.activations.tempo !== undefined, rank > 0);
  }
});

test('pops are full keystrokes on varied keycaps and share the hit timing', () => {
  const keys = new Set(
    Array.from({ length: 16 }, (_, i) => renderSound('pop', 48000, i).slice(0, 2000).join()),
  );
  assert.equal(keys.size, 16, 'Each keycap gives its own pop');
  const { ctx } = audioContext();
  const composer = new SoundComposer(ctx, 1);
  const batch = composer.compose([{ kind: 'pop' }, { kind: 'hit' }, { kind: 'pop' }]);
  assert.equal(batch.count, 3);
  assert.deepEqual([...batch.buffers.keys()], ['hit']);
  assert.equal(batch.attacks.length, 3, 'Pops take their own staggered attack like hits');
});

// Combat's own attack builder, so a test hit carries a real attack.
type Begin = { begin: (source: string) => never };
const killDelays = (g: { effects: { kind: string; delay?: number }[] }) =>
  g.effects.filter((fx) => fx.kind === 'kill').map((fx) => fx.delay);

test('each pop style keeps its own rhythm and the kill names its style and particle', () => {
  const { pops } = rules;
  const row = (count: number) =>
    [0, 1, 2, 3].slice(0, count).map((i) => target(i, 200 + i * 10, 140, 1));
  const cases = [
    ['strike', 'burst', [0, 0, 0]],
    ['burst', 'domino', [0, pops.domino.stagger, 2 * pops.domino.stagger]],
    ['charge', 'release', [0, pops.release.stagger, 2 * pops.release.stagger]],
    ['repeat', 'tap', [0, pops.tap.stagger, 2 * pops.tap.stagger]],
  ] as const;
  for (const [source, style, expected] of cases) {
    const ts = row(3);
    const g = fixture({}, ts);
    for (const t of [...ts]) g.damageTarget(t, 2, (g.combat as never as Begin).begin(source));
    killDelays(g).forEach((delay, i) => close(delay!, expected[i]));
    const kills = g.events
      .filter((e) => e.kind === 'kill')
      .map((e) => e.data as Record<string, unknown>);
    assert.ok(
      kills.every((k) => k.style === style && k.particle === 'quark'),
      source,
    );
  }
  const ts = row(3);
  const g = fixture({}, [...ts]);
  g.damageTarget(ts[0], 2, (g.combat as never as Begin).begin('strike'));
  g.damageTarget(ts[1], 2, (g.combat as never as Begin).begin('burst'));
  g.damageTarget(ts[2], 2, (g.combat as never as Begin).begin('burst'));
  assert.deepEqual(killDelays(g), [0, 0, pops.domino.stagger], 'Styles count their own order');
});

test('swept lines pop in order of distance from where the line starts', () => {
  const from = { x: 180, y: 128 };
  const ts = [target(0, 180, 40, 1), target(1, 180, 100, 1), target(2, 180, 70, 1)];
  const g = fixture({}, ts);
  for (const t of [...ts]) g.damageTarget(t, 2, undefined, false, { style: 'sweep', from });
  const delays = killDelays(g) as number[];
  ts.forEach((t, i) =>
    close(delays[i], Math.min(rules.pops.sweep.max, (from.y - t.y) / rules.pops.sweep.speed)),
  );
  assert.ok(delays[1] < delays[2] && delays[2] < delays[0]);
});

test('a forked volley pops its kills together', () => {
  const g = stationarySkill({ multi: 3 }, []);
  const p = (i: number) => orbit(g.angle + 0.05 * (i + 1), g.radius - 20);
  g.targets = [0, 1, 2].map((i) => target(i, p(i).x, p(i).y, 0.5));
  g.combat.fireBasic();
  const kills = g.events
    .filter((e) => e.kind === 'kill')
    .map((e) => e.data as Record<string, unknown>);
  assert.ok(kills.length >= 2, 'The fork reaches several particles');
  assert.ok(kills.every((k) => k.style === 'burst' && !k.delay));
});

test('kill sounds follow the pop: delayed, styled and voiced by particle', async () => {
  const { voiceKeys, voiceTones } = await import('../src/audio/SoundComposer.ts');
  const keys = voiceTones.flatMap((_, v) => voiceKeys(v, 16));
  assert.deepEqual(
    [...keys].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, i) => i),
  );
  assert.equal(new Set(voiceTones).size, 6, 'Each particle has its own tone');
  for (const kind of ['slam', 'enter'] as const)
    assert.notEqual(
      renderSound(kind, 48000, 0).slice(0, 2000).join(),
      renderSound('pop', 48000, 0).slice(0, 2000).join(),
    );
  assert.notEqual(
    renderSound('pop', 48000, 0, voiceTones[3]).slice(0, 2000).join(),
    renderSound('pop', 48000, 0).slice(0, 2000).join(),
  );
  const { ctx } = audioContext();
  const composer = new SoundComposer(ctx, 1);
  const now = composer.compose([{ kind: 'pop', voice: 0 }]).buffers.get('hit')!;
  const later = composer.compose([{ kind: 'pop', voice: 0, delay: 0.2 }]).buffers.get('hit')!;
  close(later.length - now.length, Math.round(0.2 * ctx.sampleRate), 2);
});
