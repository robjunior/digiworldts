/**
 * Skill VFX preset resolution, injected by the host application.
 *
 * `scene.ts` needs to turn a `vfxPresetId` carried on a battle event into a
 * `SkillVfxPreset` so it can build a preset runner. Fetching that preset is an
 * HTTP concern — it lives behind `/api/skill-vfx-presets`, with per-app caching
 * and auth — and this package renders, so it must not reach for the network.
 *
 * When `scene3d` lived inside each application this was a relative import of
 * `../lib/api-skill-vfx-presets`, which is exactly why the directory could not
 * be shared: the two copies looked identical but resolved to their own app's
 * module. Injection removes that coupling instead of duplicating it.
 *
 * Applications call `setSkillVfxPresetResolver` once during startup. Until they
 * do — and whenever the preset is unknown or its cache is cold — resolution
 * returns `null` and `playEffect` falls back to the per-element runner, which
 * is the intended degraded path rather than an error.
 */
import type { SkillVfxPreset } from '@digiworld/shared/skill-vfx';

export type SkillVfxPresetResolver = (id: string) => SkillVfxPreset | null;

let resolver: SkillVfxPresetResolver | null = null;

/** Install the host application's synchronous preset lookup. */
export function setSkillVfxPresetResolver(next: SkillVfxPresetResolver): void {
  resolver = next;
}

/** Remove the installed resolver. Intended for tests and teardown. */
export function clearSkillVfxPresetResolver(): void {
  resolver = null;
}

/**
 * Resolve a preset by id, or `null` when no resolver is installed, the id is
 * unknown, or the host's cache has not warmed yet. Never throws: a missing
 * preset must degrade to the element runner, not break playback.
 */
export function resolveSkillVfxPreset(id: string): SkillVfxPreset | null {
  if (resolver === null) return null;
  try {
    return resolver(id);
  } catch {
    return null;
  }
}
