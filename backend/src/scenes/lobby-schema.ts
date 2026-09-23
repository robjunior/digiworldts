/**
 * Lobby scene settings — schema + sanitizer.
 *
 * Lives in its own module so BOTH the admin CRUD routes and the scene store
 * can consume it: routes validate writes, the store sanitizes reads. This is
 * the `kind: 'lobby'` settings subset of the scene editor split (see
 * shared/src/scene.ts): each scene kind binds its own subset and keeps the
 * envelope `.strict()` per subset — which is exactly why the sanitizer exists:
 * scenes saved before a subset shrank (e.g. the procedural-environment knobs
 * removed from the lobby) would otherwise come back from storage and fail the
 * strict parser on the next save. Sanitizing on read salvages them.
 */
import { z } from 'zod';

export const LOBBY_SETTINGS_KEYS = [
  'pedestalSpacing',
  'pedestalScale',
  'sideTiltDeg',
  'centerScale',
  'centerLift',
  'partyHeight',
  'driftIntensity',
  'digimonBrightness',
  'stageLightIntensity',
  'volumetricIntensity',
] as const;

export const LobbySceneSettingsZ = z.object({
  pedestalSpacing: z.number().min(0).max(1200),
  pedestalScale: z.number().min(0.3).max(2),
  sideTiltDeg: z.number().min(-60).max(60),
  centerScale: z.number().min(0.3).max(2),
  centerLift: z.number().min(-400).max(400),
  partyHeight: z.number().min(-6).max(6).optional(),
  driftIntensity: z.number().min(0).max(2),
  digimonBrightness: z.number().min(0.3).max(8).optional(),
  stageLightIntensity: z.number().min(0).max(6).optional(),
  volumetricIntensity: z.number().min(0).max(6).optional(),
}).strict();

/**
 * Keep only known lobby keys — drops leftovers from older schemas (floorColor,
 * grid*, seam*, glow*, spotlight, particle*) so a pre-shrink scene still
 * validates on the next write. Returns undefined when nothing known remains.
 */
export function sanitizeLobbySettings(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of LOBBY_SETTINGS_KEYS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}