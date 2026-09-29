/**
 * PvE "Continue" smoke test — after a PvE battle ends, starting another
 * encounter (what the EndCard Continue button does) must produce a NEW fight
 * (fresh matchId) against DIFFERENT digimons (wild team differs from the
 * previous encounter), re-using the same place/party.
 *
 * Uses CLUSTER=memory so battlefield state lives in-process and the "end then
 * continue" transition is simulated by ending the stored battle snapshot (the
 * same state dispatchAction leaves behind before a Continue fires).
 *
 * Run:  DATABASE=sqlite CLUSTER=memory DB_PATH=/tmp/dw-pve-continue.db \
 *       npx tsx test/pve-continue-smoke.mts
 */
import { existsSync, unlinkSync } from 'node:fs';

import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { run } from '../src/db/index.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { upsertPvePlace, savePvePartyPreferences, startPveEncounter } from '../src/world/pve.ts';
import { getCluster } from '../src/cluster/index.ts';
import type { Battle } from '../src/battle/types.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-pve-continue-smoke.db';
for (const s of ['', '-wal', '-shm']) if (existsSync(DB + s)) unlinkSync(DB + s);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed += 1; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed += 1; process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`); }
}
function assert(cond: boolean, message: string): void { if (!cond) throw new Error(message); }

const SNAP = (id: string): string => `battle:snap:${id}`;
const USER = 'usr_pve_continue';

async function endStoredBattle(cluster: Awaited<ReturnType<typeof getCluster>>, matchId: string): Promise<void> {
  const raw = await cluster.get(SNAP(matchId));
  assert(raw !== null, `battle snapshot ${matchId} missing`);
  const battle = JSON.parse(raw!) as Battle;
  battle.status = 'ended';
  battle.outcome = 'win_a';
  battle.endedAt = Date.now();
  await cluster.set(SNAP(matchId), JSON.stringify(battle));
}

async function wildSet(cluster: Awaited<ReturnType<typeof getCluster>>, matchId: string): Promise<readonly string[]> {
  const raw = await cluster.get(SNAP(matchId));
  assert(raw !== null, `battle snapshot ${matchId} missing`);
  const battle = JSON.parse(raw!) as Battle;
  return battle.units
    .filter((u) => u.wildInfo && u.side !== 'a')
    .map((u) => u.wildInfo!.catalogId);
}

async function main(): Promise<void> {
  const now = Date.now();
  await getDb();
  await run(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`, [USER, 'pve_continue', 'PvE Continue', 'x', now, now]);
  await run(`INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, 'Meat', 100000, ?)`, [USER, now]);

  const catalog = loadCatalog().digimons;
  // 5 wild species so a re-roll can (near-certainly) differ from the previous fight.
  const wild = catalog.slice(0, 5);
  assert(wild.length === 5, 'catalog must have at least 5 digimons for the pool');

  const rosterIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = `mon_c_${i}`;
    rosterIds.push(id);
    await run(`INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, slot_index, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 30, 0, ?, 'party', ?, ?)`, [id, USER, catalog[i].id, `Mon ${i}`, i, now, now]);
  }
  await savePvePartyPreferences(USER, 'explore', rosterIds);

  const pool = wild.map((d) => ({ catalogId: d.id, weight: 1 }));
  await upsertPvePlace({
    id: 'wild-forest', name: 'Wild Forest', description: 'Test', x: 1, y: 1,
    explorePool: pool, expeditionPool: pool,
    minWildLevel: 1, maxWildLevel: 40, minWildStage: 'Fresh', maxWildStage: 'Mega',
    wildCountMin: 2, wildCountMax: 2, levelVarianceMin: 0.9, levelVarianceMax: 1.1,
  });

  const cluster = await getCluster();

  await test('Continue starts a NEW fight (fresh matchId) against DIFFERENT digimons', async () => {
    const first = await startPveEncounter(USER, 'wild-forest', 'explore', 1);
    assert(first.ok, `first encounter failed: ${JSON.stringify(first)}`);
    const matchId1 = (first as { ok: true; matchId: string }).matchId;
    const firstWild = await wildSet(cluster, matchId1);
    assert(firstWild.length === 2, `expected 2 wild mons, got ${firstWild.length}`);

    // End the battle (Continue fires only after the previous fight ended).
    await endStoredBattle(cluster, matchId1);

    // Continue 6 times. Each returns a NEW match and — because the frontend
    // passes the just-fought species as `exclude` — the wild team must be
    // deterministically DISJOINT from the previous fight (not merely random).
    let sawNewMatch = false;
    let prevMatch = matchId1;
    let prevWild = firstWild;
    for (let i = 0; i < 6; i++) {
      const next = await startPveEncounter(USER, 'wild-forest', 'explore', 1, prevWild);
      assert(next.ok, `continue #${i} failed: ${JSON.stringify(next)}`);
      const matchId = (next as { ok: true; matchId: string }).matchId;
      if (matchId !== prevMatch) sawNewMatch = true;
      const wset = await wildSet(cluster, matchId);
      const overlap = prevWild.filter((c) => wset.includes(c));
      assert(overlap.length === 0, `continue #${i} re-rolled previous species ${JSON.stringify(overlap)}; prev=${JSON.stringify(prevWild)} next=${JSON.stringify(wset)}`);
      prevMatch = matchId;
      prevWild = wset;
      await endStoredBattle(cluster, matchId);
    }
    assert(sawNewMatch, 'continue did not produce a NEW matchId (same fight)');
  });

  await closeDbAdapter();
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}
void main();