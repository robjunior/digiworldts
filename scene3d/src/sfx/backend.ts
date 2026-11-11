import type {
  AudioBufferLike,
  BufSourceLike,
  ConnectableLike,
  GainLike,
  SfxBackend,
  StereoPannerLike,
} from './types';

/**
 * Real Web Audio backend: maps the engine's abstract node surface onto an
 * `AudioContext`. Kept in its own module so the engine body stays headless-
 * testable (tests inject a fake backend) and SSR/inert environments can
 * substitute a silent backend without loading Web Audio at all.
 */

type Ctor = typeof AudioContext;

function audioContextClass(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof w.webkitAudioContext === 'function') return w.webkitAudioContext as Ctor;
  return null;
}

export interface BrowserBackend extends SfxBackend {
  readonly ctx: AudioContext;
  /** Created master DynamicsCompressor (also reachable via `masterNode`). */
  readonly compressor: DynamicsCompressorNode;
  readonly destination: unknown;
  createGain(): GainLike;
  createStereoPanner(): StereoPannerLike;
  createDynamicsCompressor(): ConnectableLike;
  createBufferSource(): BufSourceLike;
}

export function createBrowserBackend(): { ok: true; backend: BrowserBackend } | { ok: false; reason: string } {
  const Ctor = audioContextClass();
  if (Ctor === null) return { ok: false, reason: 'no-audio-context' };
  try {
    const ctx = new Ctor();
    // Some builds recommend a 48k context for low latency; three's AudioListener
    // would reuse ctx anyway. Config bool optional but harmless to set via a
    // fresh context (we never force a sample rate — the platform decides).
    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);
    return { ok: true, backend: new BrowserBackendImpl(ctx, compressor) };
  } catch (err) {
    return { ok: false, reason: String((err as Error)?.message ?? err) };
  }
}

class BrowserBackendImpl implements BrowserBackend {
  readonly ctx: AudioContext;
  readonly compressor: DynamicsCompressorNode;
  constructor(ctx: AudioContext, compressor: DynamicsCompressorNode) {
    this.ctx = ctx;
    this.compressor = compressor;
  }
  get currentTime(): number {
    return this.ctx.currentTime;
  }
  get sampleRate(): number {
    return this.ctx.sampleRate;
  }
  get destination(): unknown {
    return this.ctx.destination;
  }
  connect(from: GainLike, to: GainLike | AudioNode): void {
    (from as unknown as AudioNode).connect(to as AudioNode);
  }
  disconnect(from: GainLike): void {
    (from as unknown as AudioNode).disconnect();
  }
  createGain(): GainLike {
    return this.ctx.createGain();
  }
  createStereoPanner(): StereoPannerLike {
    return this.ctx.createStereoPanner() as unknown as StereoPannerLike;
  }
  createDynamicsCompressor(): ConnectableLike {
    return this.ctx.createDynamicsCompressor();
  }
  createBufferSource(): BufSourceLike {
    return this.ctx.createBufferSource() as unknown as BufSourceLike;
  }
  resume(): Promise<void> {
    return this.ctx.resume();
  }
  suspend(): Promise<void> {
    return this.ctx.suspend();
  }
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    return this.ctx.decodeAudioData(data.slice(0));
  }
}