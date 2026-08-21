import { q, closeDbAdapter } from './src/db/index.ts';

async function main() {
  const dungeons = await q('SELECT id, dungeon_group_id, grid_x, grid_y FROM dungeons WHERE dungeon_group_id IS NOT NULL AND grid_x IS NOT NULL AND grid_y IS NOT NULL');
  console.log('DB Dungeons:', JSON.stringify(dungeons, null, 2));
  await closeDbAdapter();
}

main().catch(e => { console.error(e); process.exit(1); });