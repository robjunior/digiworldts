/**
 * Booster pipeline — from seed files to deployable bundle rows.
 *
 * Connects the "Loader de seeds" (§3) to the repo's existing content-deploy
 * machinery. `buildBoosterTables` scans `seeds/boosters/*.booster.json`,
 * validates them (schema + semantic + cross-file against the global catalogs),
 * transforms each valid seed into runtime rows (booster + nodes + items) and
 * returns them in the exact shape the content bundle expects. This is called
 * by:
 *   - `extract-local.ts` (content:refresh) so boosters land in the committed
 *     bundle; and
 *   - the deploy pipeline to re-validate + persist on apply.
 *
 * Rule of thumb from §9: the loader NEVER infers evolution from the global
 * graph. The global catalog is used ONLY to cross-file validate that the
 * digimonId/itemId the editor chose actually exist. Parent->child comes
 * solely from the seed file's parentRef.
 *
 * Idempotency: rows are keyed by deterministic `id` (code:ref), so re-running
 * the bundle/apply converges instead of duplicating.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalog, type Catalog } from '../digimon/xml.js';
import { loadBoosters, seedHashOf, transformSeed, type BoosterIssue } from './loader.js';
import type { BoosterRuntime, BoosterDigimonNode, BoosterItemRow } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo `seeds/boosters` dir (repo root is 3 up from src/boosters). */
export const DEFAULT_SEEDS_DIR = resolve(HERE, '..', '..', '..', 'seeds', 'boosters');
/** Where shop item ids are read from — the bundle's shop_items table ids. */
export const ITEM_ID_SOURCE = 'shop_items';

export type BoosterCatalogRefs = {
  digimonIds: ReadonlySet<string>;
  itemIds: ReadonlySet<string>;
  codes: ReadonlyArray<string>;
};

function toSet<T>(iterable: Iterable<T>): ReadonlySet<T> {
  return new Set(iterable);
}

/** Build catalog id sets from a loaded catalog + a shop_items id list. */
export function buildCatalogRefs(catalog: Catalog | undefined, itemIds: Iterable<string>): BoosterCatalogRefs {
  return {
    digimonIds: toSet((catalog?.digimons ?? []).map((d) => d.id)),
    itemIds: toSet(itemIds),
    codes: [],
  };
}

/**
 * Scan + validate + transform a boosters dir into deployable rows.
 *
 * @returns rows + issues. `valid` is false if ANY issue (schema/semantic/
 *          cross-file) was found; invalid seeds are excluded from rows but
 *          cross-file issues still report them (a broken catalog ref must not
 *          silently vanish). `failOnInvalid` throws so a build gate can fail.
 */
export async function buildBoosterTables(
  opts: {
    seedsDir?: string;
    catalog?: Catalog;
    itemIds?: Iterable<string>;
    codes?: ReadonlyArray<string>;
    failOnInvalid?: boolean;
  } = {},
): Promise<{
  boosters: BoosterRuntime[];
  booster_digimon_nodes: BoosterDigimonNode[];
  booster_item_entries: BoosterItemRow[];
  issues: BoosterIssue[];
  valid: boolean;
}> {
  const seedsDir = opts.seedsDir ?? DEFAULT_SEEDS_DIR;
  const refs = buildCatalogRefs(opts.catalog, opts.itemIds ?? []);

  const loaderOpts = opts.failOnInvalid ? { failOnInvalid: true } : {};
  const { seeds, issues, valid } = await loadBoosters(
    seedsDir,
    {
      digimonIds: refs.digimonIds,
      itemIds: refs.itemIds,
      codes: opts.codes ?? [],
    },
    loaderOpts,
  );

  const boosters: BoosterRuntime[] = [];
  const boostersLog: string[] = [];
  const nodes: BoosterDigimonNode[] = [];
  const items: BoosterItemRow[] = [];

  for (const seed of seeds) {
    const hash = seed.$fileName ? await seedHashOf(resolve(seedsDir, seed.$fileName)) : '';
    const { booster, nodes: n, items: it } = transformSeed(seed, hash);
    boosters.push(booster);
    boostersLog.push(booster.code);
    nodes.push(...n);
    items.push(...it);
  }

  return { boosters, booster_digimon_nodes: nodes, booster_item_entries: items, issues, valid };
}

export type { BoosterIssue };