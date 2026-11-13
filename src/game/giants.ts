import type { Game } from './Game.ts';
import { TAU, distance, orbit } from './geometry.ts';
import type { BossKind, Rules } from './rules.ts';
import type { BannerKind, Target } from './types.ts';

type Giant = Rules['bosses'][number] | Rules['higgs'];

// One rule per giant particle, read from its age so views and the model agree.
function bossPhase(kind: BossKind, age: number, b: Record<string, number>) {
  const phase = { speed: 1, charging: false, dashing: false, warning: false, immune: false },
    t = age + 1e-8;
  if (kind === 'z') {
    const at = t % b.period;
    phase.immune = at >= b.period - b.immuneSeconds;
    phase.warning = !phase.immune && at >= b.period - b.immuneSeconds - b.warnSeconds;
  } else if (kind === 'tau') {
    const at = t % b.cycle;
    phase.charging = at < b.chargeSeconds;
    phase.dashing = !phase.charging && at < b.chargeSeconds + b.dashSeconds;
    phase.speed = phase.charging ? 0 : phase.dashing ? b.dashSpeed : 1;
  } else if (kind === 'top') phase.speed = b.speed;
  return phase;
}

// The giant particles and the Higgs: when they come, what they do to the field, and the
// rounds they close. Bosses keep their times even while an earlier one is still alive.
export class Giants {
  // Listed giants that have arrived, and those popped.
  count = 0;
  down = 0;
  // Ended giants + 1; a later giant that ends first waits for the earlier one.
  round = 1;
  higgsDown = false;
  private readonly game: Game;
  // Slot r - 1 holds round r's giant.
  private order: number[] = [];
  private ended = new Set<number>();
  private higgsEntered = false;
  // The endless second the current round began.
  private roundFrom = 0;

  constructor(game: Game) {
    this.game = game;
  }

  get boss(): Target | undefined {
    const targets = this.game.targets;
    return targets.find((t) => t.final) ?? targets.find((t) => t.kind === 'boss');
  }
  // Endless rounds cleared so far; each one is a step harder.
  get endlessRounds(): number {
    return this.game.endless ? this.round - this.game.rules.bosses.length - 2 : 0;
  }
  // How far the current endless round is toward its giant, from 0 to 1.
  get roundProgress(): number {
    const g = this.game;
    return Math.min(1, (g.endlessSeconds - this.roundFrom) / g.rules.endless.roundSeconds);
  }
  // How far the run is toward the Higgs particle's arrival, from 0 to 1.
  get higgsProgress(): number {
    return Math.min(1, this.game.time / this.game.rules.higgs.time);
  }
  // A giant particle on the field feeds the core one mass every `feedSeconds`.
  get feeding(): boolean {
    const g = this.game,
      boss = this.boss;
    return (
      !!boss && g.tick % Math.round(this.rules(boss).feedSeconds * g.rules.time.tickRate) === 0
    );
  }

  // Endless mode opens the round after the Higgs; the cleared rounds' slots stay behind.
  beyond(): void {
    this.higgsDown = false;
    this.round = this.game.rules.bosses.length + 2;
    this.roundFrom = 0;
    this.order.length = this.round - 1;
  }

  // In endless mode one giant comes `roundSeconds` into each round, in boss order, and only
  // once it has ended does the next round, and the next step in strength, begin.
  arrive(): void {
    const g = this.game,
      bosses = g.rules.bosses;
    if (g.endless) {
      const giant = bosses[this.endlessRounds % bosses.length];
      if (
        this.order.length < this.round &&
        g.endlessSeconds - this.roundFrom + 1e-8 >= g.rules.endless.roundSeconds
      )
        this.add(giant, giant.kind, 'boss');
      return;
    }
    const next = bosses[this.count];
    if (next && g.time >= next.time) {
      this.count++;
      this.add(next, next.kind, 'boss');
    } else if (!next && !this.higgsEntered && g.time >= g.rules.higgs.time) {
      this.higgsEntered = true;
      this.add(g.rules.higgs, 'higgs', 'final-boss');
      g.log('charged', { time: g.time });
    }
  }

  private add(giant: Giant, kind: BossKind, banner: 'boss' | 'final-boss'): void {
    const g = this.game,
      theta = g.spawner.random.next() * TAU,
      radius = g.rules.orbit.spawnRadius,
      hp = Math.round(giant.hp * g.enemyStrength.hp),
      reward = 'xp' in giant ? giant : { xp: 0, mass: 0 };
    const target: Target = {
      id: g.nextId++,
      ...orbit(theta, radius),
      angle: theta,
      radius,
      kind: 'boss',
      boss: kind,
      particle: 'neutron',
      born: g.time,
      hp,
      maxHp: hp,
      xp: reward.xp,
      mass: reward.mass,
      speed: giant.speed,
      turn: giant.turn,
      size: giant.size,
      summonCount: giant.summonCount,
      ...(kind === 'higgs' && { final: true }),
    };
    g.targets.push(target);
    this.order.push(target.id);
    this.announce(banner, kind);
    g.log(banner, { id: target.id, hp, boss: kind });
    if ('behavior' in giant && kind === 'gluon')
      g.spawner.spawnAround(
        target,
        'quark',
        giant.behavior.tethered,
        giant.behavior.distance,
        target,
      );
  }

