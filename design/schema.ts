import values from './rules.json' with { type: 'json' };

type Check = (value: unknown, path: string, errors: string[]) => void;
export type Spec<T> = { check: Check; optional?: boolean; type?: T };
export type Infer<S> = S extends Spec<infer T> ? T : never;
type Shape = Record<string, Spec<unknown>>;
type Required<S extends Shape> = {
  [K in keyof S as S[K]['optional'] extends true ? never : K]: Infer<S[K]>;
};
type Optional<S extends Shape> = {
  [K in keyof S as S[K]['optional'] extends true ? K : never]?: Infer<S[K]>;
};

const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (min = -Infinity, max = Infinity): Spec<number> => ({
  check: (v, p, e) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      e.push(`${p}: expected a number in [${min}, ${max}], got ${JSON.stringify(v)}`);
  },
});
const int = (min = 0, max = Infinity): Spec<number> => ({
  check: (v, p, e) => {
    if (!Number.isInteger(v)) e.push(`${p}: expected an integer`);
    else num(min, max).check(v, p, e);
  },
});
const flag: Spec<boolean> = {
  check: (v, p, e) => void (typeof v !== 'boolean' && e.push(`${p}: expected a boolean`)),
};
const oneOf = <T extends string>(...values: T[]): Spec<T> => ({
  check: (v, p, e) =>
    void (!values.includes(v as T) && e.push(`${p}: expected ${values.join('|')}`)),
});
const list = <T>(item: Spec<T>, length?: number): Spec<T[]> => ({
  check: (v, p, e) => {
    if (!Array.isArray(v)) return void e.push(`${p}: expected a list`);
    if (length !== undefined && v.length !== length)
      e.push(`${p}: expected ${length} entries, got ${v.length}`);
    v.forEach((x, i) => item.check(x, `${p}[${i}]`, e));
  },
});
const opt = <T>(s: Spec<T>): Spec<T> & { optional: true } => ({ ...s, optional: true });
const obj = <S extends Shape>(shape: S): Spec<Required<S> & Optional<S>> => ({
  check: (v, p, e) => {
    if (!plain(v)) return void e.push(`${p}: expected an object`);
    for (const [key, s] of Object.entries(shape))
      if (key in v) s.check(v[key], `${p}.${key}`, e);
      else if (!s.optional) e.push(`${p}.${key}: missing`);
    for (const key of Object.keys(v)) if (!(key in shape)) e.push(`${p}.${key}: unknown key`);
  },
});
const numbers: Spec<Record<string, number>> = {
  check: (v, p, e) => {
    if (!plain(v)) return void e.push(`${p}: expected an object`);
    for (const [key, x] of Object.entries(v)) num().check(x, `${p}.${key}`, e);
  },
};

// Per-rank tables hold rank 0 (not learned) through the maximum rank.
const ranked = (min = 0) => list(num(min), 6);
const share = num(0, 1);
const pop = oneOf('tap', 'burst', 'domino', 'release', 'sweep');
const particle = obj({
  family: oneOf('small', 'dense'),
  hp: num(0),
  xp: num(0),
  mass: num(0),
  speed: num(0),
  turn: num(),
  size: num(0),
  dash: opt(
    obj({ cycle: num(0), chargeSeconds: num(0), dashSeconds: num(0), speed: num(0), turn: num() }),
  ),
  veiled: opt(flag),
  split: opt(int(1)),
});
const giant = {
  hp: num(1),
  speed: num(0),
  turn: num(),
  size: num(1),
  feedSeconds: num(0),
  summonFractions: list(share),
  summonCount: int(),
};

