/**
 * Exit-portal smoke test — definitive-mode "leave by walking into a portal".
 *
 * Locks in:
 *   - createDungeon now auto-creates a return-to-city warp (target_dungeon_id NULL,
 *     is_exit=1) on the opposite corner from the spawn.
 *   - moveRun onto that warp resolves as an exit: kind 'ok' + warpToDungeonId null.
 *   - The frontend reads warpToDungeonId === null as "go to /world" (city).
 *
 * Run: DB_PATH=/tmp/dw-exit-portal.db pnpm --filter @digiworld/backend test:exit-portal
 */
import { run } from '../src/db/index.ts';
import { createDungeon, moveRun, getDungeonView, startOrGetRun } from '../src/dungeons/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-exit-portal.db';
const USER = 'usr_exit_portal';

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.error(`  FAIL  ${msg}`); }
}

async function seedUser(id: string): Promise<void> {
  const now = Date.now();
  await run('INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, `${id}-name`, `${id}-display`, 'x', 0, now, now);
}

async function seedTile(dungeonId: string, x: number, y: number): Promise<void> {
  await run("INSERT OR IGNORE INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, 1, 'floor')", dungeonId, x, y);
}

async function main(): Promise<void> {
  await seedUser(USER);

  // 2x2 dungeon: spawn (0,0), auto exit warp lands on (1,1) (opposite corner).
  const spawned = await createDungeon({
    worldObjectId: null, questId: null, parentId: null, name: 'Exit Test', description: '',
    biome: 'forest', width: 2, height: 2, spawnX: 0, spawnY: 0,
    biomeRegion: null, randomEncountersEnabled: false, randomEncounterRate: 1, randomMinLevel: 1,
    randomMaxLevel: 5, randomMaxStage: 'Rookie', randomMinPartySize: 1, randomMaxPartySize: 1,
    randomAllowedElements: null, randomPool: [], unlockRequiresItems: null,
    challenge: { kind: 'none' }, walkableMask: null, dungeonGroupId: null, floorIndex: null,
    gridX: null, gridY: null,
  });

  const view = await getDungeonView(spawned.id);
  if (view === null) throw new Error('getDungeonView returned null');
  const exitWarp = view.warps.find((w) => w.targetDungeonId === null);
  assert(exitWarp !== undefined, 'createDungeon seeded a return-to-city warp (target_dungeon_id NULL)');
  assert(exitWarp?.isExit === true, 'the exit warp is flagged is_exit');
  assert(exitWarp?.x === 1 && exitWarp?.y === 1, `exit warp is on the opposite corner (got ${exitWarp?.x},${exitWarp?.y}, expected 1,1)`);

  // Make every tile walkable so the player can reach the portal.
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) await seedTile(spawned.id, x, y);

  // Start the run (puts player on spawn 0,0) then walk 0,0 -> 1,0 -> 1,1 (the portal).
  await startOrGetRun(USER, spawned.id);
  const step1 = await moveRun(USER, spawned.id, 1, 0);
  assert(step1.kind === 'ok', `first step onto (1,0) resolves ok (got ${step1.kind})`);
  const ex = await moveRun(USER, spawned.id, 1, 1);
  assert(ex.kind === 'ok', `moveRun onto the portal (1,1) resolves ok (got ${ex.kind})`);
  if (ex.kind === 'ok') {
    assert(ex.warpToDungeonId === null, 'moveRun onto the exit portal returns warpToDungeonId === null (=> city)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
