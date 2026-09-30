/**
 * Core SFX type vocabulary shared by every module in the audio subsystem.
 *
 * The engine is deliberately decoupled from Three.js: callers project world
 * positions to screen coordinates themselves (the `Combat3DSceneHandle`
 * exposes `screenPositionOf`, and `SceneManager.projectWorldToScreen` computes
 * the projection math). Keeping the Web Audio graph here means it runs
 * headlessly in tests with a mock backend, and is shared unmodified by the
 * player frontend and the admin panel.
 */

/** Audio buses. Every sound routes to exactly one; the `music` bus is created
 *  and mixable but intentionally unused until a soundtrack exists. */
export type AudioBus = 'sfx' | 'ui' | 'music';

/** All sound ids the manifest can be asked to play — a typed union so a
 *  misspelled id is a compile error, not a silent no-op. Register new sounds
 *  by adding a literal here AND an entry in `SOUND_MANIFEST`.
 *
 *  Keep ids lowercase_snake, grouped by domain:
 *    ui_*     — chrome / navigation / buttons
 *    tile_*   — board interaction (hover / select / invalid)
 *    combat_* — attack layers, impacts, footsteps, turn flow
 *    status_* — buffs, heals, dot ticks, deaths
 */
export type SoundId =
  | 'ui_hover'
  | 'ui_click'
  | 'ui_confirm'
  | 'ui_back'
  | 'ui_error'
  | 'ui_open'
  | 'ui_close'
  | 'tile_hover'
  | 'tile_select'
  | 'tile_invalid'
  | 'unit_select'
  | 'combat_swing'
  | 'combat_impact'
  | 'combat_impact_flesh'
  | 'combat_impact_armor'
  | 'combat_impact_stone'
  | 'combat_impact_wood'
  | 'combat_impact_heavy'
  | 'combat_impact_crit'
  | 'combat_footstep_grass'
  | 'combat_footstep_stone'
  | 'combat_footstep_wood'
  | 'combat_footstep_water'
  | 'combat_cast'
  | 'combat_projectile'
  | 'combat_miss'
  | 'combat_block'
  | 'combat_fizzle'
  | 'status_buff'
  | 'status_debuff'
  | 'status_dot'
  | 'status_heal'
  | 'status_death'
  | 'turn_start'
  | 'turn_end';

/** A single authored asset for one id. */
export type SoundVariationSource = {
  /** URL of the encoded audio file (mp3/ogg/webm). Fetched + decoded on load. */
  url: string;
};

/** Player-facing options on a single `play(id, opts)` call. Every field
 *  optional — the manifest supplies defaults; these override them per call. */
export type SfxPlayOptions = {
  /** Override the manifest bus. Rarely needed; mostly for tests. */
  bus?: AudioBus;
  /** Override the manifest base volume (0..1). */
  volume?: number;
  /** Hard base volume multiplier applied on top of everything (used for
   *  damage-scaling, ducking, focus mixing). */
  gain?: number;
  /** Fixed pan in StereoPanner terms (-1..1). Overrides spatial pan when set
   *  and `position` is absent. */
  pan?: number;
  /** World/screen position for isometric spatialization. When present the
   *  engine derives pan + distance gain from it; `pan` above is ignored. */
  position?: { screenX: number; viewportWidth: number; onScreen: boolean };
  /** Fixed playback-rate multiplier (e.g. 1.5 = faster/higher). Overrides the
   *  manifest pitch-random range when the caller wants a deterministic rate. */
  pitch?: number;
  /** Seconds from `ctx.currentTime` to schedule the start. Never uses
   *  setTimeout, so it stays sample-accurate and survives skips. */
  delay?: number;
  /** Loop until the returned handle's `stop(fadeMs)`. */
  loop?: boolean;
  /** For loops: the id of a scheduling group. Calling `cancelGroup(groupId)`
   *  stops every looping/scheduled sound in that group (animation skips). */
  group?: string;
};

/** Handle returned by `play` for a looping (or cancellable delayed) sound. */
export type SfxHandle = {
  readonly id: number;
  readonly soundId: SoundId;
  /** Stop the sound, optionally fading `fadeMs` to silence first. */
  stop(fadeMs?: number): void;
};

/** Callbacks reported during a manifest preload. `fraction` is monotonic. */
export type SfxPreloadProgress = (loaded: number, total: number, fraction: number) => void;

/** Manifest entry — authoring is data, and per-spec everything the player
 *  needs is here (files/variations, bus, base volume, pitch range, priority,
 *  simultaneous-instance limit). */
export type SoundDefinition = {
  /** Ordered variations; the player round-robins without repeating the last. */
  variations: readonly SoundVariationSource[];
  bus: AudioBus;
  /** Base volume (0..1) in the manifest, before bus/master mix. */
  volume: number;
  /** Random pitch range: `playbackRate ∈ [1-pitchRange, 1+pitchRange]`. */
  pitchRange: number;
  /** Priority, higher = wins voice-stealing when limits overflow (0 lowest). */
  priority: number;
  /** Simultaneous instances allowed of this id before the oldest/least
   *  priority extra voice is discarded. */
  maxInstances: number;
};

/** False when no sound browser exists (headless / SSR). */
export const AUDIO_CTX_SAMPLE_RATE = 48000;

/** The subset of the Web Audio surface the engine touches, abstracted as a
 *  minimal interface so tests can substitute a deterministic fake. The real
 *  implementation wraps an `AudioContext`. */
export interface SfxBackend {
  readonly currentTime: number;
  readonly sampleRate: number;
  /** Routes `output` into `input` (or the master destination). */
  connect(from: unknown, to: unknown): void;
  disconnect(from: unknown): void;
  createGain(): GainLike;
  createStereoPanner(): StereoPannerLike;
  /** Dynamics compressor: connectable, no `gain` param. */
  createDynamicsCompressor(): ConnectableLike;
  createBufferSource(): BufSourceLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** The final output node (AudioContext.destination in a browser). */
  destination: unknown;
}

/** A connectable node with no gain — DynamicsCompressor, destination, etc. */
export interface ConnectableLike {
  connect(to: unknown): void;
  disconnect(): void;
}

/** The node surface the engine uses on a gain/panner: a `gain` attr + connect/
 *  disconnect. Every created node obeys this shape. */
export interface GainLike {
  readonly gain: AudioParamLike;
  connect(to: unknown): void;
  disconnect(): void;
}
/** An `AudioParam`-shaped object `{ value, setValueAtTime, ... }`. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(t: number, v: number): void;
  cancelScheduledValues(t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
}
export interface StereoPannerLike extends GainLike {
  readonly pan: AudioParamLike;
}
/** An `AudioBufferSourceNode`-shaped object. Has no `gain` of its own — the
 *  engine routes it through a GainLike explicitly. */
export interface BufSourceLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  connect(to: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}
export interface AudioBufferLike {
  readonly duration: number;
  readonly sampleRate: number;
  readonly length: number;
}