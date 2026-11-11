/**
 * Scenes store regression: an externally-written scenes.json MUST reach a
 * running backend without a restart.
 *
 * On staging, content-deploy --apply writes scenes/scenes.json into the
 * backend's data dir AFTER the process booted — if the store cached the
 * first read (empty []), the staging lobby forever falls back to
 * DEFAULT_ARENA_MODEL (forest biome). This test proves the store re-stats the
 * file on every read and serves the applied envelope.
 *
 * Run:
 *   DATA_DIR=$(mktemp -d) SESSION_SECRET=$(head -c 40 /dev/urandom | base64) \
 *     pnpm --filter @digiworld/backend exec tsx test/scenes-store-reload.test.mts
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the scenes data dir at a scratch dir BEFORE importing the store.
const scratch = mkdtempSync(join(tmpdir(), 'dw-scenes-reload-'));
const scenesDir = join(scratch, 'scenes');
const fs = await import('node:fs');
fs.mkdirSync(scenesDir, { recursive: true });

const mkEnvelope = (scenes: unknown[]) => JSON.stringify({ version: 2, scenes }, null, 2);

// First write: what a fresh staging volume looks like after boot-seed (empty).
writeFileSync(join(scenesDir, 'scenes.json'), mkEnvelope([]));

process.env.DATA_DIR = scratch;
process.env.SESSION_SECRET = 'x'.repeat(40); // avoid touching backend/data/.session-secret
process.env.DATABASE = 'sqlite';
process.env.DB_PATH = join(scratch, 'test.db');

const store = await import('../src/scenes/store.js');

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

try {
  // 1. Boot state: the empty envelope the backend seeded.
  const boot = await store.listScenes();
  check('boot: empty scenes served', boot.length === 0, `got ${boot.length}`);

  // 2. content-deploy --apply overwrites scenes.json with the real preset
  //    (including the kind:"lobby" entity) — simulated external write.
  writeFileSync(
    join(scenesDir, 'scenes.json'),
    mkEnvelope([
      { id: 'scn_lobby1', name: 'Lobby', kind: 'lobby', elements: [], settings: { modelFile: 'arena.glb', lobby: { partyHeight: 0.85 } }, useGlbSettings: false, weather: null, timeOfDay: null },
      { id: 'scn_arena1', name: 'Forest', elements: ['plant'], settings: { modelFile: 'forest_biome.glb' }, useGlbSettings: false, weather: null, timeOfDay: null },
    ]),
  );

  // 3. The SAME running process must now serve the applied scenes (mtime-aware
  //    reload — no backend restart).
  const applied = await store.listScenes();
  check('applied: lobby scene served after external write',
    applied.some((s) => s.id === 'scn_lobby1' && s.kind === 'lobby'),
    JSON.stringify(applied.map((s) => s.id)));
  check('applied: scene count reflects the write',
    applied.length === 2, `got ${applied.length}`);

  // 4. Store writes (admin PUT) still update the cache + file coherently.
  const created = await store.createSceneEntry({
    name: 'Ice',
    elements: ['ice'],
    settings: {},
  });
  const afterCreate = await store.listScenes();
  check('create: new entry visible without re-read staleness',
    afterCreate.some((s) => s.id === created.id), `got ${afterCreate.length}`);

  console.log(`\n=== SUMMARY: ${failures === 0 ? 'all' : failures} passed ===`);
  process.exit(failures > 0 ? 1 : 0);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}