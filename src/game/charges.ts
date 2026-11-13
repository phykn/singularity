import type { Attack, Combat } from './combat.ts';
import { CENTER, distance } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest } from './targeting.ts';
import type { Target } from './types.ts';

type Building = 'charge' | 'surge' | 'overcharge';

// Skills that fill from hits and kills and then let go: Surge, Capacitor, Overcharge
// and Static Mark.
export class Charges {
  private readonly combat: Combat;
  private building: Partial<Record<Building, number>> = {};
  private stored = 0;
  private marked = new Set<number>();
  private overchargeKills = 0;
  private surge = {
    charge: 0,
    last: -Infinity,
    until: 0,
    extended: 0,
    next: 0,
    nextHit: 0,
    attack: undefined as Attack | undefined,
  };

  constructor(combat: Combat) {
    this.combat = combat;
  }

  get surging(): boolean {
    return this.combat.game.time < this.surge.until;
  }

  clear(): void {
    this.marked.clear();
    this.surge.until = this.surge.charge = 0;
    this.surge.attack = undefined;
  }

  // A rate change stretches the wait to the next surge volley.
  rescale(stretch: (at: number) => number): void {
    this.surge.next = stretch(this.surge.next);
  }

  // How full a charging skill is, and whether it is letting go right now.
  status(id: 'surge' | 'charge' | 'mark' | 'overcharge') {
    const g = this.combat.game,
      f = g.growth.values,
      s = this.surge;
    if (id === 'charge') return { filled: this.stored, needed: f.charge.threshold || 1 };
    if (id === 'mark') return { filled: this.marked.size, needed: f.mark.threshold };
    if (id === 'overcharge') return { filled: this.overchargeKills, needed: f.overcharge.kills };
    if (this.surging) return { filled: 1, needed: 1, active: true };
    const cold = g.time - s.last > g.rules.skills.surge.windowSeconds;
    return { filled: cold ? 0 : s.charge, needed: f.surge.kills };
  }

  // Every kill feeds Surge; an evolved surge under way runs longer instead.
  killed(): void {
    const g = this.combat.game,
      s = this.surge,
      surging = this.surging;
    // The kill that starts a surge does not also extend it.
    this.chargeSurge(1);
    if (!g.growth.evolved.surge || !surging) return;
    const cfg = g.rules.skills.surge.evolution,
      add = Math.min(cfg.extendSeconds, cfg.maxExtend - s.extended);
    if (add > 0) {
      s.until += add;
      s.extended += add;
    }
  }

  // Overcharge: kills heat the electron until the whole orbit band discharges.
  heat(attack: Attack): void {
    const g = this.combat.game,
      needed = g.growth.values.overcharge.kills;
    if (!g.growth.ranks.overcharge || attack.source === 'overcharge') return;
    this.overchargeKills++;
    this.build('overcharge', this.overchargeKills / needed);
    if (this.overchargeKills < needed) return;
    this.overchargeKills = 0;
    this.build('overcharge', 0);
    this.overcharge(1);
  }

  // A hit marks its particle, warms Surge and stores charge in the Capacitor.
  struck(attack: Attack, target: Target, damage: number): void {
    const g = this.combat.game,
      { ranks, values } = g.growth;
    if (ranks.mark && attack.depth < 2 && target.hp > 0 && !target.marked) {
      target.marked = true;
      this.marked.add(target.id);
      if (this.marked.size >= values.mark.threshold) this.detonate(attack);
    }
    if (target.hp > 0 && attack.source !== 'surge' && g.time >= this.surge.nextHit) {
      this.surge.nextHit = g.time + g.rules.skills.surge.hitIntervalSeconds;
      this.chargeSurge(g.rules.skills.surge.hitCharge * Math.min(1, damage / attack.power));
    }
    if (ranks.charge && attack.source !== 'charge' && attack.depth < 2)
      this.capacitor(attack, target, damage);
  }

  // While a surge lasts, basic volleys fire on their own fast timer.
  update(): void {
    const c = this.combat,
      g = c.game,
      s = this.surge;
    if (!this.surging || !s.attack || g.tick < s.next) return;
    const attack = { ...s.attack, budget: { burst: false }, firstKill: undefined };
    c.volley(
      attack,
      g.position,
      closest(g.targets, g.position, g.growth.values.multi.count, attack.range),
      true,
    );
    s.next =
      g.tick + Math.max(0.05, g.rules.skills.surge.tickSeconds / c.rate) * g.rules.time.tickRate;
  }

  // Charging skills sound each quarter they fill, so a release has a build-up before it.
  private build(id: Building, progress: number): void {
    const step = Math.floor(progress * 4 + 1e-8);
    if (step > (this.building[id] ?? 0) && step < 4) this.combat.game.log('build', { id, step });
    this.building[id] = step;
  }

