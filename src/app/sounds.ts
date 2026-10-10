type Bus = 'hit' | 'kill' | 'skill' | 'reward';
type Voice = { bus: Bus; end: number; oscillator: OscillatorNode; gain: GainNode };

const tones: Record<string, [number, number, number]> = {
  hit: [800, 260, 0.035],
  dense: [210, 90, 0.07],
  level: [520, 980, 0.15],
  wave: [180, 55, 0.22],
  charged: [560, 1120, 0.3],
  collision: [110, 40, 0.4],
  ending: [130, 35, 0.6],
  'ending-compress': [240, 920, 0.95],
  'ending-resonance': [78, 42, 1.1],
  'beyond-contract': [360, 65, 0.65],
  'beyond-open': [160, 780, 0.55],
  kill: [640, 300, 0.04],
  'rhythm-1': [660, 520, 0.09],
  'rhythm-2': [880, 700, 0.1],
  'rhythm-complete': [440, 65, 0.32],
  'rhythm-crack': [1800, 240, 0.075],
  'rhythm-miss': [150, 95, 0.09],
};

export class SoundMixer {
  private voices: Voice[] = [];
  private context: BaseAudioContext;
  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  play(kind: string, at = this.context.currentTime, pitch = 1): boolean {
    const tone = tones[kind];
    if (!tone) return false;
    const bus: Bus =
      kind === 'kill'
        ? 'kill'
        : kind === 'hit' || kind === 'dense'
          ? 'hit'
          : kind === 'wave'
            ? 'skill'
            : 'reward';
    this.voices = this.voices.filter((v) => v.end > at);
    if (this.voices.length >= 8 || this.voices.filter((v) => v.bus === bus).length >= 2)
      return false;
    const ctx = this.context,
      oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    const end = at + tone[2];
    oscillator.type =
      kind === 'dense' || kind === 'wave' || kind === 'rhythm-complete' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(tone[0] * pitch, at);
    oscillator.frequency.exponentialRampToValueAtTime(tone[1] * pitch, end);
    if (kind === 'kill') {
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.007, at + 0.004);
    } else gain.gain.setValueAtTime(kind.startsWith('rhythm-') ? 0.045 : 0.025, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(ctx.destination);
    const voice = { bus, end, oscillator, gain };
    this.voices.push(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
    };
    oscillator.start(at);
    oscillator.stop(end);
    return true;
  }

  stop(): void {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.002);
      voice.oscillator.stop(now + 0.008);
    }
    this.voices = [];
  }
}

// Fixed buckets and no catch-up queue: a large burst never leaves a sound backlog.
export class KillRhythm {
  private buckets = Array.from({ length: 10 }, () => ({ tick: -Infinity, count: 0 }));
  private next = 0;
  private lastKill = -Infinity;
  private pulse = 0;
  add(count: number, time: number): void {
    if (count <= 0) return;
    const tick = Math.floor(time * 10),
      bucket = this.buckets[tick % 10];
    if (bucket.tick !== tick) {
      bucket.tick = tick;
      bucket.count = 0;
    }
    bucket.count = Math.min(200, bucket.count + count);
    this.lastKill = time;
  }
  update(time: number): number | null {
    const tick = Math.floor(time * 10);
    const rate = this.buckets.reduce((sum, b) => sum + (tick - b.tick < 10 ? b.count : 0), 0);
    if (!rate || time - this.lastKill > 0.24 || time + 1e-8 < this.next) return null;
    this.next = time + 1 / Math.min(12, Math.max(2, rate));
    this.pulse++;
    return 1 + Math.min(0.06, rate / 500) + ((this.pulse % 3) - 1) * 0.012;
  }
  reset(): void {
    for (const b of this.buckets) {
      b.tick = -Infinity;
      b.count = 0;
    }
    this.next = 0;
    this.lastKill = -Infinity;
    this.pulse = 0;
  }
}
