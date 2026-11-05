// Shared stage for the direction prototypes: a Canvas 2D world with the
// orbit, the core, particles, bolts, pops and the keycap mixer. Each
// prototype extends `Run` and owns only its hand: what a press does.
import { SoundMixer } from '../audio/SoundMixer.ts';
import type { SoundCue } from '../audio/SoundComposer.ts';

export type P = { x: number; y: number };
export const TAU = Math.PI * 2;
export const polar = (angle: number, r: number): P => ({
  x: r * Math.cos(angle),
  y: r * Math.sin(angle),
});
export const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);
export const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;
export const angleGap = (a: number, b: number): number => {
  const d = wrap(a - b);
  return d > Math.PI ? TAU - d : d;
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

export const ORBIT = 132;
export const SPAWN = 192;
export const CORE = 10;
export const CORE_MAX = 36;
export const ELECTRON = 4;
export const coreOf = (mass: number): number => CORE + Math.min(CORE_MAX - CORE, mass * 0.35);
export const orbitOf = (mass: number): number => Math.max(0, ORBIT - mass * 0.65);

export type Kind = 'small' | 'dense';
export type Particle = {
  id: number;
  kind: Kind;
  angle: number;
  r: number;
  speed: number;
  drift: number;
  hp: number;
  maxHp: number;
  born: number;
  hitAt: number;
  x: number;
  y: number;
  dead: boolean;
};
export type Card = { id: string; name: string; text: string };
export type Outcome = 'survived' | 'collapse';
type Bolt = { from: P; to: P; born: number; life: number; width: number; seed: number };
type Pop = { p: Particle; at: number; born: number; cue: string; started: boolean };
type Choice = { cards: Card[]; resolve: (id: string) => void };

const FONT = '"Singularity Pixel KO", "Singularity Pixel", monospace';
const KIND_HP: Record<Kind, number> = { small: 1, dense: 3 };
const KIND_MASS: Record<Kind, number> = { small: 1, dense: 3 };
const KIND_SIZE: Record<Kind, number> = { small: 5, dense: 8 };
const KIND_VOICE: Record<Kind, number> = { small: 0, dense: 3 };
const KIND_COLOR: Record<Kind, string> = { small: '#ff7a8a', dense: '#b48cff' };

export class Sounds {
  private context: AudioContext | null = null;
  private mixer: SoundMixer | null = null;
  private pending: SoundCue[] = [];
  muted = false;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.mixer = new SoundMixer(this.context);
    }
    void this.context.resume();
  }
  get ready(): boolean {
    return !!this.context && this.context.state === 'running';
  }
  cue(kind: string, at?: P, listener?: P, voice?: number): void {
    if (this.muted) return;
    this.pending.push({
      kind,
      space:
        at && listener
          ? { pan: at.x / 400, depth: Math.min(1, dist(at, listener) / 300) }
          : undefined,
      voice,
    });
  }
  flush(): void {
    if (this.pending.length && this.mixer && this.ready)
      this.mixer.playBatch(this.pending, this.context!.currentTime);
    this.pending = [];
  }
  stop(): void {
    this.mixer?.stop();
  }
  suspend(): void {
    this.mixer?.stop();
    void this.context?.suspend();
  }
  resume(): void {
    void this.context?.resume();
  }
  dispose(): void {
    this.mixer?.dispose();
    void this.context?.close();
    this.mixer = null;
    this.context = null;
  }
}

export abstract class Run {
  abstract readonly name: string;
  abstract readonly help: string;
  readonly length = 150;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly rng: Rng;
  readonly sounds: Sounds;
  w = 0;
  h = 0;
  scale = 1;
  time = 0;
  particles: Particle[] = [];
  bolts: Bolt[] = [];
  pops: Pop[] = [];
  mass = 0;
  radius = ORBIT;
  angle = -Math.PI / 2;
  popped = 0;
  absorbed = 0;
  choice: Choice | null = null;
  over: Outcome | null = null;
  holding = false;
  shake = 0;
  flash = 0;
  onExit: (how: 'restart' | 'back') => void = () => {};
  private frame = 0;
  private last = 0;
  private nextId = 1;
  private hidden = false;
  private observer: ResizeObserver;
  private readonly listeners: (() => void)[] = [];

