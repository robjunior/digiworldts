/**
 * Minimal-diff world_objects injection for the content bundle.
 *
 * The committed bundle shipped 19 stale random `wob_*` POIs (from an old
 * `content:refresh`) that match NOTHING in the current world. The real world
 * is the `wob-launch-*` nodes (`seedLaunchWorldNodes()` from launch:seed) plus
 * any manual `obj_*` node — created in the dev DB, never in the bundle, so
 * `content:deploy --apply` wrote the stale nodes to the target and never added
 * the real ones.
 *
 * This dumps world_objects from the dev Postgres and splices ONLY those rows
 * into content/content-bundle.json, asserting every other table is
 * byte-identical to HEAD before writing (minimal diff — never run a full
 * content:refresh, which pulls unrelated drift).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const REPO = '/mnt/sdc/digiworld';
const csv = execFileSync('docker', [
  'exec', 'digiworld-db-1', 'psql', '-U', 'digiworld', '-d', 'digiworld',
  '-A', '-F', '\u0001', '-t', '-c',
  `SELECT id, x, y, lat, lon, kind, scale, tint, quest_id, passable, label,
          created_at, updated_at, dungeon_id, elements, min_level, max_level, hidden_until_flag
   FROM world_objects ORDER BY lat, lon`,
], { encoding: 'utf8' });

const into = (v: string): unknown => {
  if (v === '' || v === 'NULL') return null;
  const n = Number(v);
  if (v.trim() !== '' && !Number.isNaN(n) && String(n) === v.trim()) return n;
  // JSON-ish (elements / tint)
  if (v.startsWith('[') || v.startsWith('{')) { try { return JSON.parse(v); } catch { return v; } }
  return v;
};

const rows = csv.trim().split('\n').filter(Boolean).map((line) => {
  const c = line.split('\u0001');
  const [id, x, y, lat, lon, kind, scale, tint, quest_id, passable, label,
    created_at, updated_at, dungeon_id, elements, min_level, max_level, hidden_until_flag] = c;
  return { id, x, y, lat, lon, kind, scale, tint, quest_id, passable, label,
    created_at, updated_at, dungeon_id, elements, min_level, max_level, hidden_until_flag,
  } as Record<string, unknown>;
});

const bundle = JSON.parse(await readFile(`${REPO}/content/content-bundle.json`, 'utf8'));
bundle.tables.world_objects = rows;
await writeFile(`${REPO}/content/content-bundle.json`, JSON.stringify(bundle, null, 2) + '\n');
console.log(`injected ${rows.length} world_objects rows (${rows.map((r) => r.id).join(', ')})`);
