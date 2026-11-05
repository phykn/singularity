// A. Aim: the electron orbits and fires by itself; the hand only says where.
import { Run, TAU, clamp01, lerp, polar } from './stage.ts';
import type { Card, P } from './stage.ts';

const POOL: Card[] = [
  { id: 'fork', name: '갈래', text: '번개가 한 번에 하나 더' },
  { id: 'chain', name: '연쇄', text: '터진 입자 옆으로 번진다' },
  { id: 'rate', name: '연사', text: '공격 간격 -30%' },
  { id: 'wide', name: '넓은 조준', text: '조준 범위 +20' },
];

export class AimRun extends Run {
  readonly name = 'A. 조준';
  readonly help =
    '마우스·터치 위치가 조준점. 전자는 알아서 돌고 번개는 조준점 근처를 때린다. 방향키로도 조준을 옮길 수 있다';
  aim: P = { x: 0, y: -110 };
  aimRadius = 46;
  forks = 1;
  chain = 0;
  fireEvery = 0.16;
  private nextFire = 0;
  private nextSpawn = 0.6;
  private nextCard = 30;
  private aimed = 0;
  private idle = 0;
  private keys = new Set<string>();
  private cards: string[] = [];

  tick(dt: number): void {
    this.angle += (150 / this.radius) * dt;
    this.moveAimByKeys(dt);
    if (this.time >= this.nextSpawn) {
      this.nextSpawn += lerp(1.3, 0.42, clamp01(this.time / 130));
      this.spawnCluster();
    }
    this.stepParticles(dt);
    this.stepOrbit(dt);
    if (this.over) return;
    if (this.time >= this.nextFire) {
      this.nextFire = this.time + this.fireEvery;
      this.fire();
    }
    if (this.time >= this.nextCard && this.nextCard <= 120) {
      this.nextCard += 30;
      this.offerCards();
    }
  }

  private moveAimByKeys(dt: number): void {
    const step = 170 * dt;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) this.aim.x -= step;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) this.aim.x += step;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) this.aim.y -= step;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) this.aim.y += step;
    const d = Math.hypot(this.aim.x, this.aim.y);
    if (d > 205) {
      this.aim.x *= 205 / d;
      this.aim.y *= 205 / d;
    }
  }

  private spawnCluster(): void {
    const base = this.rng.next() * TAU;
    const count = 3 + Math.floor(this.rng.next() * 5);
    const dense = this.time > 35 && this.rng.next() < 0.16;
    for (let i = 0; i < count; i++) {
      const kind = dense && i === 0 ? 'dense' : 'small';
      this.spawn(
        kind,
        base + (this.rng.next() - 0.5) * 0.5,
        192 + i * 8 + this.rng.next() * 6,
        lerp(13, 21, clamp01(this.time / 150)) * (kind === 'dense' ? 0.7 : 1),
        (this.rng.next() - 0.5) * 0.08,
      );
    }
  }

  // Bolts go to the aim first; with nothing there, a short reach around the electron.
  private fire(): void {
    const from = this.electron;
    let targets = this.nearest(this.aim, this.aimRadius, this.forks);
    const aimed = targets.length > 0;
    if (!aimed) targets = this.nearest(from, 40, 1);
    for (const t of targets) {
      const killed = this.strike(t, 1, from, 'pop', 0, aimed ? 1.6 : 1);
      if (aimed) this.aimed++;
      else this.idle++;
      if (killed && this.chain > 0)
        for (const [i, n] of this.nearest(t, 32, this.chain, t).entries())
          this.strike(n, 1, t, 'roll', 0.07 * (i + 1), 1.2);
    }
  }

  private offerCards(): void {
    const options = [...POOL].sort(() => this.rng.next() - 0.5).slice(0, 2);
    this.offer(options, (id) => {
      this.cards.push(options.find((c) => c.id === id)!.name);
      if (id === 'fork') this.forks++;
      if (id === 'chain') this.chain++;
      if (id === 'rate') this.fireEvery *= 0.7;
      if (id === 'wide') this.aimRadius += 20;
    });
  }

  onKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
  onPointer(p: P): void {
    this.aim = p;
  }
  onPointerMove(p: P): void {
    this.aim = p;
  }

  paintWorld(): void {
    const ctx = this.ctx;
    const live = this.nearest(this.aim, this.aimRadius, 1).length > 0;
    ctx.beginPath();
    ctx.arc(this.aim.x, this.aim.y, this.aimRadius, 0, TAU);
    ctx.fillStyle = live ? 'rgba(127,231,255,0.07)' : 'rgba(127,231,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = live ? 'rgba(127,231,255,0.7)' : 'rgba(127,231,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const o = polar(a, this.aimRadius),
        i = polar(a, this.aimRadius - 8);
      ctx.beginPath();
      ctx.moveTo(this.aim.x + i.x, this.aim.y + i.y);
      ctx.lineTo(this.aim.x + o.x, this.aim.y + o.y);
      ctx.strokeStyle = 'rgba(223,248,255,0.8)';
      ctx.stroke();
    }
    // Idle reach around the electron.
    const e = this.electron;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 40, 0, TAU);
    ctx.strokeStyle = 'rgba(127,231,255,0.12)';
    ctx.stroke();
  }

  stats(): [string, string][] {
    const total = this.aimed + this.idle;
    return [
      ['조준한 타격', total ? `${Math.round((this.aimed / total) * 100)}%` : '0%'],
      ['카드', this.cards.join(', ') || '없음'],
    ];
  }
}
