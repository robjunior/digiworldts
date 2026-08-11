/**
 * A dungeon zone is an axis-aligned rectangle on the map that overrides
 * the dungeon-wide random encounter behavior within its bounds. See
 * `S8 — Encounter zones from Tiled object layers` in the roadmap.
 *
 * Semantics summary (verified against roadmap S8):
 *   1. Inside zone, `pool` non-empty          → roll from zone.pool
 *   2. Inside zone, `pool` empty, safe=false  → FALLBACK to dungeon-wide pool
 *   3. Inside zone, safe=true                 → NO encounter (dungeon-wide ignored)
 *   4. Outside all zones                      → dungeon-wide pool
 *   5. Overlapping zones                      → smallest area wins
 */

import type { WildPool, WildPoolRollParams } from './encounter-pool.js';

export type DungeonZone = {
  readonly id: string;
  readonly dungeonId: string;
  /** Admin-facing name; also candidate for player-visible "Region: ..." label. */
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Opt-in safe zone. When `true`, `pool` and dungeon-wide are IGNORED —
   * the tile never produces an encounter. Static POIs (bosses, warps,
   * items, doors, chests) still fire; zones only gate the random pipeline.
   */
  readonly safe: boolean;
  /** Empty = fallback to dungeon-wide pool (unless `safe`). */
  readonly pool: WildPool;
  /**
   * Optional partial override of the dungeon-wide roll params. Only the
   * specified fields override. Absent = inherit everything from the
   * dungeon container.
   */
  readonly rollOverrides?: Partial<WildPoolRollParams>;
  readonly createdAt: number;
  readonly updatedAt: number;
};