  private announce(kind: BannerKind, boss?: BossKind): void {
    const g = this.game;
    g.banner = { kind, until: g.time + g.rules.time.bannerSeconds, boss };
  }

  private rules(target: Target): Giant {
    const cfg = this.game.rules;
    return cfg.bosses.find((b) => b.kind === target.boss) ?? cfg.higgs;
  }

  private behavior(target: Target): Record<string, number> {
    const giant = this.rules(target);
    return 'behavior' in giant ? giant.behavior : {};
  }

  phase(target: Target, offset = 0) {
    if (!target.boss) return undefined;
    return bossPhase(target.boss, this.game.time + offset - target.born, this.behavior(target));
  }

  higgsField(boss: Target): number {
    const cfg = this.game.rules.higgs.field;
    return boss.hp / boss.maxHp < cfg.wideFraction ? cfg.wideRadius : cfg.radius;
  }

  // What giants do to their surroundings, once per tick.
  act(): void {
    const g = this.game,
      tickRate = g.rules.time.tickRate;
    for (const boss of g.targets.filter((t) => t.boss)) {
      const ticks = Math.round((g.time - boss.born) * tickRate),
        b = this.behavior(boss);
      if (boss.boss === 'w') {
        // The W boson turns nearby quarks into dashing muons.
        if (ticks <= 0 || ticks % Math.round(b.seconds * tickRate)) continue;
        const near = g.targets
          .filter((t) => t.particle === 'quark' && t.tether === undefined)
          .map((t) => ({ t, d: distance(t, boss) }))
          .filter(({ d }) => d <= b.radius)
          .sort((x, y) => x.d - y.d || x.t.id - y.t.id)
          .slice(0, b.count);
        for (const { t } of near) {
          t.particle = 'muon';
          t.born = g.time;
        }
        if (!near.length) continue;
        g.addEffect({
          kind: 'convert',
          from: boss,
          to: boss,
          radius: b.radius,
          width: 1,
          life: 0.5,
          particle: 'muon',
        });
        g.log('convert', { id: boss.id, ids: near.map(({ t }) => t.id) });
      } else if (boss.boss === 'tau') {
        // The tau drops muons as each dash ends.
        if (ticks > 0 && this.phase(boss, -1 / tickRate)!.dashing && !this.phase(boss)!.dashing)
          g.spawner.spawnAround(boss, 'muon', b.drops, boss.size + 4);
      } else if (boss.boss === 'higgs') {
        // Particles inside the Higgs field slow down but grow tougher and heavier.
        const field = this.higgsField(boss),
          cfg = g.rules.higgs.field;
        for (const t of g.targets) {
          if (t.boss || t.higgs || distance(t, boss) > field) continue;
          t.higgs = true;
          t.speed *= cfg.speed;
          t.hp *= cfg.hp;
          t.maxHp *= cfg.hp;
          t.mass *= cfg.mass;
        }
      }
    }
  }

  // The gluon shrugs off most damage while it still holds quarks.
  shield(target: Target): number {
    return target.boss === 'gluon' && this.game.targets.some((t) => t.tether === target.id)
      ? this.behavior(target).damageScale
      : 1;
  }

  // A wounded giant calls escorts each time its health crosses a listed fraction.
  summon(boss: Target): void {
    const fractions = this.rules(boss).summonFractions,
      spawner = this.game.spawner;
    boss.summons ??= 0;
    while (boss.summons < fractions.length && boss.hp / boss.maxHp <= fractions[boss.summons]) {
      boss.summons++;
      // The top quark splits into a swarm of mesons instead of calling quarks.
      if (boss.boss === 'top') spawner.spawnAround(boss, 'meson', boss.summonCount!, boss.size + 8);
      else spawner.spawnGroup('small', boss.summonCount!, boss.angle, 1, boss.radius);
    }
  }

  // A giant that popped or reached the core closes its round once the earlier ones have.
  end(id: number): void {
    const g = this.game;
    this.ended.add(id);
    while (this.ended.has(this.order[this.round - 1])) {
      this.round++;
      this.roundFrom = g.endlessSeconds;
      g.log('round', { round: this.round, time: g.time });
    }
  }

  // A popped giant may open a skill slot; the Higgs wins the run.
  fall(boss: Target): void {
    const g = this.game;
    this.end(boss.id);
    if (boss.final) {
      this.higgsDown = true;
      g.log('final-boss-down', { id: boss.id });
      return;
    }
    const slots = g.growth.skillSlots;
    this.down++;
    this.announce(g.growth.skillSlots > slots ? 'slot-open' : 'boss-down', boss.boss);
    g.log('boss-down', { id: boss.id, slots: g.growth.skillSlots });
  }
}