  constructor(root: HTMLElement, seed: number, sounds: Sounds) {
    this.root = root;
    this.rng = new Rng(seed);
    this.sounds = sounds;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'proto-canvas';
    this.canvas.tabIndex = 0;
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(root);
    this.listen(window, 'keydown', (e) => this.keydown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.keyup(e as KeyboardEvent));
    this.listen(window, 'blur', () => this.setHolding(false));
    this.listen(document, 'visibilitychange', () => this.visibility());
    this.listen(this.canvas, 'pointerdown', (e) => this.pointerdown(e as PointerEvent));
    this.listen(this.canvas, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.isPrimary) this.onPointerMove(this.toWorld(ev.clientX, ev.clientY));
    });
    this.listen(window, 'pointerup', () => this.setHolding(false));
    this.listen(window, 'pointercancel', () => this.setHolding(false));
    this.listen(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.canvas.focus({ preventScroll: true });
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.loop);
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.listeners.push(() => target.removeEventListener(type, handler));
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    for (const off of this.listeners) off();
    this.sounds.stop();
    this.canvas.remove();
  }

  // ----- hooks for each prototype -----
  abstract tick(dt: number): void;
  paintWorld(): void {}
  paintHud(): void {}
  stats(): [string, string][] {
    return [];
  }
  onKey(_code: string, _down: boolean): void {}
  onPointer(_p: P, _down: boolean): void {}
  onPointerMove(_p: P): void {}
  onHold(_holding: boolean): void {}

  // ----- loop -----
  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.hidden && !this.choice && !this.over) {
      this.time += dt;
      this.tick(dt);
      this.stepEffects(dt);
      if (!this.over && this.time >= this.length) this.finish('survived');
    }
    this.sounds.flush();
    this.paint();
    this.frame = requestAnimationFrame(this.loop);
  };

  private visibility(): void {
    this.hidden = document.hidden;
    this.last = performance.now();
    if (this.hidden) {
      this.setHolding(false);
      this.sounds.suspend();
    } else this.sounds.resume();
  }

  get electron(): P {
    return polar(this.angle, this.radius);
  }
  get core(): number {
    return coreOf(this.mass);
  }
  get margin(): number {
    return this.radius - this.core - ELECTRON;
  }
  get alive(): Particle[] {
    return this.particles;
  }

  // ----- input -----
  private keydown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      this.onExit('back');
      return;
    }
    this.sounds.unlock();
    if (this.over) {
      if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.onExit('restart');
      }
      return;
    }
    if (this.choice) {
      const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (index >= 0 && this.choice.cards[index]) this.pick(this.choice.cards[index].id);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      this.setHolding(true);
    }
    this.onKey(e.code, true);
  }
  private keyup(e: KeyboardEvent): void {
    if (e.code === 'Space') this.setHolding(false);
    this.onKey(e.code, false);
  }
  private pointerdown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.sounds.unlock();
    const p = this.toWorld(e.clientX, e.clientY);
    if (this.over) {
      this.onExit('restart');
      return;
    }
    if (this.choice) {
      const hit = this.cardAt(e.clientX, e.clientY);
      if (hit) this.pick(hit.id);
      return;
    }
    this.setHolding(true);
    this.onPointer(p, true);
  }
  private setHolding(holding: boolean): void {
    if (this.holding === holding) return;
    this.holding = holding;
    if (!this.over && !this.choice) this.onHold(holding);
  }

  toWorld(clientX: number, clientY: number): P {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - bounds.width / 2) / this.scale,
      y: (clientY - bounds.top - bounds.height / 2) / this.scale,
    };
  }
  toScreen(p: P): P {
    return { x: this.w / 2 + p.x * this.scale, y: this.h / 2 + p.y * this.scale };
  }
  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.root.clientWidth;
    this.h = this.root.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.w, this.h) / 420;
  }

  // ----- shared simulation -----
  spawn(kind: Kind, angle: number, r: number, speed: number, drift = 0): Particle {
    const p: Particle = {
      id: this.nextId++,
      kind,
      angle,
      r,
      speed,
      drift,
      hp: KIND_HP[kind],
      maxHp: KIND_HP[kind],
      born: this.time,
      hitAt: -1,
      x: 0,
      y: 0,
      dead: false,
    };
    this.place(p);
    this.particles.push(p);
    return p;
  }
  private place(p: Particle): void {
    const at = polar(p.angle, p.r);
    p.x = at.x;
    p.y = at.y;
  }
  // Particles sink toward the core; those that arrive become mass.
  stepParticles(dt: number): number {
    const core = this.core;
    let absorbed = 0;
    for (const p of this.particles) {
      p.r -= p.speed * dt;
      p.angle += p.drift * dt;
      this.place(p);
      if (p.r <= core) {
        p.dead = true;
        this.mass += KIND_MASS[p.kind];
        absorbed++;
        this.flash = 0.3;
      }
    }
    if (absorbed) {
      this.absorbed += absorbed;
      this.particles = this.particles.filter((p) => !p.dead);
    }
    return absorbed;
  }
  // The orbit follows the mass like the game: inward slowly, outward faster.
  stepOrbit(dt: number): void {
    const target = orbitOf(this.mass);
    if (this.radius > target) this.radius = Math.max(target, this.radius - 8 * dt);
    else this.radius = Math.min(target, this.radius + 6 * dt);
    if (this.margin <= 0) this.finish('collapse');
  }
  bolt(from: P, to: P, width = 1.5, life = 0.12): void {
    this.bolts.push({
      from: { ...from },
      to: { ...to },
      born: this.time,
      life,
      width,
      seed: this.rng.next(),
    });
  }
  // One hit from `from`: a bolt, damage, and either a keycap hit or a scheduled pop.
  strike(p: Particle, damage: number, from: P, cue: string, delay = 0, width = 1.5): boolean {
    this.bolt(from, p, width);
    p.hp -= damage;
    p.hitAt = this.time;
    if (p.hp <= 0) {
      p.dead = true;
      this.particles = this.particles.filter((q) => q !== p);
      this.pops.push({ p, at: this.time + delay, born: 0, cue, started: false });
      return true;
    }
    this.sounds.cue('hit', p, this.electron);
    return false;
  }
  nearest(from: P, within: number, count = 1, exclude?: Particle): Particle[] {
    return this.particles
      .filter((p) => p !== exclude && dist(p, from) <= within)
      .sort((a, b) => dist(a, from) - dist(b, from))
      .slice(0, count);
  }
  private stepEffects(dt: number): void {
    const listener = this.electron;
    for (const pop of this.pops) {
      if (!pop.started && this.time >= pop.at) {
        pop.started = true;
        pop.born = this.time;
        this.popped++;
        this.sounds.cue(pop.cue, pop.p, listener, KIND_VOICE[pop.p.kind]);
      }
    }
    this.pops = this.pops.filter((pop) => !pop.started || this.time - pop.born < 0.35);
    this.bolts = this.bolts.filter((b) => this.time - b.born < b.life);
    this.shake = Math.max(0, this.shake - dt * 4);
    this.flash = Math.max(0, this.flash - dt);
  }
  offer(cards: Card[], resolve: (id: string) => void): void {
    this.setHolding(false);
    this.sounds.cue('rare');
    this.choice = { cards, resolve };
  }
  private pick(id: string): void {
    const choice = this.choice;
    if (!choice) return;
    this.choice = null;
    this.sounds.cue('charged');
    choice.resolve(id);
  }
  finish(outcome: Outcome): void {
    if (this.over) return;
    this.over = outcome;
    this.setHolding(false);
    this.sounds.cue(outcome === 'survived' ? 'singularity' : 'collision');
  }

  // ----- painting -----
  private paint(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.shake > 0)
      ctx.translate((Math.random() - 0.5) * 6 * this.shake, (Math.random() - 0.5) * 6 * this.shake);
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.scale, this.scale);
    this.paintBase();
    this.paintWorld();
    ctx.restore();
    this.paintHudBase();
    this.paintHud();
    if (this.choice) this.paintChoice();
    if (this.over) this.paintResult();
  }
  private paintBase(): void {
    const ctx = this.ctx;
    const danger = this.margin < 24;
    // Orbit.
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TAU);
    ctx.strokeStyle = danger ? 'rgba(255,184,77,0.75)' : 'rgba(120,210,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Core.
    const core = this.core;
    ctx.beginPath();
    ctx.arc(0, 0, core, 0, TAU);
    ctx.fillStyle =
      this.flash > 0 ? `rgba(255,${90 + 120 * (1 - this.flash / 0.3)},90,1)` : '#2c3340';
    ctx.fill();
    ctx.strokeStyle = '#55637a';
    ctx.stroke();
    // Particles, including those waiting to pop (held bright).
    for (const p of this.particles) this.paintParticle(p, false);
    for (const pop of this.pops) if (!pop.started) this.paintParticle(pop.p, true);
    // Bolts.
    for (const b of this.bolts) this.paintBolt(b);
    // Pops.
    for (const pop of this.pops) if (pop.started) this.paintPop(pop);
    // Electron with a short trail.
    for (let i = 1; i <= 6; i++) {
      const at = polar(this.angle - i * 0.05, this.radius);
      ctx.beginPath();
      ctx.arc(at.x, at.y, ELECTRON * (1 - i / 7), 0, TAU);
      ctx.fillStyle = `rgba(127,231,255,${0.35 * (1 - i / 7)})`;
      ctx.fill();
    }
    const e = this.electron;
    const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 14);
    glow.addColorStop(0, 'rgba(127,231,255,0.45)');
    glow.addColorStop(1, 'rgba(127,231,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(e.x - 14, e.y - 14, 28, 28);
    ctx.beginPath();
    ctx.arc(e.x, e.y, ELECTRON, 0, TAU);
    ctx.fillStyle = '#dff8ff';
    ctx.fill();
  }
  private paintParticle(p: Particle, held: boolean): void {
    const ctx = this.ctx;
    const size = KIND_SIZE[p.kind];
    const fresh = this.time - p.hitAt < 0.08;
    ctx.fillStyle = held || fresh ? '#ffffff' : KIND_COLOR[p.kind];
    ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    if (p.kind === 'dense' && p.hp < p.maxHp) {
      ctx.fillStyle = 'rgba(8,10,14,0.8)';
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y + size / 2 - 2), size, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        Math.round(p.x - size / 2),
        Math.round(p.y + size / 2 - 2),
        size * (p.hp / p.maxHp),
        2,
      );
    }
  }
  private paintBolt(b: Bolt): void {
    const ctx = this.ctx;
    const age = (this.time - b.born) / b.life;
    const alpha = 1 - age;
    const d = dist(b.from, b.to);
    const steps = Math.max(2, Math.round(d / 12));
    const rng = new Rng(Math.floor(b.seed * 1e9));
    const nx = -(b.to.y - b.from.y) / Math.max(1, d),
      ny = (b.to.x - b.from.x) / Math.max(1, d);
    const points: P[] = [b.from];
    for (let i = 1; i < steps; i++) {
      const t = i / steps,
        j = (rng.next() - 0.5) * 10;
      points.push({
        x: lerp(b.from.x, b.to.x, t) + nx * j,
        y: lerp(b.from.y, b.to.y, t) + ny * j,
      });
    }
    points.push(b.to);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [width, color] of [
      [b.width * 4, `rgba(120,210,255,${0.22 * alpha})`],
      [b.width, `rgba(235,250,255,${alpha})`],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
  private paintPop(pop: Pop): void {
    const ctx = this.ctx;
    const age = clamp01((this.time - pop.born) / 0.35);
    const { x, y } = pop.p;
    const big = pop.p.kind === 'dense';
    ctx.beginPath();
    ctx.arc(x, y, lerp(2, big ? 22 : 14, age), 0, TAU);
    ctx.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.9})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const rng = new Rng(pop.p.id * 7919);
    const bits = big ? 8 : 5;
    for (let i = 0; i < bits; i++) {
      const a = rng.next() * TAU,
        v = 20 + rng.next() * 30;
      const t = this.time - pop.born;
      ctx.fillStyle = `rgba(255,${big ? 200 : 140},${big ? 255 : 160},${1 - age})`;
      ctx.fillRect(x + Math.cos(a) * v * t - 1, y + Math.sin(a) * v * t - 1, 2, 2);
    }
  }
  text(
    s: string,
    x: number,
    y: number,
    size = 13,
    color = '#dff8ff',
    align: CanvasTextAlign = 'left',
  ): void {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  private paintHudBase(): void {
    const ctx = this.ctx;
    const t = Math.min(this.length, this.time);
    const mm = Math.floor(t / 60),
      ss = Math.floor(t % 60);
    this.text(
      `${mm}:${ss.toString().padStart(2, '0')} / ${Math.floor(this.length / 60)}:${(this.length % 60).toString().padStart(2, '0')}`,
      12,
      16,
      13,
      '#9fb8c8',
    );
    this.text(`질량 ${this.mass}`, 12, 36, 13, this.margin < 24 ? '#ffb84d' : '#9fb8c8');
    this.text(`터짐 ${this.popped}`, 12, 56, 13, '#9fb8c8');
    // Orbit margin bar: how much room the electron has left.
    const width = 110,
      fill = clamp01(this.margin / (ORBIT - CORE - ELECTRON));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(12, 70, width, 4);
    ctx.fillStyle = this.margin < 24 ? '#ffb84d' : '#7fe7ff';
    ctx.fillRect(12, 70, width * fill, 4);
    if (!this.sounds.ready)
      this.text('소리: 아무 키나 누르면 켜짐', this.w - 12, 16, 12, '#6f8696', 'right');
  }
  private cardRects(): { card: Card; x: number; y: number; w: number; h: number }[] {
    const cards = this.choice?.cards ?? [];
    const w = Math.min(170, (this.w - 48) / cards.length - 12),
      h = 96,
      total = cards.length * w + (cards.length - 1) * 12;
    return cards.map((card, i) => ({
      card,
      x: this.w / 2 - total / 2 + i * (w + 12),
      y: this.h / 2 - h / 2,
      w,
      h,
    }));
  }
  private cardAt(clientX: number, clientY: number): Card | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = clientX - bounds.left,
      y = clientY - bounds.top;
    for (const r of this.cardRects())
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.card;
    return null;
  }
  private paintChoice(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,10,14,0.72)';
    ctx.fillRect(0, 0, this.w, this.h);
    this.text(
      '하나 고르기 (1 / 2 또는 클릭)',
      this.w / 2,
      this.h / 2 - 76,
      14,
      '#9fb8c8',
      'center',
    );
    this.cardRects().forEach((r, i) => {
      ctx.fillStyle = '#10151d';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#7fe7ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      this.text(`${i + 1}`, r.x + 10, r.y + 16, 12, '#6f8696');
      this.text(r.card.name, r.x + r.w / 2, r.y + 38, 17, '#dff8ff', 'center');
      this.text(r.card.text, r.x + r.w / 2, r.y + 66, 12, '#9fb8c8', 'center');
    });
  }
  private paintResult(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,10,14,0.78)';
    ctx.fillRect(0, 0, this.w, this.h);
    const survived = this.over === 'survived';
    this.text(
      survived ? '버텼다' : '궤도 붕괴',
      this.w / 2,
      this.h / 2 - 70,
      24,
      survived ? '#7fe7ff' : '#ffb84d',
      'center',
    );
    const rows: [string, string][] = [
      [
        '시간',
        `${Math.floor(this.time / 60)}:${Math.floor(this.time % 60)
          .toString()
          .padStart(2, '0')}`,
      ],
      ['터짐', `${this.popped}`],
      ['흡수', `${this.absorbed}`],
      ...this.stats(),
    ];
    rows.forEach(([k, v], i) => {
      this.text(k, this.w / 2 - 12, this.h / 2 - 30 + i * 22, 14, '#9fb8c8', 'right');
      this.text(v, this.w / 2 + 12, this.h / 2 - 30 + i * 22, 14, '#dff8ff', 'left');
    });
    this.text(
      '클릭 / R: 다시 · Esc: 목록',
      this.w / 2,
      this.h / 2 - 30 + rows.length * 22 + 20,
      13,
      '#6f8696',
      'center',
    );
  }
}
