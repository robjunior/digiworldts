/** Audio/SFX subsystem — engine, manifest, spatialization, cue router. */
export { SfxEngine, type SfxEngineOptions, type StorageLike } from './engine';
export { createBrowserBackend, type BrowserBackend } from './backend';
export {
  SOUND_MANIFEST,
  ALL_SOUND_IDS,
  getSoundDefinition,
  pickVariationIndex,
} from './manifest';
export {
  panFromScreenX,
  gainFromScreen,
  combinedGain,
  normalizePosition,
  spatialize,
  type ScreenProjection,
} from './spatial';
export {
  CueRouter,
  defaultCues,
  bindDomSfx,
  createDomSfxHandler,
  uiSoundId,
  type CueEvent,
  type CueSoundId,
  type CueOpts,
  type CueStep,
  type PlayFn,
} from './cue-router';
export type {
  AudioBus,
  SoundId,
  SoundDefinition,
  SfxHandle,
  SfxPlayOptions,
  SfxPreloadProgress,
  SfxBackend,
  AudioBufferLike,
  AudioParamLike,
  ConnectableLike,
  GainLike,
  StereoPannerLike,
  BufSourceLike,
} from './types';