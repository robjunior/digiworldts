import type { TurnLogEntry } from '../digimon/battle';
import type { OwnedDigimon } from '../digimon/digimon.types';
import type { WorldTile } from './explore.map';

/**
 * Public shapes of the `/api/explore/*` responses (TASK-40, R-9) — the FIRST
 * exploration API contract. Like the other feature `*.types.ts`, these are explicit
 * exported interfaces the controller returns and a later `/explore` SPA screen
 * (TASK-41) keeps a LOCAL mirror of (never a cross-workspace import — the D-8 house
 * rule). Additive under invariant 5: fields may be ADDED in later R-9 slices (fog,
 * movement, loot), never break a released one.
 *
 * `TurnLogEntry` (from the pure combat core, battle.ts) and `OwnedDigimon` (the digimon
 * module's roster shape) are REUSED (imported), not restated: an exploration encounter
 * is resolved by the SAME `simulateBattle` and grants XP through the SAME curve, so its
 * turn log + rewarded Digimon are byte-identical to the PvE/PvP ones — one type each, no
 * divergence (D-8 #1). The SPA mirror still restates them locally per the cross-workspace
 * rule.
 */

/**
 * One tile on `GET /api/explore/map` — the LEAK-SAFE public projection of a
 * {@link WorldTile}. Deliberately drops `encounterEnemyId` (invariant 2): the map read
 * tells the player only WHETHER a tile has an encounter (`hasEncounter`), never WHICH
 * enemy waits there — the specific foe is a surprise revealed only when the tile is
 * explored. Mirrors `shop.types.ts`'s `toItemView` idiom (dropping server-only fields).
 */
export interface TileView {
  /** Stable tile id — the `:tileId` an explore POSTs. */
  id: string;
  /** Categorical terrain label (plain String, L-6). */
  terrain: string;
  /** Whether exploring this tile triggers a wild encounter (the enemy id stays hidden). */
  hasEncounter: boolean;
}

/**
 * `POST /api/explore/:tileId/explore` success body (HTTP 200) — the result of exploring
 * ONE tile.
 *
 *  - An EMPTY tile → `outcome:'empty'`, empty `turns`, `xpGained:0`, no `enemy`/`digimon`
 *    (nothing was fought, nothing written).
 *  - An ENCOUNTER tile → the deterministic `simulateBattle` resolves it: `outcome` is
 *    `'win'|'loss'`, `turns` is the ordered log (same shape a PvE/PvP fight returns, so a
 *    UI replays it identically), `enemy` names the wild foe fought, and `digimon` is the
 *    explorer's Digimon AFTER the fight — on a WIN its persisted XP/level/stats (may have
 *    ticked up), on a LOSS unchanged (no penalty this slice). `reward.xpGained` is the
 *    win XP (BATTLE_XP_REWARD) or `0`.
 */
export interface ExploreOutcomeView {
  /** `'win'|'loss'` for an encounter tile; `'empty'` for a tile with no encounter. */
  outcome: 'win' | 'loss' | 'empty';
  /** The ordered turn-by-turn log — non-empty for an encounter, empty for an empty tile. */
  turns: TurnLogEntry[];
  /** The reward granted — `xpGained` is the win XP, or `0` on a loss/empty tile. */
  reward: { xpGained: number };
  /** The wild enemy fought — present only on an encounter tile (its public fields). */
  enemy?: { name: string; type: string; element: string };
  /**
   * The explorer's Digimon after the encounter — present only on an encounter tile.
   * Same {@link OwnedDigimon} shape `GET /digimon` returns so the client refreshes the
   * roster row directly. Omitted for an empty tile (no Digimon was involved in a write).
   */
  digimon?: OwnedDigimon;
}

/**
 * Project a {@link WorldTile} to its leak-safe {@link TileView}, DROPPING the
 * server-only `encounterEnemyId` (invariant 2). Pure — mirrors `shop.types.ts`'s
 * `toItemView`. `hasEncounter` is the mere presence of an encounter enemy, so the wire
 * reveals that a fight awaits without revealing the specific foe.
 */
export function toTileView(tile: WorldTile): TileView {
  return {
    id: tile.id,
    terrain: tile.terrain,
    hasEncounter: tile.encounterEnemyId !== null,
  };
}
