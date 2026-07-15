/**
 * The procedural Digiworld TILE MAP (TASK-40, R-9) — the PURE, deterministic map data
 * an authenticated player explores tile-by-tile to trigger wild-Digimon encounters.
 *
 * WHY a pure module (no Prisma, no I/O, NO RNG): the map is server-authoritative data
 * resolved deterministically — the same tile always references the same enemy — so it
 * is exactly unit-testable and the e2e can assert a specific encounter/win/loss without
 * seeding randomness. This mirrors the pure combat core (battle.ts) + evolution.ts +
 * training.ts: all the numbers/data live here so {@link ExploreService} stays a thin
 * transaction wrapper that just resolves ownership, calls the EXISTING simulateBattle,
 * and persists the WIN reward.
 *
 * SCOPE (A-33): the SMALLEST runnable slice of R-9 — a FIXED SHARED map (every player
 * sees the same tiles this slice) whose encounter tiles reference the EXISTING
 * {@link ENEMY_ROSTER} (imported below — ONE source of truth for enemies, no new combat
 * math). Carved to later R-9 child slices: the canvas/SVG hex renderer + pan/zoom,
 * fog-of-war, multi-hex party MOVEMENT (adjacency/pathing/persisted position), a
 * per-player PROCEDURAL world SEED (this fixed map becomes one seeded instance),
 * non-combat tile events, and a resource/item DROP loot reward (an ECONOMIC reward that
 * WOULD trigger invariant 3 + reuse the L-13 CREDIT template).
 */

import { ENEMY_ROSTER } from '../digimon/battle';

/**
 * One tile of the world map. `terrain` is a plain `String` (a categorical label, L-6 —
 * SQLite/the domain has no enums; the vocabulary is documented on the tiles below).
 * `encounterEnemyId` is EITHER a stable {@link ENEMY_ROSTER} id (a WILD encounter tile)
 * or `null` (an empty/safe tile). It stays SERVER-SIDE — the leak-safe {@link TileView}
 * (explore.types.ts) drops it so the map read never reveals which foe waits where
 * (invariant 2: an encounter is a surprise until you explore the tile).
 */
export interface WorldTile {
  /** Stable tile identity the explore route keys on (the `:tileId` path param). */
  id: string;
  /** Categorical terrain label (plain String, L-6), e.g. "Forest" | "Cave". */
  terrain: string;
  /** A wild-encounter enemy id (from ENEMY_ROSTER), or `null` for an empty tile. */
  encounterEnemyId: string | null;
}

// The two enemy ids the encounter tiles reference — pulled from the SHARED
// ENEMY_ROSTER (not hard-coded strings) so a rename there is a compile error here,
// keeping the ONE-source-of-truth guarantee. `numemon` is the weak foe a level-1
// starter beats (an observable WIN → XP), `kuwagamon` the tough one it loses to (an
// observable LOSS → no write) — see the ENEMY_ROSTER doc in battle.ts.
const [NUMEMON, KUWAGAMON] = ENEMY_ROSTER.map((enemy) => enemy.id);

/**
 * The fixed shared world map (TASK-40) — 10 tiles laid out as a small varied region.
 * A MIX of empty tiles (safe travel) and encounter tiles (wild Digimon) so BOTH the
 * "explore an empty tile" and "explore → fight → win/lose" paths are observable in the
 * running slice AND deterministically e2e-assertable:
 *
 *  - Several `numemon` encounter tiles — a starter WINS (the "explore → encounter →
 *    win → get stronger" success payoff).
 *  - One `kuwagamon` encounter tile — a starter LOSES (the risk side; no reward).
 *  - Empty tiles interleaved (safe terrain the player crosses with no fight).
 *
 * Frozen `readonly` so nothing mutates the shared map at runtime (it is pure data). The
 * terrain labels are flavour only this slice (no movement/adjacency yet — carved).
 */
export const WORLD_TILES: readonly WorldTile[] = [
  { id: 'greenfield-entry', terrain: 'Plains', encounterEnemyId: null },
  { id: 'whispering-woods', terrain: 'Forest', encounterEnemyId: NUMEMON },
  { id: 'quiet-clearing', terrain: 'Plains', encounterEnemyId: null },
  { id: 'mushroom-hollow', terrain: 'Forest', encounterEnemyId: NUMEMON },
  { id: 'still-pond', terrain: 'Water', encounterEnemyId: null },
  { id: 'riverbank-trail', terrain: 'Water', encounterEnemyId: NUMEMON },
  { id: 'sunlit-ridge', terrain: 'Mountain', encounterEnemyId: null },
  { id: 'dark-cavern', terrain: 'Cave', encounterEnemyId: KUWAGAMON },
  { id: 'crossroads-rest', terrain: 'Plains', encounterEnemyId: null },
  { id: 'thornwood-edge', terrain: 'Forest', encounterEnemyId: NUMEMON },
] as const;

/**
 * Resolve a tile by its stable `id`, or `undefined` for an unknown id (the service
 * turns that into a clean 404 BEFORE any read/write — no partial exploration). Mirrors
 * {@link findEnemy}'s lookup shape in battle.ts.
 */
export function findTile(id: string): WorldTile | undefined {
  return WORLD_TILES.find((tile) => tile.id === id);
}
