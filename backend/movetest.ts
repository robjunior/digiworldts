import { run, one } from './src/db/index.ts';
import { hashPassword } from './src/auth/password.ts';
import { getDungeon, startOrGetRun, moveRun } from './src/dungeons/repo.ts';

const userId = 'usr_test_rand';
const dungeonId = 'dun_plant_1';

async function main(): Promise<void> {
  const existing = await one<{ id: string }>(`SELECT id FROM users WHERE id = ?`, userId);
  if (!existing) {
    const hash = await hashPassword('Test1234!');
    await run(
      `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at, tutorial_seen) VALUES (?, ?, ?, ?, 0, ?, ?, '[]')`,
      userId, 'testrand', 'Test Rand', hash, Date.now(), Date.now(),
    );
  }
  await startOrGetRun(userId, dungeonId);
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) throw new Error('no dungeon');
  console.log('dungeon.randomEncountersEnabled =', dungeon.randomEncountersEnabled, 'rate =', dungeon.randomEncounterRate);

  const sx = dungeon.spawnX, sy = dungeon.spawnY;
  const dirs: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let target: { x: number; y: number } | null = null;
  let current = { x: sx, y: sy };
  for (const [dx, dy] of dirs) {
    const r = await moveRun(userId, dungeonId, sx + dx, sy + dy);
    if (r.kind === 'ok') {
      target = { x: r.run.currentX, y: r.run.currentY };
      current = target;
      break;
    }
  }
  if (!target) { console.log('no walkable adjacent tile from spawn'); return; }
  console.log('walkable target =', target);

  let hits = 0;
  const N = 2000;
  for (let i = 0; i < N; i += 1) {
    const dest = current.x === sx && current.y === sy ? target : { x: sx, y: sy };
    const r = await moveRun(userId, dungeonId, dest.x, dest.y);
    if (r.kind === 'ok') {
      current = { x: r.run.currentX, y: r.run.currentY };
      if (r.randomEncounter) hits += 1;
    }
  }
  console.log(`moveRun randomEncounter non-null: ${hits}/${N} (${((hits / N) * 100).toFixed(1)}%)`);
  await run(`DELETE FROM user_dungeon_runs WHERE user_id = ?`, userId);
  await run(`DELETE FROM users WHERE id = ?`, userId);
  console.log('cleaned up test user + run');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
