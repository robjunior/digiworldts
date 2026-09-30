import type { AudioBufferLike, AudioParamLike, BufSourceLike, ConnectableLike, GainLike, SfxBackend, StereoPannerLike } from './types';

/**
 * Deterministic fake backend for headless tests: drives `currentTime`
 * manually and records every node created/connected/started so assertions can
 * inspect the exact graph + scheduling without Web Audio.
 */
export class FakeBackend implements SfxBackend {
  currentTime = 0;
  sampleRate = 48000;
  destination = { kind: 'destination' as const };
  /** Every node created, in order. */
  readonly nodes: unknown[] = [];
  readonly connects: Array<[unknown, unknown]> = [];
  readonly started: Array<{ source: BufSourceLike; when: number }> = [];
  readonly stopped: Array<{ source: BufSourceLike; when?: number }> = [];
  resumeCalls = 0;
  suspendCalls = 0;
  /** Register buffers so `decodeAudioData` resolves synchronously. */
  private readonly buffers = new Map<number, AudioBufferLike>();
  private nextDecodeToken = 1;

  advance(t: number): void {
    this.currentTime = t;
  }

  registerBuffer(durationMs = 300): number {
    const token = this.nextDecodeToken++;
    this.buffers.set(token, { duration: durationMs / 1000, sampleRate: this.sampleRate, length: Math.floor(durationMs / 1000 * this.sampleRate) });
    return token;
  }

  private param(v: number): AudioParamLike {
    return {
      value: v,
      setValueAtTime(_t: number, val: number): void { this.value = val; },
      cancelScheduledValues(_t: number): void {},
      exponentialRampToValueAtTime(val: number, _t: number): void { this.value = val; },
      linearRampToValueAtTime(val: number, _t: number): void { this.value = val; },
    };
  }

  connect(from: unknown, to: unknown): void {
    this.connects.push([from, to]);
  }
  disconnect(_from: unknown): void {}

  createGain(): GainLike {
    const g: GainLike = { gain: this.param(1), connect: (to) => this.connects.push([g, to]), disconnect: () => {} };
    this.nodes.push(g);
    return g;
  }
  createStereoPanner(): StereoPannerLike {
    const p: StereoPannerLike = { gain: this.param(1), pan: this.param(0), connect: (to) => this.connects.push([p, to]), disconnect: () => {} };
    this.nodes.push(p);
    return p;
  }
  createDynamicsCompressor(): ConnectableLike {
    const c: ConnectableLike = { connect: (to) => this.connects.push([c, to]), disconnect: () => {} };
    this.nodes.push(c);
    return c;
  }
  createBufferSource(): BufSourceLike {
    const s: BufSourceLike = {
      buffer: null,
      loop: false,
      playbackRate: this.param(1),
      onended: null,
      connect: (to) => this.connects.push([s, to]),
      disconnect: () => {},
      start: (when = this.currentTime) => { this.started.push({ source: s, when }); },
      stop: (when?: number) => {
        const entry: { source: BufSourceLike; when?: number } = { source: s };
        if (when !== undefined) entry.when = when;
        this.stopped.push(entry);
      },
    };
    this.nodes.push(s);
    return s;
  }
  resume(): Promise<void> { this.resumeCalls += 1; return Promise.resolve(); }
  suspend(): Promise<void> { this.suspendCalls += 1; return Promise.resolve(); }
  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBufferLike> {
    // Return the first registered buffer. Tests that need real decoding assert
    // via `buffer` on the source instead.
    return this.buffers.values().next().value ?? { duration: 0.3, sampleRate: this.sampleRate, length: 0 };
  }
}