import { getSoundDefinition, pickVariationIndex, SOUND_MANIFEST } from './manifest';
import { normalizePosition, spatialize } from './spatial';
import type {
  AudioBus,
  BufSourceLike,
  GainLike,
  SfxBackend,
  SfxHandle,
  SfxPlayOptions,
  SfxPreloadProgress,
  SoundId,
} from './types';

/**
 * The SFX engine: one AudioContext, Master (DynamicsCompressor) → buses
 * (sfx/ui/music), per-bus volume + mute persisted to localStorage, autoplay
 * resume on the first user gesture, suspend/resume on `visibilitychange`, a
 * data-driven manifest preloader with progress, and a voice-managed player
 * that round-robins variations, randomizes pitch/volume within the manifest
 * range, and enforces per-sound + global voice limits.
 *
 * The engine is headless-testable: construct with an injectable `SfxBackend`
 * (browser or fake) and a `StorageLike` adapter; everything that talks to the
 * platform funnels through those two seams.
 */

const VOLUME_KEY = 'digiworld.sfx.volume';
const MUTE_KEY = 'digiworld.sfx.mute';
const DEFAULT_BUS_VOLUMES: Record<AudioBus, number> = { sfx: 0.8, ui: 0.9, music: 0.7 };
const OK_VOL = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SfxEngineOptions = {
  backend: SfxBackend;
  storage?: StorageLike;
  /** Master fade-out/in applied when a voice leaves. Kept internal. */
  masterVolume?: number;
  maxTotalVoices?: number;
};

type ActiveVoice = {
  id: number;
  soundId: SoundId;
  bus: AudioBus;
  priority: number;
  group: string | null;
  source: BufSourceLike;
  out: GainLike;
  startedAt: number;
};

let voiceSeq = 1;

export class SfxEngine {
  readonly backend: SfxBackend;
  private readonly storage: StorageLike;
  private readonly masterGain: GainLike;
  private readonly busNodes = new Map<AudioBus, GainLike>();
  private readonly busVolumes = new Map<AudioBus, number>();
  private readonly busMuted = new Map<AudioBus, boolean>();
  private readonly decodePromises = new Map<string, Promise<unknown> | null>();
  private readonly buffers = new Map<string, unknown>();
  private readonly voices = new Map<number, ActiveVoice>();
  private readonly lastVariation = new Map<SoundId, number>();
  private readonly maxTotalVoices: number;
  private progress: SfxPreloadProgress | null = null;
  private timeScale = 1;

  constructor(options: SfxEngineOptions) {
    this.backend = options.backend;
    this.storage = options.storage ?? memoryStorage();
    this.maxTotalVoices = options.maxTotalVoices ?? 24;

    // Master → DynamicsCompressor → destination.
    this.masterGain = this.backend.createGain();
    const compressor = this.backend.createDynamicsCompressor();
    this.backend.connect(this.masterGain, compressor);
    this.backend.connect(compressor, this.backend.destination);
    if (typeof options.masterVolume === 'number') {
      this.masterGain.gain.value = options.masterVolume;
    }

    for (const bus of ['sfx', 'ui', 'music'] as const) {
      const g = this.backend.createGain();
      this.backend.connect(g, this.masterGain);
      this.busNodes.set(bus, g);
      this.busVolumes.set(bus, this.readVolume(bus));
      this.busMuted.set(bus, this.storage.getItem(MUTE_KEY + '.' + bus) === '1');
      this.applyBusGain(bus);
    }
  }

  private readVolume(bus: AudioBus): number {
    const raw = this.storage.getItem(VOLUME_KEY + '.' + bus);
    if (raw === null) return DEFAULT_BUS_VOLUMES[bus];
    const n = Number(raw);
    return OK_VOL(n) ? n : DEFAULT_BUS_VOLUMES[bus];
  }

