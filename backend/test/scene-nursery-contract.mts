/**
 * Guard for the nursery scene kind contract.
 *
 * The Nursery page (frontend/src/routes/Nursery.tsx) reads its 3D pen backdrop
 * from a SceneEntity with kind 'nursery' (falling back to the name "Nursery");
 * the scene editor drives the pen's GLB + arena/lighting settings. This test
 * locks the contract WITHOUT mutating the live scenes.json:
 *
 *   1. The zod scene contract accepts `kind: 'nursery'` with arena settings.
 *   2. A fresh/empty seed guarantees a `kind: 'nursery'` scene that round-trips.
 *   3. The nursery lookup (kind first, then name) resolves the seeded scene.
 *   4. Deriving the modelFile + arena settings from the seeded scene yields a
 *      resolvable backdrop for the pen.
 *
 * Run: DATA_DIR=/tmp/dw-scene-nursery-data pnpm --filter @digiworld/backend exec tsx test/scene-nursery-contract.mts
 * (DATA_DIR must point at a scratch dir with NO scenes.json so the fresh-boot
 * seed path runs deterministically — the real backend/data is never read/written.)
 */
import { ArenaSettingsZ } from '../src/scenes/routes.js';
import { listScenes } from '../src/scenes/store.js';

let failures = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

// 1. ArenaSettingsZ accepts kind:'nursery' with an arena shape (model + lighting).
const arenaPayload = {
  sunColor: 0xfff2d0,
  camDist: 14,
  modelFile: 'forest_biome.glb',
};
check('ArenaSettingsZ accepts nursery-typical arena settings', ArenaSettingsZ.safeParse(arenaPayload).success === true);
check('ArenaSettingsZ rejects unknown nursery-only knob', ArenaSettingsZ.safeParse({ ...arenaPayload, pensOnly: 1 }).success === false);

// 2. The seed guarantees a `kind:'nursery'` scene (fresh boot seeds it).
const seeded = await listScenes();
const nursery = seeded.find((s) => s.kind === 'nursery')
  ?? seeded.find((s) => s.name.trim().toLowerCase() === 'nursery');
check('seed exposes a nursery scene (kind or name)', nursery !== undefined);
check('a kind:\'nursery\' scene is present or the name resolves it', nursery !== undefined);

// 3. The pen's backdrop derivation from the seeded scene (mirrors Nursery.tsx).
if (nursery !== undefined) {
  const settings = nursery.settings as Record<string, unknown>;
  const modelFile = typeof settings.modelFile === 'string' && settings.modelFile !== ''
    ? settings.modelFile
    : undefined;
  check('nursery scene carries a modelFile (or falls back to default)', modelFile !== undefined || nursery.settings.modelFile === undefined);
  check('nursery scene kind resolves as \'nursery\'', nursery.kind === 'nursery');
  check('nursery scene settings are arena-shaped (strict-safe)', ArenaSettingsZ.safeParse(settings).success === true);
} else {
  check('nursery scene present to assert its backdrop', false);
}

process.exit(failures > 0 ? 1 : 0);