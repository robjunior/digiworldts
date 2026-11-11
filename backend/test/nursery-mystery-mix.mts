import test from 'node:test';
import assert from 'node:assert';
import { getDb, closeDbAdapter } from '../src/db/adapter.js';
import { run } from '../src/db/index.js';
import { newId } from '../src/util/ids.js';
import { hashPassword } from '../src/auth/password.js';
import {
  startMixHatch,
  startDirectHatch,
  listPendingHatches,
  listSpeciesData,
  hatchPathTo,
  type SpeciesDataRow,
} from '../src/nursery/data.js';
import { loadCatalog } from '../src/digimon/xml.js';

// Deterministic: seed two valid Rookie species (both with a Baby→In-Training→
// Rookie hatch path), then a mystery MIX (selection) must roll weighted among
// ONLY the selected species, mark the egg mystery (mask target in the view),
// NOT leak rolledCatalogId, and zero ONLY the selected data. Direct 100% hatch
// stays revealed for compat.
//
// Run with: DATABASE=sqlite DB_PATH=/tmp/dw-nursery-mystery.db tsx test/nursery-mystery-mix.mts
test('nursery mystery mix: selection → mystery egg, consumes only selected data', async () => {
  await getDb();

  const userId = await createUser();
  const d = loadCatalog().digimons;

  // Pick two valid Rookies (non-null hatch path).
  const valid = d.filter((x) => x.stage === 'Rookie' && hatchPathTo(x.id, d));
  assert.ok(valid.length >= 2, 'catalog should have >=2 valid Rookies');
  const a = valid[0]!;
  const b = valid[1]!;
  const unrelated = valid.find((x) => x.id !== a.id && x.id !== b.id);
  assert.ok(unrelated !== undefined);

  await seedData(userId, a.id, 100);
  await seedData(userId, b.id, 0);
  await seedData(userId, unrelated.id, 55);

  // 1) Selection mix of a single 100% species → MYSTERY (weighted, target hidden).
  const result = await startMixHatch(userId, [a.id]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.strictEqual(result.hasMystery, true, 'selection mix must be a mystery egg');
  assert.strictEqual(result.rolledCatalogId, undefined, 'mystery must not leak rolled species');
  assert.strictEqual(result.pending.mystery, true);
  assert.strictEqual(result.pending.targetName, 'Mystery Egg');
  assert.strictEqual(result.pending.babyCatalogId, '');
  assert.strictEqual(result.pending.babyName, '');

  // Pending list also masks it.
  const list = await listPendingHatches(userId);
  const row = list.find((p) => p.id === result.pending.id);
  assert.ok(row, 'pending row present');
  assert.strictEqual(row.mystery, true);
  assert.strictEqual(row.targetName, 'Mystery Egg');

  // Only the SELECTED species' data was consumed.
  const after = await byId(userId);
  assert.strictEqual(after.get(a.id)?.percent ?? 0, 0, 'selected species data zeroed');
  assert.strictEqual(after.get(unrelated.id)?.percent ?? 0, 55, 'unrelated species data untouched');

  await closeDbAdapter();
});

// Direct 100% hatch stays non-mystery (revealed) — legacy path unchanged.
test('nursery direct hatch is not mystery', async () => {
  await getDb();

  const userId = await createUser();
  const d = loadCatalog().digimons;
  const rookie = d.find((x) => x.stage === 'Rookie' && hatchPathTo(x.id, d));
  assert.ok(rookie !== undefined);
  await seedData(userId, rookie.id, 100);

  const res = await startDirectHatch(userId, rookie.id);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.strictEqual(res.pending.mystery, false);
  assert.notStrictEqual(res.pending.targetName, 'Mystery Egg');

  await closeDbAdapter();
});

async function createUser(): Promise<string> {
  const id = newId('usr');
  await run(
    `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, 'u_' + id, 'U', await hashPassword('pass'), Date.now(), Date.now()],
  );
  return id;
}

async function seedData(userId: string, catalogId: string, percent: number): Promise<void> {
  await run(
    `INSERT INTO player_species_data (user_id, catalog_id, percent, kills, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, catalog_id) DO UPDATE SET percent = excluded.percent`,
    [userId, catalogId, percent, 10, Date.now()],
  );
}

async function byId(userId: string): Promise<Map<string, SpeciesDataRow>> {
  const rows = await listSpeciesData(userId);
  return new Map(rows.map((r) => [r.catalog_id, r]));
}