  // ── Volume / mix ───────────────────────────────────────────────────────
  getBusVolume(bus: AudioBus): number {
    return this.busVolumes.get(bus) ?? DEFAULT_BUS_VOLUMES[bus];
  }
  isBusMuted(bus: AudioBus): boolean {
    return this.busMuted.get(bus) ?? false;
  }
  setBusVolume(bus: AudioBus, volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.busVolumes.set(bus, v);
    this.storage.setItem(VOLUME_KEY + '.' + bus, String(v));
    this.applyBusGain(bus);
  }
  setBusMuted(bus: AudioBus, muted: boolean): void {
    this.busMuted.set(bus, muted);
    this.storage.setItem(MUTE_KEY + '.' + bus, muted ? '1' : '0');
    this.applyBusGain(bus);
  }
  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }
  private applyBusGain(bus: AudioBus): void {
    const node = this.busNodes.get(bus);
    if (!node) return;
    const muted = this.busMuted.get(bus) ?? false;
    node.gain.value = muted ? 0 : this.busVolumes.get(bus) ?? DEFAULT_BUS_VOLUMES[bus];
  }

  // ── Autoplay / lifecycle ───────────────────────────────────────────────
  async resume(): Promise<void> {
    try { await this.backend.resume(); } catch { /* best-effort */ }
  }
  async suspend(): Promise<void> {
    try { await this.backend.suspend(); } catch { /* best-effort */ }
  }
  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0.1, Math.min(4, scale));
  }
  get currentTimeScale(): number {
    return this.timeScale;
  }
  get voiceCount(): number {
    return this.voices.size;
  }

  // ── Preload ────────────────────────────────────────────────────────────
  get totalCount(): number {
    return allManifestUrls().length;
  }
  get loadedCount(): number {
    return this.buffers.size;
  }

  async preload(onProgress?: SfxPreloadProgress): Promise<void> {
    this.progress = onProgress ?? null;
    const urls = allManifestUrls();
    let done = 0;
    const total = urls.length;
    const tick = (): void => {
      done += 1;
      this.progress?.(done, total, total > 0 ? done / total : 1);
    };
    await Promise.all(urls.map(async (url) => {
      await this.decode(url).catch(() => { /* skip missing */ });
      tick();
    }));
  }

  private async decode(url: string): Promise<unknown> {
    const cached = this.decodePromises.get(url);
    if (cached !== undefined && cached !== null) return cached;
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`sfx ${res.status} ${url}`);
      const ab = await res.arrayBuffer();
      const buf = await this.backend.decodeAudioData(ab);
      this.buffers.set(url, buf);
      return buf;
    })();
    this.decodePromises.set(url, p);
    return p;
  }

  private bufferOf(url: string): unknown {
    return this.buffers.get(url) ?? null;
  }

  // ── Playback ───────────────────────────────────────────────────────────
  play(id: SoundId, opts: SfxPlayOptions = {}): SfxHandle {
    const def = getSoundDefinition(id);
    const bus: AudioBus = opts.bus ?? def.bus;
    if (def.variations.length === 0) return noopHandle();

    const last = this.lastVariation.get(id) ?? null;
    const idx = pickVariationIndex(def.variations.length, last);
    this.lastVariation.set(id, idx);
    const url = def.variations[idx]!.url;

    const when = this.backend.currentTime + (opts.delay ?? 0);
    const source = this.backend.createBufferSource();
    const out = this.backend.createGain();
    const busNode = this.busNodes.get(bus) ?? this.masterGain;

    let vol = def.volume * (opts.volume ?? 1) * (opts.gain ?? 1);
    let pan = opts.pan;
    if (opts.position) {
      const norm = normalizePosition(opts.position.screenX, opts.position.viewportWidth, opts.position.onScreen);
      const s = spatialize(norm);
      pan = s.pan;
      vol *= s.gain;
    }
    out.gain.value = vol;

    // Pitch: random within manifest range (overridable), then × timeScale.
    let rate = opts.pitch ?? (1 + (Math.random() * 2 - 1) * def.pitchRange);
    rate *= this.timeScale;
    source.playbackRate.value = rate;
    source.loop = opts.loop === true;

    const voice: ActiveVoice = {
      id: voiceSeq++,
      soundId: id,
      bus,
      priority: opts.bus !== undefined ? def.priority : def.priority,
      group: opts.group ?? null,
      source,
      out,
      startedAt: this.backend.currentTime,
    };
    this.voices.set(voice.id, voice);
    this.pruneVoices();

    // Spatial panner chain: source → out → panner → busNode.
    if (pan !== undefined) {
      const panner = this.backend.createStereoPanner();
      panner.pan.value = pan;
      this.backend.connect(source, out);
      this.backend.connect(out, panner);
      this.backend.connect(panner, busNode);
    } else {
      this.backend.connect(source, out);
      this.backend.connect(out, busNode);
    }

    const buf = this.bufferOf(url);
    if (!buf) {
      // Still loading/missing: reserve the voice slot; silence until loaded.
      return this.returnHandle(voice, false);
    }
    source.buffer = buf as never;
    if (source.loop) {
      source.start(when, 0);
      return this.returnHandle(voice, true);
    }
    source.start(when);
    source.onended = () => { this.voices.delete(voice.id); };
    // schedule the slot release even if `ended` never fires in a fake.
    const dur = (buf as unknown as { duration: number }).duration;
    const lifetime = when - this.backend.currentTime + (dur / rate);
    if (lifetime >= 0) {
      const t = () => { this.voices.delete(voice.id); };
      if (typeof window !== 'undefined') window.setTimeout(t, (lifetime + 0.02) * 1000);
    }
    return noopHandle();
  }

  private returnHandle(voice: ActiveVoice, loop: boolean): SfxHandle {
    if (loop) {
      return { id: voice.id, soundId: voice.soundId, stop: (fadeMs) => this.stopVoice(voice.id, fadeMs) };
    }
    return noopHandle();
  }

  stopVoice(voiceId: number, fadeMs = 0): void {
    const v = this.voices.get(voiceId);
    if (!v) return;
    const now = this.backend.currentTime;
    if (fadeMs > 0) {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      try { v.source.stop(now + fadeMs / 1000 + 0.02); } catch { /* already stopped */ }
    } else {
      try { v.source.stop(); } catch { /* already stopped */ }
    }
    this.voices.delete(voiceId);
  }

  cancelGroup(groupId: string, fadeMs = 0): void {
    for (const v of [...this.voices.values()]) {
      if (v.group === groupId) this.stopVoice(v.id, fadeMs);
    }
  }

  stopAll(): void {
    for (const id of [...this.voices.keys()]) this.stopVoice(id, 0);
  }

  private pruneVoices(): void {
    if (this.voices.size <= this.maxTotalVoices) return;
    const sorted = [...this.voices.values()].sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt);
    const excess = this.voices.size - this.maxTotalVoices;
    for (let i = 0; i < excess; i += 1) this.stopVoice(sorted[i]!.id, 0);
  }

  dispose(): void {
    this.stopAll();
    this.busNodes.forEach((n) => this.backend.disconnect(n));
    this.busNodes.clear();
  }
}

function noopHandle(): SfxHandle {
  return { id: -1, soundId: 'ui_click', stop: () => { /* one-shot */ } };
}

function allManifestUrls(): string[] {
  const seen = new Set<string>();
  for (const id of Object.keys(SOUND_MANIFEST) as SoundId[]) {
    for (const v of SOUND_MANIFEST[id].variations) seen.add(v.url);
  }
  return [...seen];
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}