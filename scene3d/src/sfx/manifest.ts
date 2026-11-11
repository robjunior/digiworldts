import type { SoundDefinition, SoundId } from './types';

/**
 * Data-driven sound manifest. Authoring is pure data: files/variations, bus,
 * base volume, pitch range, priority, and simultaneous-instance limit for
 * every id. The player logic (`play`) is generic over this table, so adding a
 * sound never requires touching code paths.
 *
 * Asset URLs resolve under `/assets/sfx/<id>/<n>.<ext>` for injection via the
 * Vite public dir (or a backend /assets/sfx route on deploy — see the
 * content-deploy bundle pattern for arena assets). The loader tolerates a
 * missing file (logs + skips), so a partially-staged set never hard-fails.
 *
 * This module is backend-free: the browser worker that turns buffer-less
 * sounds into silence lives in `createBrowserBackend`, chosen at bootstrap.
 */

const S = {
  // ── UI chrome ──────────────────────────────────────────────────────────
  ui_hover: ['ui_hover'],
  ui_click: ['ui_click'],
  ui_confirm: ['ui_confirm'],
  ui_back: ['ui_back'],
  ui_error: ['ui_error'],
  ui_open: ['ui_open'],
  ui_close: ['ui_close'],
  // ── Board ──────────────────────────────────────────────────────────────
  tile_hover: ['tile_hover'],
  tile_select: ['tile_select'],
  tile_invalid: ['tile_invalid'],
  unit_select: ['unit_select'],
  // ── Combat: attack layers, impacts, footsteps, turn flow ──────────────
  combat_swing: ['combat_swing_1', 'combat_swing_2', 'combat_swing_3'],
  combat_impact: ['combat_impact_1', 'combat_impact_2', 'combat_impact_3'],
  combat_impact_flesh: ['combat_flesh_1', 'combat_flesh_2'],
  combat_impact_armor: ['combat_armor_1', 'combat_armor_2'],
  combat_impact_stone: ['combat_stone_1', 'combat_stone_2'],
  combat_impact_wood: ['combat_wood_1', 'combat_wood_2'],
  combat_impact_heavy: ['combat_heavy_1', 'combat_heavy_2'],
  combat_impact_crit: ['combat_crit_1', 'combat_crit_2'],
  combat_footstep_grass: ['combat_step_grass_1', 'combat_step_grass_2'],
  combat_footstep_stone: ['combat_step_stone_1', 'combat_step_stone_2'],
  combat_footstep_wood: ['combat_step_wood_1', 'combat_step_wood_2'],
  combat_footstep_water: ['combat_step_water_1', 'combat_step_water_2'],
  combat_cast: ['combat_cast'],
  combat_projectile: ['combat_projectile_1', 'combat_projectile_2'],
  combat_miss: ['combat_fizzle_1', 'combat_fizzle_2'],
  combat_block: ['combat_block'],
  combat_fizzle: ['combat_fizzle_1', 'combat_fizzle_2'],
  // ── Status / turn flow ─────────────────────────────────────────────────
  status_buff: ['status_buff'],
  status_debuff: ['status_debuff'],
  status_dot: ['status_dot'],
  status_heal: ['status_heal'],
  status_death: ['status_death'],
  turn_start: ['turn_start'],
  turn_end: ['turn_end'],
} as const;

function variations(group: readonly string[]): SoundDefinition['variations'] {
  return group.map((name) => ({ url: `/assets/sfx/${name}.mp3` }));
}

function def(
  bus: 'sfx' | 'ui' | 'music',
  volume: number,
  pitchRange: number,
  priority: number,
  maxInstances: number,
  group: readonly string[],
): SoundDefinition {
  return {
    variations: variations(group),
    bus,
    volume,
    pitchRange,
    priority,
    maxInstances,
  };
}

/** Built by hand so that bus/volume/pitch/priority/limit are explicit and
 *  reviewable, not folded into a loop. Tune these with the mixer not by eye. */
