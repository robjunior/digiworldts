/**
 * `launch:seed` — apply the launch-meta content gate.
 *
 * Idempotent. Two effects, both safe to re-run:
 *   1. Upserts the 10 launch `pve_places` with their encounter pools. Pool
 *      `weight` is the ONLY implemented rarity knob (encounter rarity); the
 *      nursery data tier already scales by stage (Rookie fills fast, Champion
 *      slower), and `evolutionRarity` default-equip bias is a documented
 *      follow-up (not stored on the template today).
 *   2. Applies the TWO-PART disable gate to the catalog XML: every species NOT
 *      in the launch roster AND every Ultimate/Mega is marked `status="draft"`.
 *      Roster Rookie/Champion species stay published. Draft + out-of-pool
 *      closes both acquisition paths (draft still spawns in a pool otherwise).
 *
 * Champion cap is free (EVOLUTION_LEVELS.Champion = 20); no Ultimate/Mega is
 * published so evolution above Champion self-blocks.
 *
 * Run: `pnpm --filter @digiworld/backend launch:seed`
 * (optionally CATALOG_XML=/path to a scratch copy for a dry run)
 */
import { loadCatalog, saveCatalog, type ContentStatus, type TemplateDigimon } from '../digimon/xml.js';
import { getDb, closeDbAdapter } from '../db/adapter.js';
import { run, tx } from '../db/index.js';
import { deletePvePlace, listPvePlaces, upsertPvePlace } from '../world/pve.js';
import { LAUNCH_PLACES, rosterUniverse } from './roster.js';
import { applyLaunchEvolutionKeys } from './evolution.js';
import type { PvePoolEntry } from '@digiworld/shared/pve';

export async function seedLaunchMeta(): Promise<{
  places: number;
  worldNodes: number;
  worldNodeIds: string[];
  published: number;
  drafted: number;
  rosterSpecies: number;
  unknownNames: string[];
  evolutionAssigned: string[];
  evolutionSkipped: string[];
}> {
  await getDb();
  const catalog = loadCatalog();
  const universe = rosterUniverse();
  const index = new Map<string, TemplateDigimon>();
  for (const t of catalog.digimons) index.set(t.name, t);

  // 1. Resolve every roster name -> real catalog id. Fail loudly on unknowns.
  const unknownNames: string[] = [];
  const rosterIds = new Set<string>();
  for (const name of universe.keys()) {
    const tpl = index.get(name);
    if (!tpl) { unknownNames.push(name); continue; }
    rosterIds.add(tpl.id);
  }
  if (unknownNames.length > 0) {
    await closeDbAdapter();
    throw new Error(`launch:seed — unknown roster species: ${unknownNames.join(', ')}`);
  }

  // 2. Champion-cap disable gate: draft everything not on the roster + all
  //    Ultimate/Mega. Roster Rookie/Champion stay published.
  let published = 0;
  let drafted = 0;
  const next: TemplateDigimon[] = catalog.digimons.map((t) => {
    const keep = rosterIds.has(t.id) && (t.stage === 'Rookie' || t.stage === 'Champion');
    const stored = t.status ?? 'published';
    const status: ContentStatus = keep ? 'published' : 'draft';
    if (status === stored) return t;
    if (status === 'published') published += 1;
    else drafted += 1;
    return { ...t, status };
  });
  // 2b. Assign the Champion evolution chip on the canonical Rookie→Champion edges.
  const evo = applyLaunchEvolutionKeys(next, universe);
  saveCatalog({ ...catalog, digimons: evo.digimons });

  // 3. Upsert the 10 launch places (replace pools wholesale with the roster).
  for (const place of LAUNCH_PLACES) {
    const pool: PvePoolEntry[] = place.explore.map((s) => ({
      catalogId: index.get(s.name)!.id,
      weight: s.weight,
    }));
    await upsertPvePlace({
      id: place.id,
      name: place.name,
      description: place.description,
      x: place.x,
      y: place.y,
      explorePool: pool,
      expeditionPool: pool,
      minWildLevel: place.minLevel,
      maxWildLevel: place.maxLevel,
      minWildStage: place.minStage,
      maxWildStage: place.maxStage,
      wildCountMin: 1,
      wildCountMax: 3,
      levelVarianceMin: 0.9,
      levelVarianceMax: 1.2,
      enabled: true,
    });
  }
  // Remove any place that is not part of the launch set (stale from prior seeds).
  const existing = await listPvePlaces(true);
  for (const p of existing) {
    if (!LAUNCH_PLACES.some((lp) => lp.id === p.id)) await deletePvePlace(p.id);
  }

  // 4. Drop a world node for each launch place so the map/globe renders them.
  await seedLaunchWorldNodes();

  await closeDbAdapter();
  return {
    places: LAUNCH_PLACES.length,
    worldNodes: LAUNCH_PLACES.length,
    published,
    drafted,
    rosterSpecies: rosterIds.size,
    unknownNames,
    evolutionAssigned: evo.assigned,
    evolutionSkipped: evo.skipped,
    worldNodeIds: LAUNCH_PLACES.map((p) => `wob-launch-${p.id}`),
  };
}

/** World-globe mesh kind per launch place (progression of scenery). */
const PLACE_NODE_KIND: Readonly<Record<string, string>> = {
  'campo-iniciantes': 'grove',
  'bosque-novatos': 'grove',
  'varzea-ventos': 'archway',
  'mata-tropical': 'ruin',
  'caverna-gelo': 'crystal',
  'lago-abissal': 'spring',
  'floresta-aco': 'tower',
  'pantano-sombrio': 'obelisk',
  'cume-relampago': 'mountain',
  'pico-fim-de-jogo': 'city',
};

/** Idempotent upsert of a world_objects node per launch place (tied to the place by id). */
export async function seedLaunchWorldNodes(): Promise<void> {
  const now = Date.now();
  await tx(async (t) => {
    for (const place of LAUNCH_PLACES) {
      const id = `wob-launch-${place.id}`;
      await t.run(
        `INSERT INTO world_objects
          (id, x, y, lat, lon, kind, scale, tint, quest_id, passable, label, created_at, updated_at, dungeon_id, elements, min_level, max_level, hidden_until_flag)
         VALUES (?, ?, ?, ?, ?, ?, 1.0, NULL, NULL, 1, ?, ?, ?, NULL, NULL, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
          x = excluded.x, y = excluded.y, lat = excluded.lat, lon = excluded.lon,
          kind = excluded.kind, label = excluded.label, passable = excluded.passable,
          min_level = excluded.min_level, max_level = excluded.max_level, updated_at = excluded.updated_at`,
        [id, place.x, place.y, place.x, place.y, PLACE_NODE_KIND[place.id] ?? 'grove', place.name, now, now, place.minLevel, place.maxLevel],
      );
    }
  });
}

// CLI entry — run with `tsx src/launch/seed.ts`.
if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  seedLaunchMeta()
    .then((r) => {
      console.log('launch:seed ok', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('launch:seed failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}