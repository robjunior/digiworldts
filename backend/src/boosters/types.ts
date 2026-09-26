/**
 * Booster data model — "Booster como Curadoria Manual".
 *
 * Two independent domains (see docs/booster-spec):
 *  - Global evolution graph  = the game rule, derived from the catalog XML.
 *  - Booster / collection    = editorial curation, versioned in SEED FILES.
 *
 * The booster NEVER infers parent->child from the global graph. The linkage is
 * a property of the seed file only: `parentRef` (local to the file). `ref` is a
 * file-local slug used for `parentRef`; `digimonId`/`itemId` reference the
 * global catalog. The database is a runtime CACHE populated at build/deploy:
 * git is the source of truth, the file never writes to the DB.
 */
import type { ContentStatus } from '@digiworld/shared/digimon';

export const BOOSTER_RARITIES = ['common', 'uncommon', 'rare', 'ultra-rare'] as const;
export type BoosterRarity = (typeof BOOSTER_RARITIES)[number];

export type BoosterStatus = ContentStatus | 'review'; // draft | review | published | archived

/** A single node in the booster's Digimon pool (seed-file shape, camelCase). */
export type BoosterDigimonEntry = {
  /** Slug local to this file, used by `parentRef`. */
  ref: string;
  /** Global catalog id (e.g. "skb-50"). */
  digimonId: string;
  /** `ref` of the parent in THIS file, or null for a root. */
  parentRef: string | null;
  rarity: BoosterRarity;
  weight: number; // integer > 0
  order: number; // integer >= 0
};

export type BoosterItemEntry = {
  ref: string;
  itemId: string;
  rarity: BoosterRarity;
  weight: number;
  order: number;
};

export type BoosterSeedMeta = {
  code: string; // unique across ALL seed files
  name: string;
  set: string;
  releaseDate: string; // YYYY-MM-DD
  description?: string;
  status: BoosterStatus;
  tags?: string[];
};

export type BoosterSeed = BoosterSeedMeta & {
  digimonPool: BoosterDigimonEntry[];
  itemPool: BoosterItemEntry[];
  /** Package-metadata that has no runtime identity (filled by the loader). */
  $fileName?: string;
};

// ---------------------------------------------------------------------------
// Runtime row shapes — these are the DB/seed-bundle columns (snake_case).
// ---------------------------------------------------------------------------

/** One `boosters` row. */
export type BoosterRuntime = {
  id: string; // code lowercased, e.g. "bt-05" (PK)
  code: string;
  name: string;
  set: string;
  release_date: string;
  description?: string;
  status: BoosterStatus;
  /** JSON-encoded array of tags. */
  tags?: string;
  seed_hash: string; // SHA-256 of the source seed file
  loaded_at: number;
};

/** One `booster_digimon_nodes` row. */
export type BoosterDigimonNode = {
  id: string; // `${code}:${ref}` (PK)
  booster_id: string;
  ref: string;
  digimon_id: string;
  parent_node_id: string | null;
  rarity: BoosterRarity;
  weight: number;
  order: number;
};

/** One `booster_item_entries` row. */
export type BoosterItemRow = {
  id: string; // `${code}:item:${ref}` (PK)
  booster_id: string;
  ref: string;
  item_id: string;
  rarity: BoosterRarity;
  weight: number;
  order: number;
};

export type BoosterRuntimeTables = {
  boosters: BoosterRuntime[];
  booster_digimon_nodes: BoosterDigimonNode[];
  booster_item_entries: BoosterItemRow[];
};