const schema = obj({
  time: obj({
    tickRate: int(1),
    collisionSeconds: num(0),
    successEndingSeconds: num(0),
    failureEndingSeconds: num(0),
    beyondSeconds: num(0),
    choiceSeconds: num(0),
    bannerSeconds: num(0),
  }),
  orbit: obj({
    radius: num(1),
    speed: num(0),
    gravityPerMass: num(0),
    inwardSpeed: num(0),
    outwardSpeed: num(0),
    coreRadius: num(0),
    coreGrowth: num(0),
    coreGrowthMax: num(0),
    electronRadius: num(0),
    dangerMargin: num(0),
    autoPactMargin: num(0),
    range: num(0),
    spawnRadius: num(1),
  }),
  spawn: obj({
    introBatches: int(),
    introBatchSize: int(1),
    smallBatchSize: int(1),
    denseBatchSize: int(1),
    denseSpacing: num(0),
    pack: obj({ size: list(int(1), 2), spacing: num(0), gap: num(0) }),
    ramp: num(0, 1),
    waveSmall: int(),
    waveDense: int(),
    waveWarningSeconds: num(0),
    variation: obj({
      batchFraction: share,
      intervalFraction: share,
      angleJitter: num(0),
      radiusSpread: num(0),
      speedFraction: share,
      introAngleMin: num(),
      introAngleMax: num(),
    }),
    rush: obj({ windowSeconds: num(0), energyThreshold: num(0) }),
  }),
  stages: list(
    obj({
      start: num(0),
      hp: obj({ small: num(1), dense: num(1) }),
      batchScale: num(0),
      spawnSeconds: num(0.01),
      wave: num(0),
      smallChance: share,
      shares: obj({ muon: share, neutrino: share, meson: share, neutron: share }),
      rush: obj({ spawnSeconds: num(0.01), maxTargets: int() }),
    }),
    5,
  ),
  late: obj({
    assaultSeconds: num(0),
    recoverySeconds: num(0),
    hpPerMinute: num(0),
    speedPerMinute: num(0),
    maxSpeedScale: num(1),
    smallBatchProbability: share,
    muonProbability: share,
    neutronProbability: share,
    recoverySpawnScale: num(0),
    waveRepeatSeconds: num(1),
    waveScale: num(0),
  }),
  particles: obj({
    quark: particle,
    proton: particle,
    muon: particle,
    neutron: particle,
    neutrino: particle,
    meson: particle,
  }),
  formations: obj({
    chance: share,
    minCount: int(),
    previewSeconds: num(0),
    line: obj({ debut: num(0), spacing: num(0) }),
    clump: obj({ debut: num(0), radius: num(0), speed: num(0) }),
    arrow: obj({ debut: num(0), step: num(0), spread: num(0) }),
    star: obj({ debut: num(0), spacing: num(0) }),
    ring: obj({ debut: num(0), scale: num(0) }),
    spiral: obj({ debut: num(0), turns: num(0), step: num(0) }),
    pincer: obj({ debut: num(0) }),
  }),
  bosses: list(
    obj({
      kind: oneOf('gluon', 'w', 'z', 'tau', 'top'),
      time: num(0),
      xp: num(0),
      mass: num(0),
      ...giant,
      behavior: numbers,
    }),
    5,
  ),
  higgs: obj({
    time: num(0),
    ...giant,
    field: obj({
      radius: num(0),
      wideRadius: num(0),
      wideFraction: share,
      speed: num(0),
      hp: num(0),
      mass: num(0),
    }),
  }),
  critical: obj({
    time: num(0),
    pull: num(0),
    spawnScale: num(0),
    hpScale: num(0),
    speedScale: num(0),
    xpScale: num(0),
  }),
  growth: obj({
    levelXp: list(int(1), 25),
    levelXpStep: num(0),
    choiceCount: int(1),
    maxRank: int(5, 5),
    skillSlots: int(1),
    slotKills: list(int(1)),
    autoStatRank: int(),
    rarity: obj(
      Object.fromEntries(
        ['common', 'rare', 'epic', 'legendary'].map((id) => [
          id,
          obj({ chance: num(0, 100), scale: num(0), extra: int() }),
        ]),
      ) as Record<
        'common' | 'rare' | 'epic' | 'legendary',
        Spec<{ chance: number; scale: number; extra: number }>
      >,
    ),
    luck: obj({ rarityShift: num(0) }),
    evolution: obj({ chance: share, luckChance: share, maxChance: share }),
    pacts: obj({ interval: int(1), minSkills: int(), max: int() }),
    recovery: obj({ mass: num(0), minMass: num(0) }),
  }),
  combat: obj({
    baseDamage: num(0),
    powerBonus: num(0),
    powerFalloff: num(0),
    rangeBonus: num(0),
    rangeFalloff: num(0),
    attackSeconds: num(0.01),
    ratePerRank: num(0),
    crit: obj({ perRank: share, max: share, multiplier: num(1) }),
    resonance: obj({ beatDamage: num(0), finishDamage: num(0), finishMass: num(0) }),
    pops: obj({
      tap: obj({ stagger: num(0), max: num(0) }),
      burst: obj({ stagger: num(0), max: num(0), debris: num(0) }),
      domino: obj({ stagger: num(0), max: num(0) }),
      release: obj({ stagger: num(0), max: num(0) }),
      sweep: obj({ speed: num(1), max: num(0) }),
    }),
  }),
  skills: obj({
    repeat: obj({
      pop,
      hits: ranked(1),
      delaySeconds: num(0),
      damage: num(0),
      evolution: obj({ maxExtra: int() }),
    }),
    multi: obj({
      pop,
      primaries: ranked(1),
      spreadCost: num(0),
      evolution: obj({ linkDamage: num(0) }),
    }),
    chain: obj({
      pop,
      hops: ranked(),
      ranges: ranked(),
      falloff: num(0),
      evolution: obj({ loopDamage: num(0) }),
    }),
    pierce: obj({
      pop,
      lengths: ranked(),
      widths: ranked(),
      damage: num(0),
      evolution: obj({
        trailDamage: num(0),
        trailSeconds: num(0),
        trailInterval: num(0.01),
        maxTrails: int(),
      }),
    }),
    burst: obj({
      pop,
      radii: ranked(),
      targets: ranked(),
      damage: ranked(),
      evolution: obj({ depth: int() }),
    }),
    strike: obj({
      pop,
      counts: ranked(),
      range: num(0),
      damage: ranked(),
      periodSeconds: num(0.01),
      splash: obj({ radius: ranked(), damage: num(0) }),
      thunder: obj({ damage: num(0), width: num(0) }),
      evolution: obj({ stormSeconds: num(0.01), damage: num(0) }),
    }),
    satellite: obj({
      pop,
      counts: ranked(),
      ranges: ranked(),
      orbitRadius: num(0),
      angularSpeed: num(),
      damage: num(0),
      periodSeconds: num(0.01),
      evolution: obj({ ringDamage: num(0), width: num(0) }),
    }),
    charge: obj({
      pop,
      threshold: ranked(),
      damage: ranked(),
      evolution: obj({ ringRadius: num(0), damage: num(0) }),
    }),
    surge: obj({
      pop,
      kills: ranked(),
      duration: ranked(),
      damage: num(0),
      tickSeconds: num(0.01),
      windowSeconds: num(0),
      hitCharge: num(0),
      hitIntervalSeconds: num(0),
      evolution: obj({ extendSeconds: num(0), maxExtend: num(0) }),
    }),
    return: obj({
      pop,
      damage: ranked(),
      width: ranked(),
      delaySeconds: num(0),
      evolution: obj({ echoDamage: num(0) }),
    }),
    mark: obj({
      pop,
      threshold: ranked(),
      damage: ranked(),
      popSeconds: num(0),
      evolution: obj({ spread: int(), radius: num(0) }),
    }),
    tempo: obj({
      pop,
      count: ranked(),
      band: ranked(),
      damage: ranked(),
      finishScale: num(0),
      popSeconds: num(0),
      evolution: obj({ damage: num(0) }),
    }),
    spark: obj({
      pop,
      count: ranked(),
      damage: ranked(),
      range: num(0),
      periodSeconds: num(0.01),
      popSeconds: num(0),
      evolution: obj({ bounceDamage: num(0), bounceRange: num(0) }),
    }),
    field: obj({
      pop,
      radius: ranked(),
      damage: ranked(),
      bossFraction: ranked(),
      finalScale: num(0),
      periodSeconds: num(0.01),
      evolution: obj({ radius: num(0), damage: num(0), delaySeconds: num(0) }),
    }),
    fission: obj({
      pop,
      depth: ranked(),
      radius: ranked(),
      damage: ranked(),
      targets: int(),
      delaySeconds: num(0),
      evolution: obj({ radiusGrowth: num(0) }),
    }),
    overcharge: obj({
      pop,
      kills: ranked(),
      damage: ranked(),
      band: ranked(),
      popSeconds: num(0),
      evolution: obj({ delaySeconds: num(0), damage: num(0) }),
    }),
  }),
  pacts: obj({
    overheat: obj({
      rateStep: num(0),
      maxStacks: int(),
      windowSeconds: num(0),
      coolSeconds: num(0),
    }),
    blast: obj({ radius: num(0), damage: num(0), damageScale: num(0) }),
    greed: obj({ xp: num(0), spawn: num(0), depth: int() }),
    quiet: obj({ periodSeconds: num(0.01), damage: num(0) }),
    overclock: obj({ trailAngle: num(0), width: num(0), damage: num(0), zapSeconds: num(0) }),
    pulse: obj({ count: int(), damage: num(0), missMass: num(0) }),
    gamble: obj({ critMultiplier: num(1), normalScale: num(0) }),
    horizon: obj({ damagePerMass: num(0), massSeconds: num(0.01) }),
  }),
  endless: obj({
    roundSeconds: num(1),
    roundHpMultiplier: num(1),
    roundSpeedStep: num(0),
    maxSpeedScale: num(1),
    maxTargets: int(1),
    cycleSeconds: num(1),
    assaultSeconds: num(0),
    recoverySeconds: num(0),
  }),
});

