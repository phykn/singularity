// B. Pilot: attacks are automatic and short; the hand chooses the depth.
import { ELECTRON, Run, TAU, clamp01, lerp, orbitOf, polar } from './stage.ts';
import type { Card } from './stage.ts';

const POOL: Card[] = [
  { id: 'fork', name: '갈래', text: '한 번에 둘을 때린다' },
  { id: 'chain', name: '연쇄', text: '터진 입자 옆으로 번진다' },
  { id: 'range', name: '사거리', text: '사거리 +16' },
  { id: 'rate', name: '연사', text: '공격 간격 -30%' },
];

export class PilotRun extends Run {
  readonly name = 'B. 조종';
  readonly help =
    '누르고 있으면 (Space · 터치) 전자가 안으로 파고들고, 놓으면 바깥 궤도로 돌아온다. 가까운 입자만 자동으로 터진다. 핵에 닿으면 끝';
  private vr = 0;
  private range = 34;
  private forks = 1;
  private chain = 0;
  private fireEvery = 0.22;
  private nextFire = 0;
  private nextShell = 0.4;
  private nextCreeper = 50;
  private nextCard = 30;
  private deepest = 132;
  private cards: string[] = [];

  tick(dt: number): void {
    const outer = orbitOf(this.mass);
    // Diving builds speed gently; letting go brakes hard, so depth is a decision, not momentum.
    if (this.holding) this.vr = Math.max(-80, this.vr - 160 * dt);
    else this.vr = Math.min(70, this.vr + 520 * dt);
    this.radius += this.vr * dt;
    if (this.radius >= outer) {
      this.radius = outer;
      this.vr = 0;
    }
    this.deepest = Math.min(this.deepest, this.radius);
    if (this.radius <= this.core + ELECTRON) {
      this.finish('collapse');
      return;
    }
    this.angle += (150 / this.radius) * dt;
    if (this.time >= this.nextShell) {
      this.nextShell += lerp(3.2, 1.5, clamp01(this.time / 150));
      this.spawnShell();
    }
    if (this.time >= this.nextCreeper) {
      this.nextCreeper += 7;
      this.spawnCreepers();
    }
    this.stepParticles(dt);
    if (this.margin <= 0) {
      this.finish('collapse');
      return;
    }
    if (this.time >= this.nextFire) {
      this.nextFire = this.time + this.fireEvery;
      this.fire();
    }
    if (this.time >= this.nextCard && this.nextCard <= 120) {
      this.nextCard += 30;
      this.offerCards();
    }
  }

  // A shell: an arc of particles at one radius, sinking slowly.
  private spawnShell(): void {
    const r = 48 + this.rng.next() * 128;
    const arc = 1 + this.rng.next() * 1.3;
    const start = this.rng.next() * TAU;
    const count = 6 + Math.floor(this.rng.next() * 9);
    const dense = this.time > 30 && this.rng.next() < 0.35;
    const drift = (this.rng.next() - 0.5) * 0.3;
    for (let i = 0; i < count; i++)
      this.spawn(
        dense && i % 4 === 0 ? 'dense' : 'small',
        start + (arc * i) / count,
        r + (this.rng.next() - 0.5) * 8,
        2.5 + this.rng.next() * 4,
        drift,
      );
  }
  // Creepers appear deep and sink fast: only a dive reaches them.
  private spawnCreepers(): void {
    const a = this.rng.next() * TAU;
    for (let i = 0; i < 4; i++)
      this.spawn('small', a + i * 0.12, 62 + i * 5, 7 + this.rng.next() * 3, 0.15);
  }

  private fire(): void {
    const from = this.electron;
    const diving = this.radius < orbitOf(this.mass) - 15;
    for (const t of this.nearest(from, this.range, this.forks)) {
      const killed = this.strike(t, 1, from, diving ? 'brush' : 'pop', 0, 1.4);
      if (killed && this.chain > 0)
        for (const [i, n] of this.nearest(t, 28, this.chain, t).entries())
          this.strike(n, 1, t, 'roll', 0.07 * (i + 1), 1.1);
    }
  }

  private offerCards(): void {
    const options = [...POOL].sort(() => this.rng.next() - 0.5).slice(0, 2);
    this.offer(options, (id) => {
      this.cards.push(options.find((c) => c.id === id)!.name);
      if (id === 'fork') this.forks++;
      if (id === 'chain') this.chain++;
      if (id === 'range') this.range += 16;
      if (id === 'rate') this.fireEvery *= 0.7;
    });
  }

  paintWorld(): void {
    const ctx = this.ctx;
    const e = this.electron;
    // Reach, and the outer orbit the electron returns to.
    ctx.beginPath();
    ctx.arc(e.x, e.y, this.range, 0, TAU);
    ctx.strokeStyle = 'rgba(127,231,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const outer = orbitOf(this.mass);
    if (this.radius < outer - 1) {
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, TAU);
      ctx.strokeStyle = 'rgba(120,210,255,0.12)';
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      // A tether from the outer orbit to the diving electron.
      const o = polar(this.angle, outer);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(e.x, e.y);
      ctx.strokeStyle = 'rgba(127,231,255,0.25)';
      ctx.stroke();
    }
  }
  paintHud(): void {
    this.text(
      this.holding ? '▼ 파고드는 중' : '바깥 궤도',
      this.w - 12,
      36,
      13,
      this.holding ? '#7fe7ff' : '#6f8696',
      'right',
    );
  }
  stats(): [string, string][] {
    return [
      ['가장 깊이', `${Math.round(this.deepest)}`],
      ['카드', this.cards.join(', ') || '없음'],
    ];
  }
}
