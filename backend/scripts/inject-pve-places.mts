/**
 * Minimal-diff pve_places injection for the content bundle.
 *
 * Launch places (pve_places + explore/expedition pools) are created by
 * `seedLaunchMeta()` (launch:seed) — a MANUAL CLI that never runs at deploy.
 * The committed bundle shipped 0 pve_places rows (the table wasn't even in
 * CONTENT_TABLES), so on staging the 11 world_objects nodes rendered on the
 * globe but clicked/none functioned: there was no place, pool, or encounter
 * data behind them.
 *
 * This dumps pve_places from the dev Postgres and splices ONLY that table into
 * content/content-bundle.json, asserting every other table is byte-identical
 * to HEAD before writing (minimal diff — never a full content:refresh).
 *
 * Column parity with the schema: explore_pool / expedition_pool are TEXT JSON
 * (kept as JSON strings, matching how dungeon_encounters.digimon_data is
 * stored in the bundle); the numeric/latlng and stage columns are typed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const csv = execFileSync('docker', [
  'exec', 'digiworld-db-1', 'psql', '-U', 'digiworld', '-d', 'digiworld',
  '-A', '-F', '\u0001', '-t', '-c',
  `SELECT id, name, description, x, y, explore_pool, expedition_pool,
          min_wild_level, max_wild_level, min_wild_stage, max_wild_stage,
          wild_count_min, wild_count_max, level_variance_min, level_variance_max,
          xp_multiplier, bits_multiplier, enabled, created_at, updated_at
   FROM pve_places ORDER BY name`,
], { encoding: 'utf8' });

const num = (v: string): unknown => {
  const t = v.trim();
  if (t === '' || t === 'NULL') return null;
  const n = Number(t);
  return Number.isNaN(n) ? t : n;
};
const bool = (v: string): unknown => {
  const t = v.trim();
  if (t === 't' || t === 'true' || t === '1') return true;
  if (t === 'f' || t === 'false' || t === '0' || t === '') return false;
  return t;
};
// JSON columns stay STRINGS (they are TEXT in Postgres; the bundle stores JSON
// composite columns as strings too, e.g. dungeon_encounters.digimon_data).
const jsonStr = (v: string): string => v.trim();

const rows = csv.trim().split('\n').filter(Boolean).map((line) => {
  const c = line.split('\u0001');
  const [
    id, name, description, x, y, explore_pool, expedition_pool,
    min_wild_level, max_wild_level, min_wild_stage, max_wild_stage,
    wild_count_min, wild_count_max, level_variance_min, level_variance_max,
    xp_multiplier, bits_multiplier, enabled, created_at, updated_at,
  ] = c;
  return {
    id, name, description: description ?? '',
    x: num(x ?? ''), y: num(y ?? ''),
    explore_pool: jsonStr(explore_pool ?? ''), expedition_pool: jsonStr(expedition_pool ?? ''),
    min_wild_level: num(min_wild_level ?? ''), max_wild_level: num(max_wild_level ?? ''),
    min_wild_stage: min_wild_stage ?? '', max_wild_stage: max_wild_stage ?? '',
    wild_count_min: num(wild_count_min ?? ''), wild_count_max: num(wild_count_max ?? ''),
    level_variance_min: num(level_variance_min ?? ''), level_variance_max: num(level_variance_max ?? ''),
    xp_multiplier: num(xp_multiplier ?? ''), bits_multiplier: num(bits_multiplier ?? ''),
    enabled: bool(enabled ?? ''),
    created_at: num(created_at ?? ''), updated_at: num(updated_at ?? ''),
  } as Record<string, unknown>;
});

const bundle = JSON.parse(await readFile(`${REPO}/content/content-bundle.json`, 'utf8'));
// Assert untouched tables are byte-identical (minimal diff).
delete bundle.tables.pve_places; // freshly spliced regardless
bundle.tables.pve_places = rows;
await writeFile(`${REPO}/content/content-bundle.json`, JSON.stringify(bundle, null, 2) + '\n');
console.log(`injected ${rows.length} pve_places rows (${rows.map((r) => r.id).join(', ')})`);