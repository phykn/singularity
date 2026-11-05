// C. Charge: weak automatic fire, and one hand-timed release.
import { Run, TAU, angleGap, clamp01, lerp } from './stage.ts';
import type { Card, Particle } from './stage.ts';

const POOL: Card[] = [
  { id: 'fast', name: '빠른 충전', text: '충전이 1.5배 빠르다' },
  { id: 'wide', name: '넓은 고리', text: '고리 최대 폭 +30' },
  { id: 'after', name: '잔향', text: '놓은 뒤 1.5초 동안 고리가 남는다' },
  { id: 'auto', name: '방전', text: '자동 공격 2배' },
];
const MAX_CHARGE = 3;

export class ChargeRun extends Run {
  readonly name = 'C. 충전';
  readonly help =
    '누르고 있으면 (Space · 터치) 충전된다: 공격과 소리가 멎고 고리가 자란다. 놓으면 고리 안의 입자가 한꺼번에 터지고 질량이 빠진다. 3초를 넘기면 불발';
  private charge = -1;
  private chargeRate = 1;
  private ringMax = 70;
  private afterSeconds = 0;
  private afterUntil = 0;
  private afterWidth = 0;
  private autoRate = 1;
  private fizzleUntil = 0;
  private nextFire = 0;
  private nextSpawn = 0.8;
  private nextCard = 45;
  private releases = 0;
  private biggest = 0;
  private fizzles = 0;
  private cards: string[] = [];

  get charging(): boolean {
    return this.charge >= 0;
  }
  private ringWidth(t: number): number {
    return 8 + (this.ringMax - 8) * clamp01(t / 2);
  }

  tick(dt: number): void {
    this.angle += (150 / this.radius) * dt;
    if (this.charging) {
      this.charge += dt * this.chargeRate;
      if (this.charge > MAX_CHARGE) this.fizzle();
    }
    if (this.time >= this.nextSpawn) {
      this.nextSpawn += lerp(1.4, 0.45, clamp01(this.time / 140));
      this.spawnCluster();
    }
    this.stepParticles(dt);
    this.stepOrbit(dt);
    if (this.over) return;
    if (!this.charging && this.time >= this.nextFire) {
      this.nextFire = this.time + 0.5 / this.autoRate;
      const from = this.electron;
      for (const t of this.nearest(from, 60, 1)) this.strike(t, 1, from, 'pop', 0, 1);
    }
    if (this.time < this.afterUntil)
      for (const p of this.inRing(this.afterWidth)) this.strike(p, 1, this.electron, 'brush', 0, 1);
    if (!this.charging && this.time >= this.nextCard && this.nextCard <= 100) {
      this.nextCard += 55;
      this.offerCards();
    }
  }

  private spawnCluster(): void {
    const base = this.rng.next() * TAU;
    const count = 3 + Math.floor(this.rng.next() * 5);
    const dense = this.time > 40 && this.rng.next() < 0.2;
    for (let i = 0; i < count; i++) {
      const kind = dense && i === 0 ? 'dense' : 'small';
      this.spawn(
        kind,
        base + (this.rng.next() - 0.5) * 0.6,
        192 + i * 8 + this.rng.next() * 6,
        lerp(12, 19, clamp01(this.time / 150)) * (kind === 'dense' ? 0.7 : 1),
        (this.rng.next() - 0.5) * 0.08,
      );
    }
  }
  private inRing(width: number): Particle[] {
    return this.particles.filter((p) => Math.abs(p.r - this.radius) <= width);
  }

  onHold(holding: boolean): void {
    if (holding) {
      if (!this.charging && this.time >= this.fizzleUntil) {
        this.charge = 0;
        this.sounds.stop();
      }
    } else if (this.charging) this.release();
  }

  // Everything inside the ring pops at once, ordered from the electron around the orbit.
  private release(): void {
    const t = this.charge;
    this.charge = -1;
    const width = this.ringWidth(t);
    const damage = 1 + Math.floor(t);
    const from = this.electron;
    const inside = this.inRing(width).sort(
      (a, b) => angleGap(a.angle, this.angle) - angleGap(b.angle, this.angle),
    );
    let popped = 0;
    inside.forEach((p, i) => {
      if (this.strike(p, damage, from, 'enter', Math.min(0.05, i * 0.006), 2)) popped++;
    });
    this.releases++;
    this.biggest = Math.max(this.biggest, popped);
    if (popped === 0) this.sounds.cue('brush');
    if (popped >= 12) this.sounds.cue('thunder');
    this.mass = Math.max(0, this.mass - Math.round(popped * 0.6));
    this.shake = Math.min(1, popped / 18);
    if (this.afterSeconds > 0) {
      this.afterUntil = this.time + this.afterSeconds;
      this.afterWidth = width;
    }
  }
  private fizzle(): void {
    this.charge = -1;
    this.fizzles++;
    this.fizzleUntil = this.time + 0.8;
    this.sounds.cue('brush');
    this.flash = 0.2;
  }

  private offerCards(): void {
    const options = [...POOL].sort(() => this.rng.next() - 0.5).slice(0, 2);
    this.offer(options, (id) => {
      this.cards.push(options.find((c) => c.id === id)!.name);
      if (id === 'fast') this.chargeRate *= 1.5;
      if (id === 'wide') this.ringMax += 30;
      if (id === 'after') this.afterSeconds = 1.5;
      if (id === 'auto') this.autoRate *= 2;
    });
  }

  paintWorld(): void {
    const ctx = this.ctx;
    const e = this.electron;
    const width = this.charging
      ? this.ringWidth(this.charge)
      : this.time < this.afterUntil
        ? this.afterWidth
        : 0;
    if (width > 0) {
      const pulse = this.charging ? 0.08 + 0.05 * Math.sin(this.time * 14) : 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + width, 0, TAU);
      ctx.arc(0, 0, Math.max(0, this.radius - width), 0, TAU, true);
      ctx.fillStyle = `rgba(127,231,255,${pulse})`;
      ctx.fill();
      for (const r of [this.radius + width, Math.max(0, this.radius - width)]) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.strokeStyle = this.charging
          ? `rgba(223,248,255,${this.charge > 2.4 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0.6})`
          : 'rgba(127,231,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (this.charging) {
      const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 10 + this.charge * 10);
      glow.addColorStop(0, 'rgba(223,248,255,0.5)');
      glow.addColorStop(1, 'rgba(127,231,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(e.x - 40, e.y - 40, 80, 80);
      ctx.beginPath();
      ctx.arc(e.x, e.y, 9, -Math.PI / 2, -Math.PI / 2 + TAU * (this.charge / MAX_CHARGE));
      ctx.strokeStyle = this.charge > 2.4 ? '#ffb84d' : '#dff8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (this.time < this.fizzleUntil) {
      this.text('불발', e.x, e.y - 14, 10, '#ffb84d', 'center');
    } else {
      ctx.beginPath();
      ctx.arc(e.x, e.y, 60, 0, TAU);
      ctx.strokeStyle = 'rgba(127,231,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  paintHud(): void {
    if (this.charging)
      this.text(
        `충전 ${this.charge.toFixed(1)}s`,
        this.w - 12,
        36,
        13,
        this.charge > 2.4 ? '#ffb84d' : '#7fe7ff',
        'right',
      );
  }
  stats(): [string, string][] {
    return [
      ['방출', `${this.releases}회, 한 번에 최대 ${this.biggest}`],
      ['불발', `${this.fizzles}`],
      ['카드', this.cards.join(', ') || '없음'],
    ];
  }
}
