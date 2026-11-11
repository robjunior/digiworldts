/**
 * World scene settings — schema + sanitizer.
 *
 * Lives in its own module so BOTH the admin CRUD routes and the scene store
 * can consume it: routes validate writes, the store sanitizes reads. This is
 * the `kind: 'world'` settings subset of the scene editor split (see
 * shared/src/scene.ts): each scene kind binds its own subset and keeps the
 * envelope `.strict()` per subset — which is exactly why the sanitizer exists:
 * scenes saved before a subset shrank would otherwise come back from storage
 * and fail the strict parser on the next save. Sanitizing on read salvages them.
 */
import { z } from 'zod';

export const WORLD_SETTINGS_KEYS = [
  'autoSpin',
  'nodeScale',
  'ringScale',
  'graticuleOpacity',
  'glowOpacity',
  'camDistMin',
  'camDistMax',
  'globeY',
  'camYawDeg',
  'camElevDeg',
  'ringRadius',
] as const;

export const WorldSceneSettingsZ = z.object({
  autoSpin: z.boolean().optional(),
  nodeScale: z.number().min(0.005).max(0.2),
  ringScale: z.number().min(0.01).max(0.4),
  graticuleOpacity: z.number().min(0).max(1),
  glowOpacity: z.number().min(0).max(1),
  camDistMin: z.number().min(0.5).max(20),
  camDistMax: z.number().min(0.5).max(20),
  globeY: z.number().min(0).max(5),
  camYawDeg: z.number().min(-180).max(180),
  camElevDeg: z.number().min(-80).max(80),
  ringRadius: z.number().min(2.4).max(20),
}).strict();

/** Seeded values for a `kind: 'world'` scene (mirrors scene3d DEFAULT_WORLD_SCENE). */
export const DEFAULT_WORLD_SCENE = {
  autoSpin: true,
  nodeScale: 0.032,
  ringScale: 0.058,
  graticuleOpacity: 0.34,
  glowOpacity: 0.05,
  camDistMin: 2.5,
  camDistMax: 7,
  globeY: 1.35,
  camYawDeg: 0,
  camElevDeg: 0,
  ringRadius: 3.0,
} as const;

/**
 * Keep only known world keys — drops leftovers from older schemas so a stale
 * scene still validates on the next write. Returns undefined when nothing
 * known remains.
 */
export function sanitizeWorldSettings(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of WORLD_SETTINGS_KEYS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}