  private chargeSurge(amount: number): void {
    const c = this.combat,
      g = c.game,
      s = this.surge,
      f = g.growth.values.surge;
    if (!g.growth.ranks.surge || this.surging) return;
    if (g.time - s.last > g.rules.skills.surge.windowSeconds) s.charge = 0;
    s.last = g.time;
    s.charge += amount;
    this.build('surge', s.charge / f.kills);
    if (s.charge < f.kills) return;
    s.charge = 0;
    this.build('surge', 0);
    s.until = g.time + f.duration;
    s.extended = 0;
    s.next = g.tick + 1;
    s.attack = c.begin('surge', f.damage);
    c.activate('surge');
    c.effect(s.attack, 'surge', g.position, g.position, {
      radius: 12,
      life: s.until - g.time,
      anchored: true,
    });
  }

  // The whole orbit band discharges in order along the orbit. Evolved, the discharge
  // echoes once at `evolution.damage` of its strength.
  private overcharge(scale: number, echo = false): void {
    const c = this.combat,
      g = c.game,
      s = g.growth.values.overcharge,
      cfg = g.rules.skills.overcharge,
      attack = { ...c.begin('overcharge', s.damage * scale), depth: 2 };
    c.effect(attack, 'field', CENTER, CENTER, { radius: g.radius, life: 0.4 });
    const targets = c.alongOrbit((t) => Math.abs(t.radius - g.radius) <= s.band);
    c.popInOrder(attack, undefined, targets, cfg.popSeconds);
    c.activate('overcharge');
    if (!echo && g.growth.evolved.overcharge)
      c.schedule(cfg.evolution.delaySeconds, () => this.overcharge(cfg.evolution.damage, true));
  }

  // Static Mark: once enough live particles carry a mark, they pop in a chain from the electron.
  private detonate(attack: Attack): void {
    const c = this.combat,
      g = c.game,
      marked = g.targets.filter((t) => t.marked && t.hp > 0);
    this.marked = new Set(marked.map((t) => t.id));
    if (marked.length < g.growth.values.mark.threshold) return;
    this.marked.clear();
    const ordered: Target[] = [],
      left = new Set(marked);
    let from: Point = g.position;
    while (left.size) {
      let next = marked[0],
        best = Infinity;
      for (const t of left) if (distance(t, from) < best) [next, best] = [t, distance(t, from)];
      left.delete(next);
      next.marked = false;
      ordered.push((from = next));
    }
    const child = { ...c.secondary(attack, 'mark', g.growth.values.mark.damage), depth: 2 };
    c.popInOrder(child, g.position, ordered, g.rules.skills.mark.popSeconds);
    c.activate('mark');
    if (!g.growth.evolved.mark) return;
    // Evolved: each detonation passes fresh marks to unmarked neighbours.
    const cfg = g.rules.skills.mark.evolution,
      popping = new Set(ordered.map((t) => t.id));
    for (const source of ordered)
      for (const next of closest(g.targets, source, cfg.spread, cfg.radius, popping)) {
        if (next.marked) continue;
        next.marked = true;
        this.marked.add(next.id);
      }
  }

  // Capacitor: hits store charge until a heavy bolt discharges at the struck or nearest particle.
  private capacitor(attack: Attack, target: Target, damage: number): void {
    const c = this.combat,
      g = c.game,
      f = g.growth.values.charge;
    this.stored = Math.min(f.threshold, this.stored + Math.min(1, damage / attack.power));
    this.build('charge', this.stored / f.threshold);
    const recipient = target.hp > 0 ? target : closest(g.targets, g.position, 1, attack.range)[0];
    if (!recipient || this.stored + 1e-8 < f.threshold)
      // The glow's width carries how full the capacitor is.
      return c.effect(attack, 'charge', g.position, g.position, {
        radius: 10,
        life: 0.3,
        anchored: true,
        source: 'charge',
        width: this.stored / f.threshold,
      });
    this.stored = 0;
    this.build('charge', 0);
    const charged = c.secondary(attack, 'charge', f.damage);
    c.effect(charged, 'bolt', g.position, recipient, {
      life: 0.2,
      anchored: true,
      source: 'charge',
      width: 4,
    });
    c.activate('charge');
    c.resolve(charged, recipient, g.position, true);
    if (!g.growth.evolved.charge) return;
    // Evolved: a full discharge also spreads as a ring around the electron.
    const cfg = g.rules.skills.charge.evolution,
      ring = c.derive(charged, charged.damage * cfg.damage, 2);
    c.effect(ring, 'field', g.position, g.position, {
      radius: cfg.ringRadius,
      life: 0.3,
      anchored: true,
      source: 'charge',
    });
    for (const other of c.within(g.position, cfg.ringRadius)) c.deal(ring, other, ring.damage);
  }
}
