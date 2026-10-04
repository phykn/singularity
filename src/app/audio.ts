export class GameAudio {
  private context: AudioContext | null = null;
  private last: Record<string, number> = {};
  private wanted = false;
  private request = 0;
  private suspending: Promise<void> | null = null;
  enabled = false;

  async unlock(): Promise<boolean | null> {
    this.wanted = true;
    const request = ++this.request;
    let context: AudioContext | null = null;
    try {
      context = this.context ??= new AudioContext();
      if (this.suspending) await this.suspending;
      if (this.context !== context || request !== this.request) return null;
      await context.resume();
      if (this.context !== context) return null;
      if (!this.wanted) {
        await this.suspendContext(context);
        return null;
      }
      if (request !== this.request) return null;
      this.enabled = context.state === 'running';
      return this.enabled;
    } catch {
      if (request !== this.request) return null;
      if (this.context === context) this.enabled = false;
      return false;
    }
  }

  suspend(): void {
    this.wanted = false;
    this.request++;
    this.enabled = false;
    if (this.context) void this.suspendContext(this.context);
  }
  private suspendContext(context: AudioContext): Promise<void> {
    const promise = context.suspend().catch(() => {});
    this.suspending = promise;
    void promise.then(() => {
      if (this.suspending === promise) this.suspending = null;
    });
    return promise;
  }
  destroy(): void {
    const context = this.context;
    this.context = null;
    this.suspending = null;
    this.enabled = false;
    this.wanted = false;
    this.request++;
    this.last = {};
    void context?.close().catch(() => {});
  }

  play(kind: string): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (this.last[kind] ?? -Infinity) < (kind === 'hit' ? 0.1 : 0.07)) return;
    this.last[kind] = now;
    const tones: Record<string, [number, number, number]> = {
      hit: [800, 260, 0.035],
      dense: [210, 90, 0.07],
      level: [520, 980, 0.15],
      wave: [180, 55, 0.22],
      charged: [560, 1120, 0.3],
      collision: [110, 40, 0.4],
      ending: [130, 35, 0.6],
    };
    const tone = tones[kind];
    if (!tone) return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = kind === 'dense' || kind === 'wave' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(tone[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(tone[1], now + tone[2]);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone[2]);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + tone[2]);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
