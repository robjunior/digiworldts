/**
 * `@digiworld/scene3d` — the Three.js battle/pen renderer shared by the player
 * frontend and the admin panel.
 *
 * This directory previously existed twice, as `frontend/src/scene3d` and
 * `admin/src/scene3d`, byte-for-byte identical. Both copies imported
 * `../lib/api-skill-vfx-presets`, which resolved to each app's own module —
 * so the files could not simply be shared without first removing that coupling.
 * See `./skill-vfx-resolver` for how preset lookup is injected instead.
 *
 * Consumers import granular subpaths (`@digiworld/scene3d/scene`,
 * `@digiworld/scene3d/attack-runners/types`, ...) which mirror the file tree.
 * This barrel only re-exports the entry points every host needs.
 *
 * The package is source-only: it ships `.ts` and is transpiled by each app's
 * bundler, so there is no build step and no `dist` to drift out of date. Both
 * consumers are Vite applications, and the backend deliberately does not depend
 * on it — putting this in `@digiworld/shared` would have pulled Three.js into
 * the API, since the backend consumes that package.
 */
export { SceneManager } from './scene';
export {
  clearSkillVfxPresetResolver,
  resolveSkillVfxPreset,
  setSkillVfxPresetResolver,
  type SkillVfxPresetResolver,
} from './skill-vfx-resolver';
export type { SpriteInit, SceneSettings } from './scene';
export { unitSpriteSheetUrl, unitSpriteStaticUrl, unitDotUrl } from './sprite-rig';
export {
  cycleCells,
  cellRect,
  resolveSheetLayout,
  CYCLES12_COLS,
  CYCLES12_ROWS,
  CYCLES12_CYCLE_CELLS,
  DEFAULT_IDLE_CELL,
  type SheetLayout,
  type SheetVersion,
  type SpriteCycle,
} from './sheet-layout';
export { prewarmParticleMaterials } from './particles/shaders';
export {
  NAMED_RUNNERS,
  isNamedEffect,
  isRangedEffect,
  namedEffectDuration,
  tryBuildNamedRunner,
} from './attack-runners/named';
export { MELEE_RUNNERS, buildMeleeRunner } from './attack-runners/melee';
export {
  StatusFxController,
  createStatusPools,
  type StatusFxTarget,
  type AilmentKind,
} from './attack-runners/status-controller';
export {
  buildStatusEffect,
  cleanseStatuses,
  STATUS_IMAGES,
  type StatusEffect,
  type StatusFxEnv,
} from './attack-runners/status-fx';
export { buildDarkVoidRunner } from './attack-runners/dark-void';
export { buildHolySmiteRunner } from './attack-runners/holy-smite';
export { buildTidalSurgeRunner } from './attack-runners/tidal-surge';
export { buildBladeStormRunner } from './attack-runners/blade-storm';
export { buildStoneFallRunner } from './attack-runners/stone-fall';
export { buildNullPulseRunner } from './attack-runners/null-pulse';
export { buildVineLashRunner } from './attack-runners/vine-lash';
export type { SkillVfxNamedEffect, SkillVfxRangedEffect, SkillVfxMeleeEffect } from '@digiworld/shared/skill-vfx';
// Audio/SFX subsystem (engine + manifest + spatialization + cue router).
export * from './sfx';