export type Rules = Infer<typeof schema>;

const increasing = (values: number[]) => values.every((v, i) => !i || v > values[i - 1]);

// Relations the per-field ranges cannot express.
function relations(r: Rules): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => void (!ok && errors.push(message));
  need(r.stages[0].start === 0, 'stages[0].start: the first stage starts at 0');
  need(increasing(r.stages.map((s) => s.start)), 'stages[].start: must increase');
  need(r.stages[0].wave === 0, 'stages[0].wave: the first stage opens without a wave');
  need(increasing(r.bosses.map((b) => b.time)), 'bosses[].time: must increase');
  need(r.bosses.at(-1)!.time < r.critical.time, 'critical.time: must follow the last boss');
  need(r.critical.time < r.higgs.time, 'higgs.time: must follow critical.time');
  need(new Set(r.bosses.map((b) => b.kind)).size === 5, 'bosses[].kind: each giant once');
  const evo = r.growth.evolution;
  need(evo.chance <= 0.05, 'growth.evolution.chance: evolution stays rare (at most 0.05)');
  need(evo.maxChance >= evo.chance, 'growth.evolution.maxChance: at least chance');
  need(r.orbit.autoPactMargin > r.orbit.dangerMargin, 'orbit.autoPactMargin: above dangerMargin');
  need(increasing(r.growth.levelXp), 'growth.levelXp: must increase');
  const chances = Object.values(r.growth.rarity).reduce((sum, x) => sum + x.chance, 0);
  need(Math.abs(chances - 100) < 1e-9, 'growth.rarity[].chance: must add up to 100');
  const pack = r.spawn.pack.size;
  need(pack[0] <= pack[1], 'spawn.pack.size: [min, max]');
  const counts: Record<string, number> = {};
  for (const skill of Object.values(r.skills)) counts[skill.pop] = (counts[skill.pop] ?? 0) + 1;
  for (const style of Object.keys(r.combat.pops))
    need((counts[style] ?? 0) >= 2, `skills[].pop: style ${style} needs at least two skills`);
  return errors;
}

export function validate(value: unknown): string[] {
  const errors: string[] = [];
  schema.check(value, 'rules', errors);
  return errors.length ? errors : relations(value as Rules);
}

// `node design/schema.ts` checks the rules file; importing this module checks nothing.
if ((import.meta as { main?: boolean }).main) {
  const errors = validate(values);
  if (errors.length)
    throw new Error(`design/rules.json does not match the schema:\n${errors.join('\n')}`);
  console.log('design/rules.json matches the schema.');
}
