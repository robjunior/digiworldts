/**
 * Encounter pool primitives shared between the dungeon-wide random pool
 * and per-zone override pools (see `dungeon-zone.ts`).
 *
 * A pool is a curated list of catalog IDs the player can encounter. Level
 * and weight are per-entry overrides; when absent, the container (dungeon
 * or zone) supplies the defaults via `WildPoolRollParams`.
 *
 * Weights are accepted in the schema (`weight?`) but IGNORED at MVP — the
 * roll is uniform. Enabling weight is a 3-line change in `rollFromPool`
 * once we have data on which weights admins actually want.
 */

import type { Element, Stage } from './digimon.js';

export type WildPoolEntry = {
  /** Catalog ID (e.g. `skb-317`). Must exist in the loaded catalog. */
  readonly catalogId: string;
  /** Per-entry override; falls back to container `minLevel` when absent. */
  readonly minLevel?: number | undefined;
  /** Per-entry override; falls back to container `maxLevel` when absent. */
  readonly maxLevel?: number | undefined;
  /**
   * Reserved for future weighted picking. MVP treats every entry as
   * `weight = 1`. Keeping the field lets us ship the schema now and
   * flip the roll implementation later without a migration.
   */
  readonly weight?: number | undefined;
};

export type WildPool = readonly WildPoolEntry[];

/**
 * Roll parameters shared between dungeon-wide and per-zone. When a zone
 * declares `rollOverrides`, only the specified fields override; unspecified
 * fields inherit from the dungeon-wide params.
 */
export type WildPoolRollParams = {
  /** 0..1. Chance the roll returns a wild-mon encounter vs. `kind: 'none'`. */
  readonly encounterRate: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  /** Cap per stage (mirrors current `randomMaxStage`). */
  readonly maxStage: Stage;
  readonly minPartySize: number;
  readonly maxPartySize: number;
  /** Empty = all elements allowed. Filters the pool to matching entries. */
  readonly allowedElements: readonly Element[];
};