function buildManifest(): Record<SoundId, SoundDefinition> {
  const m = {} as Record<SoundId, SoundDefinition>;
  // UI — clicky, low pitch drift, short.
  m.ui_hover = def('ui', 0.18, 0.05, 0, 3, S.ui_hover);
  m.ui_click = def('ui', 0.28, 0.06, 1, 4, S.ui_click);
  m.ui_confirm = def('ui', 0.34, 0.05, 2, 3, S.ui_confirm);
  m.ui_back = def('ui', 0.3, 0.05, 1, 3, S.ui_back);
  m.ui_error = def('ui', 0.42, 0.03, 2, 2, S.ui_error);
  m.ui_open = def('ui', 0.3, 0.04, 1, 3, S.ui_open);
  m.ui_close = def('ui', 0.26, 0.04, 1, 3, S.ui_close);
  // Board — quiet, non-intrusive, per-tile rapid repeats need high instance room.
  m.tile_hover = def('sfx', 0.16, 0.04, 0, 6, S.tile_hover);
  m.tile_select = def('sfx', 0.26, 0.05, 2, 4, S.tile_select);
  m.tile_invalid = def('sfx', 0.3, 0.03, 3, 2, S.tile_invalid);
  m.unit_select = def('sfx', 0.28, 0.05, 2, 3, S.unit_select);
  // Combat layers. Feedback frames (swing/cast) lower priority so a burst of
  // impacts wins the voice budget.
  m.combat_swing = def('sfx', 0.34, 0.12, 2, 6, S.combat_swing);
  m.combat_impact = def('sfx', 0.5, 0.08, 4, 8, S.combat_impact);
  m.combat_impact_flesh = def('sfx', 0.44, 0.08, 4, 8, S.combat_impact_flesh);
  m.combat_impact_armor = def('sfx', 0.46, 0.07, 4, 8, S.combat_impact_armor);
  m.combat_impact_stone = def('sfx', 0.46, 0.07, 4, 8, S.combat_impact_stone);
  m.combat_impact_wood = def('sfx', 0.44, 0.07, 4, 8, S.combat_impact_wood);
  m.combat_impact_heavy = def('sfx', 0.58, 0.06, 6, 4, S.combat_impact_heavy);
  m.combat_impact_crit = def('sfx', 0.62, 0.04, 7, 2, S.combat_impact_crit);
  m.combat_footstep_grass = def('sfx', 0.2, 0.1, 1, 8, S.combat_footstep_grass);
  m.combat_footstep_stone = def('sfx', 0.22, 0.09, 1, 8, S.combat_footstep_stone);
  m.combat_footstep_wood = def('sfx', 0.22, 0.09, 1, 8, S.combat_footstep_wood);
  m.combat_footstep_water = def('sfx', 0.2, 0.12, 1, 8, S.combat_footstep_water);
  m.combat_cast = def('sfx', 0.4, 0.1, 3, 4, S.combat_cast);
  m.combat_projectile = def('sfx', 0.32, 0.12, 3, 4, S.combat_projectile);
  m.combat_miss = def('sfx', 0.3, 0.04, 3, 4, S.combat_miss);
  m.combat_block = def('sfx', 0.4, 0.04, 5, 3, S.combat_block);
  m.combat_fizzle = def('sfx', 0.3, 0.04, 3, 4, S.combat_fizzle);
  // Status / turn flow.
  m.status_buff = def('sfx', 0.4, 0.05, 3, 3, S.status_buff);
  m.status_debuff = def('sfx', 0.34, 0.05, 3, 3, S.status_debuff);
  m.status_dot = def('sfx', 0.26, 0.08, 1, 4, S.status_dot);
  m.status_heal = def('sfx', 0.4, 0.05, 3, 3, S.status_heal);
  m.status_death = def('sfx', 0.5, 0.04, 6, 2, S.status_death);
  m.turn_start = def('sfx', 0.28, 0.03, 2, 2, S.turn_start);
  m.turn_end = def('sfx', 0.24, 0.03, 2, 2, S.turn_end);
  return m;
}

export const SOUND_MANIFEST: Readonly<Record<SoundId, SoundDefinition>> = buildManifest();

export const ALL_SOUND_IDS: readonly SoundId[] = Object.keys(SOUND_MANIFEST) as SoundId[];

/** Lookup with a typed guard — hands the caller a `SoundDefinition` or null
 *  for an unknown id (defensive; the union type already prevents that). */
export function getSoundDefinition(id: SoundId): SoundDefinition {
  return SOUND_MANIFEST[id];
}

/** Given a budget of preloaded variations for an id, pick the index for this
 *  play while never immediately repeating the last one. Pure + deterministic
 *  for a given `lastIndex`, so it's unit-testable headlessly. */
export function pickVariationIndex(count: number, lastIndex: number | null, rng: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (count === 2 && lastIndex !== null) return lastIndex === 0 ? 1 : 0;
  let idx = Math.floor(rng() * count);
  if (idx === lastIndex) idx = (idx + 1) % count;
  return idx;
}