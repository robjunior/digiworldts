import { CHUNK_SIZE, generateChunk } from './world.map';

/**
 * The leak-safe WIRE shapes for the world API (TASK-46, R-17a) — the DIRECT analogue of
 * {@link explore.types.ts}'s `TileView`. A world chunk is PUBLIC terrain (the same for
 * every player this slice), so — unlike the explore map's `TileView`, which had to DROP
 * the server-only `encounterEnemyId` — the tile mapping here is an IDENTITY: a
 * {@link WorldTile} already carries only `{biome, walkable}`, both public, so a chunk
 * leaks nothing owner-scoped (invariant 2 holds trivially).
 *
 * `biome` is a plain `string` on the wire (not the union `Biome`), restated LOCALLY on
 * the client per D-8 (no cross-package type import).
 */

/** One tile as seen on the wire. */
export interface TileView {
  biome: string;
  walkable: boolean;
}

/**
 * A generated chunk on the wire. `size` echoes {@link CHUNK_SIZE} so the client can grid
 * the flat row-major `tiles` array without hard-coding the constant; `tiles.length ===
 * size * size`.
 */
export interface WorldChunkView {
  cx: number;
  cy: number;
  size: number;
  tiles: TileView[];
}

/**
 * Project chunk `(cx, cy)` to its wire view. Pure. The per-tile mapping is an identity
 * copy into a fresh `TileView` (a `WorldTile`'s two fields are both public), so nothing
 * owner-scoped can leak; `size` is fixed to `CHUNK_SIZE`.
 */
export function toChunkView(cx: number, cy: number): WorldChunkView {
  const tiles: TileView[] = generateChunk(cx, cy).map((tile) => ({
    biome: tile.biome,
    walkable: tile.walkable,
  }));
  return { cx, cy, size: CHUNK_SIZE, tiles };
}

/**
 * ============================================================================
 * TASK-48 (R-17b) — leak-safe wire shapes for the spawn + encounter routes.
 * ============================================================================
 */

/** A city on the wire (mirrors the pure {@link CityPoint} — coords + name, all public). */
export interface CityPointView {
  x: number;
  y: number;
  name: string;
}

/**
 * `GET /api/world/state` response. `spawn` is the caller's OWN persisted spawn tile
 * (owner-scoped — a player only ever sees their own). `city` is the nearest city to that
 * spawn = the "Starter City" (public terrain, no leak). `minSpawnDistance` echoes the
 * `MIN_SPAWN_DISTANCE` rule so the client can label/verify the placement without
 * hard-coding the constant.
 */
/** The kinds of on-world landmark on the wire (mirrors the pure {@link LandmarkKind}). */
export type LandmarkKindView = 'city' | 'volcano';

/**
 * A keyed landmark on the wire (mirrors the pure {@link LandmarkPoint} — a `kind` tag +
 * coords + name, all public terrain flavour, no owner-scoped leak). TASK-124 (R-20).
 */
export interface LandmarkView {
  kind: LandmarkKindView;
  x: number;
  y: number;
  name: string;
}

export interface WorldStateView {
  spawn: { x: number; y: number };
  city: CityPointView;
  /**
   * TASK-124 (R-20): the keyed landmark collection near the caller's spawn — the nearest
   * `city` (coordinate-equal to the legacy `city` field above) PLUS a `volcano`. Added as
   * a NEW SIBLING: `city` stays byte-stable so R-18's client keeps working until TASK-125
   * switches the UI to read this list (invariant 5). Public terrain, owner-scoped read.
   */
  landmarks: LandmarkView[];
  minSpawnDistance: number;
}

/**
 * `POST /api/world/encounter` response. `encounter` is `null` (no wild foe this step) or
 * a `{ name, enemyId }` whose `enemyId` the SHIPPED `POST /digimon/:id/battle` accepts —
 * the client hands off directly, no new battle plumbing. `biome` is the biome the roll
 * was drawn against (a plain public string), so the UI can flavour the message.
 */
export interface EncounterView {
  encounter: { name: string; enemyId: string } | null;
  biome: string;
  /**
   * TASK-167 (R-22 slice 28) — the interactive-combat difficulty derived from `biome`
   * (`difficultyForBiome`), carried through the `/world` → `/battle` hand-off so a wild
   * fight in a dangerous biome opens against the smart enemy AI and a safe-biome fight
   * against the flat one. OPTIONAL + present ONLY on a non-empty encounter (no foe → no
   * difficulty), so every existing reader of `EncounterView` stays valid (invariant 5).
   * A plain string union on the wire, restated locally on the client per D-8.
   */
  difficulty?: 'easy' | 'normal' | 'hard';
  /**
   * TASK-168 (R-22 slice 29) — the wild-enemy STRENGTH SCALE derived from `biome`
   * (`enemyScaleForBiome`), carried through the SAME `/world` → `/battle` hand-off so a fight
   * in a dangerous biome opens against a foe with visibly more HP and a harder hit (its stat
   * block is multiplied ONCE at the interactive rebuild seam), and a safe-biome fight against
   * the byte-identical baseline foe (`enemyScale === 1`). OPTIONAL + present ONLY on a non-empty
   * encounter (no foe → no scale); every value is `>= 1` (A-42 — a tougher foe, never weaker),
   * so every existing reader of `EncounterView` stays valid (invariant 5). Restated on the
   * client per D-8.
   */
   enemyScale?: number;
   /**
    * TASK-273 (R-44a — multi-enemy encounter groups) — the ordered ENEMY GROUP (1..2 distinct
    * species) this step rolled, carried through the `/world` → `/battle` hand-off so a wild fight can
    * field a PACK. `enemies[0]` is the FRONT foe, coordinate-equal to the scalar `encounter` above
    * (the identity anchor). OPTIONAL + present ONLY when a group of >1 is fielded (a single-enemy roll
    * OMITS it → the scalar `encounter` alone drives today's 1v1, so every existing reader stays valid
    * — invariant 5). Each `{ name, enemyId }` is a real roster foe the shipped battle route accepts.
    * Restated on the client per D-8.
    */
   enemies?: { name: string; enemyId: string }[];
 }
