export function audioContext() {
  const param = () => ({
    value: 0,
    values: [] as { method: string; value: number; at: number }[],
    setValueAtTime(value: number, at: number) {
      this.values.push({ method: 'set', value, at });
    },
    cancelAndHoldAtTime(_at: number) {},
    setTargetAtTime(value: number, at: number, _constant: number) {
      this.values.push({ method: 'target', value, at });
    },
  });
  const node = () => ({
    disconnected: false,
    connect<T>(next: T): T {
      return next;
    },
    disconnect() {
      this.disconnected = true;
    },
  });
  const source = () => ({
    ...node(),
    end: Infinity,
    started: false,
    buffer: null as { duration: number } | null,
    playbackRate: param(),
    onended: () => {},
    start(_at: number) {
      this.started = true;
    },
    stop(at: number) {
      this.end = at;
    },
  });
  const sources: ReturnType<typeof source>[] = [];
  const gains: (ReturnType<typeof node> & { gain: ReturnType<typeof param> })[] = [];
  const graph: ReturnType<typeof node>[] = [];
  const pans: (ReturnType<typeof node> & { pan: ReturnType<typeof param> })[] = [];
  const filters: (ReturnType<typeof node> & {
    type: string;
    frequency: ReturnType<typeof param>;
    Q: ReturnType<typeof param>;
  })[] = [];
  const buffers: { duration: number; getChannelData: (_channel: number) => Float32Array }[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 24000,
    destination: {},
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      const buffer = { duration: length / sampleRate, getChannelData: (_channel: number) => data };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      const s = source();
      sources.push(s);
      return s;
    },
    createGain() {
      const g = { ...node(), gain: param() };
      gains.push(g);
      return g;
    },
    createStereoPanner() {
      const n = { ...node(), pan: param() };
      graph.push(n);
      pans.push(n);
      return n;
    },
    createBiquadFilter() {
      const n = { ...node(), type: '', frequency: param(), Q: param() };
      graph.push(n);
      filters.push(n);
      return n;
    },
    createDynamicsCompressor() {
      const n = {
        ...node(),
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      };
      graph.push(n);
      return n;
    },
  };
  const advance = (time: number) => {
    ctx.currentTime = time;
    for (const s of sources.filter((s) => !s.disconnected && s.end <= time)) s.onended();
  };
  return {
    ctx: ctx as unknown as BaseAudioContext,
    sources,
    gains,
    graph,
    pans,
    filters,
    buffers,
    advance,
  };
}
