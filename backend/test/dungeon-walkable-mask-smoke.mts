/**
 * Walkable-mask regression: a border cell painted with a `tree` (decoration)
 * overlay on top of `floor` must remain in the walkable mask, so the player
 * can reach the seam doorway and cross into the neighbor map.
 *
 * Prior bug: computeWalkableMaskFromTiles deleted ANY cell carrying a
 * non-walkable layer kind, so the Forest maps' `tree` border overlay wiped
 * every border row/column from the mask. `isWalkable` prefers the mask, so the
 * border cell read as non-walkable and the off-map press was rejected as
 * "not-walkable" before getAutomaticGridTransition ran — the player got stuck
 * at the edge.
 *
 * Run: DATABASE=sqlite DB_PATH=/tmp/dw-walkable-mask.db pnpm test:walkable-mask
 */
import { run } from '../src/db/index.ts';
import {
  computeWalkableMaskFromTiles,
  createDungeon,
  startOrGetRun,
  moveRun,
  getDungeonView,
} from '../src/dungeons/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-walkable-mask.db';
const USER = 'usr_walkable_mask';

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

function tile(x: number, y: number, kind: string, gid = 1): { x: number; y: number; gid: number; layerKind: 'floor' | 'tree' | 'wall' } {
  return { x, y, gid, layerKind: kind as 'floor' | 'tree' | 'wall' };
}

async function main(): Promise<void> {
  await seedUser(USER);

  // Pure unit check: floor + tree overlay must be walkable; floor + wall must not.
  const mask = computeWalkableMaskFromTiles([
    tile(0, 0, 'floor'),
    tile(0, 0, 'tree'),        // decoration overlay — must NOT block
    tile(1, 0, 'floor'),
    tile(1, 0, 'wall'),        // hard blocker — must block
    tile(2, 0, 'tree'),         // tree alone — not walkable (no floor)
  ]);
  const set = new Set(mask.map(([x, y]) => `${x},${y}`));
  assert(set.has('0,0'), 'floor+tree cell is walkable (decoration does not poison the mask)');
  assert(!set.has('1,0'), 'floor+wall cell is blocked (hard obstacle wins)');
  assert(!set.has('2,0'), 'tree-alone cell is not walkable (no walkable layer)');

  // Integration: a 3x3 group map whose entire border is floor+trees, with a
  // neighbor to the south, must let the player walk to the bottom border and
  // cross off-map into the neighbor.
  const group = 'grp-mask-' + Date.now();
  const source = await createDungeon({
    worldObjectId: null, questId: null, parentId: null, name: 'Mask Source', description: '',
    biome: 'forest', width: 3, height: 3, spawnX: 1, spawnY: 0,
    biomeRegion: null, randomEncountersEnabled: false, randomEncounterRate: 1, randomMinLevel: 1,
    randomMaxLevel: 5, randomMaxStage: 'Rookie', randomMinPartySize: 1, randomMaxPartySize: 1,
    randomAllowedElements: null, randomPool: [], unlockRequiresItems: null,
    challenge: { kind: 'none' }, walkableMask: null, dungeonGroupId: group, floorIndex: null,
    gridX: 0, gridY: 0,
  });
  const neighbor = await createDungeon({
    worldObjectId: null, questId: null, parentId: null, name: 'Mask Neighbor', description: '',
    biome: 'forest', width: 3, height: 3, spawnX: 1, spawnY: 0,
    biomeRegion: null, randomEncountersEnabled: false, randomEncounterRate: 1, randomMinLevel: 1,
    randomMaxLevel: 5, randomMaxStage: 'Rookie', randomMinPartySize: 1, randomMaxPartySize: 1,
    randomAllowedElements: null, randomPool: [], unlockRequiresItems: null,
    challenge: { kind: 'none' }, walkableMask: null, dungeonGroupId: group, floorIndex: null,
    gridX: 0, gridY: 1,
  });

  // Paint the source fully (floor + tree border) and the neighbor fully
  // (floor) so both maps have walkable entry cells.
  const sourceTiles: { x: number; y: number; gid: number; layerKind: 'floor' | 'tree' }[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    sourceTiles.push({ x, y, gid: 1, layerKind: 'floor' });
    if (x === 0 || x === 2 || y === 0 || y === 2) sourceTiles.push({ x, y, gid: 1, layerKind: 'tree' });
  }
  const { replaceTiles } = await import('../src/dungeons/repo.ts');
  await replaceTiles(source.id, sourceTiles as never);
  const neighborTiles: { x: number; y: number; gid: number; layerKind: 'floor' }[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) neighborTiles.push({ x, y, gid: 1, layerKind: 'floor' });
  await replaceTiles(neighbor.id, neighborTiles as never);

  const view = await getDungeonView(source.id);
  assert(view !== null, 'source view loads');

  await startOrGetRun(USER, source.id);
  // Walk from spawn (1,0) down to the bottom border (1,2), then off-map south.
  const s1 = await moveRun(USER, source.id, 1, 1);
  assert(s1.kind === 'ok', `step to (1,1) ok (got ${s1.kind})`);
  const s2 = await moveRun(USER, source.id, 1, 2);
  assert(s2.kind === 'ok', `step to bottom border (1,2) ok (got ${s2.kind}) — border cell is walkable`);
  const cross = await moveRun(USER, source.id, 1, 3);
  if (cross.kind === 'ok') {
    assert('warpToDungeonId' in cross && cross.warpToDungeonId === neighbor.id,
      'off-map south press crosses into the neighbor map');
  } else {
    assert(false, `off-map south press crossed (got ${cross.kind})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
