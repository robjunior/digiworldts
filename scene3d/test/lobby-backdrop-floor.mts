/**
 * Regression repro: a platterless biome/lodge GLB chosen as the lobby scene
 * seats the party ON the model's real floor plane, centered — exactly like the
 * arena seats on its hdd_plattertop. Previously the fallback reframed these
 * models as a distant backdrop (scale 34/sourceSpan + bounding-box center at
 * z=-26), which left the digimons floating ~15u in front of the visible floor
 * ("looks bad, not aligned").
 *
 * The NEW rule (shared `lobbyPartyGround` in scene3d/src/lobby-settings.ts,
 * used by LobbyScene3D AND the admin ScenePreview):
 *   - arena GLB (has hdd_plattertop) → keep the load field transform, party on
 *     the platter top;
 *   - otherwise → reset root, scale 34/sourceSpan, party on the TOP of the
 *     largest-xz-footprint floor-ish surface (Ground_* / *_Floor / Floor_*),
 *     horizontally centered ON that floor (no z=-26, no partyHeight knob).
 *
 * Run:  npx tsx scene3d/test/lobby-backdrop-floor.mts
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import the REAL shared helper the renderers use (must stay in lockstep with
// LobbyScene3D.fitPartyToPlatter and ScenePreview.loadLobbyGlb).
const { lobbyPartyGround } = await import('file://' + resolve(process.cwd(), 'src/lobby-settings.ts'));

const GLB = resolve(process.cwd(), 'assets', 'arenas', 'forest_biome.glb');
const LODGE = resolve(process.cwd(), 'assets', 'arenas', 'dark_lodge_biome.glb');
if (!existsSync(GLB) || !existsSync(LODGE)) {
  console.error(`missing biome GLBs at ${GLB} / ${LODGE}`);
  process.exit(1);
}

// --- Node loader shims (identical to glb-measurement.md) ---
const REAL_FETCH = globalThis.fetch;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type: string, init: EventInit & { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
      super(type);
      this.lengthComputable = !!init.lengthComputable;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  };
}
globalThis.fetch = async (url: unknown, opts?: RequestInit) => {
  const href = url instanceof Request ? url.url : url instanceof URL ? url.href : String(url);
  if (href.startsWith('file:')) {
    const p = fileURLToPath(href);
    if (!existsSync(p)) return new Response(null, { status: 404 });
    const buf = readFileSync(p);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Response(ab, { status: 200 });
  }
  return REAL_FETCH(url, opts);
};
// --- end shims ---

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

const load = (path: string) => new GLTFLoader().loadAsync(new URL('file://' + path).href);

// biome floor: normalize 34/sourceSpan then seat (mirrors both renderers).
function normalizeBiome(model: THREE.Object3D): void {
  model.position.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(model);
  const sourceSpan = Math.max(sourceBox.getSize(new THREE.Vector3()).length(), 1);
  model.scale.setScalar(34 / sourceSpan);
  model.updateMatrixWorld(true);
}

/** largest-xz-footprint floor-ish node (the ground plane, not a stair/rock). */
function floorNodeOf(root: THREE.Object3D): { b: THREE.Box3 } | null {
  let best: { b: THREE.Box3 } | null = null;
  let bestArea = -1;
  root.traverse((o) => {
    if (!/ground|_floor|floor/i.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3());
    const area = s.x * s.z;
    if (area <= bestArea) return;
    best = { b };
    bestArea = area;
  });
  return best;
}

// --- 1. forest_biome.glb: party on Ground_Grass, centered ---------------
{
  const root = (await load(GLB)).scene;
  normalizeBiome(root);
  const ground = lobbyPartyGround(root);
  check('forest: detected kind=floor (largest Ground_* plane)', ground?.kind === 'floor', String(ground?.kind));
  const box = new THREE.Box3().setFromObject(root);
  const span = box.getSize(new THREE.Vector3()).length();
  check('forest: normalized span ~34u', Math.abs(span - 34) < 1.5, `span=${span.toFixed(2)}`);
  const floor = floorNodeOf(root);
  check('forest: floor node found', floor !== null);
  check('forest: party feet == Ground_Grass top',
    floor !== null && ground !== null && Math.abs(ground.y - floor.b.max.y) < 1e-6,
    `groundY=${ground?.y.toFixed(3)} floorTop=${floor?.b.max.y.toFixed(3)}`);
  check('forest: party horizontally ON the floor surface',
    floor !== null && ground !== null && ground.x >= floor.b.min.x - 1e-6 && ground.x <= floor.b.max.x + 1e-6
    && ground.z >= floor.b.min.z - 1e-6 && ground.z <= floor.b.max.z + 1e-6,
    `party@(${ground?.x.toFixed(2)},${ground?.z.toFixed(2)})`);
  // NOT pushed 26u behind: the party must sit INSIDE the model's x/z span.
  check('forest: party not displaced 26u behind (inside model span)',
    ground !== null && ground.z >= box.min.z - 1e-6 && ground.z <= box.max.z + 1e-6,
    `z=${ground?.z.toFixed(2)} span z[${box.min.z.toFixed(2)},${box.max.z.toFixed(2)}]`);
}

// --- 2. dark_lodge_biome.glb (the current Lobby scene model): Lodge_Floor ---
{
  const root = (await load(LODGE)).scene;
  normalizeBiome(root);
  const ground = lobbyPartyGround(root);
  check('lodge: detected kind=floor (Lodge_Floor)', ground?.kind === 'floor', String(ground?.kind));
  const floor = floorNodeOf(root);
  check('lodge: floor node found', floor !== null);
  check('lodge: party feet == Lodge_Floor top',
    floor !== null && ground !== null && Math.abs(ground.y - floor.b.max.y) < 1e-6,
    `groundY=${ground?.y.toFixed(3)} floorTop=${floor?.b.max.y.toFixed(3)}`);
  check('lodge: party horizontally ON the floor surface',
    floor !== null && ground !== null && ground.x >= floor.b.min.x - 1e-6 && ground.x <= floor.b.max.x + 1e-6
    && ground.z >= floor.b.min.z - 1e-6 && ground.z <= floor.b.max.z + 1e-6,
    `party@(${ground?.x.toFixed(2)},${ground?.z.toFixed(2)})`);
  const box = new THREE.Box3().setFromObject(root);
  check('lodge: party not displaced 26u behind (inside model span)',
    ground !== null && ground.z >= box.min.z - 1e-6 && ground.z <= box.max.z + 1e-6,
    `z=${ground?.z.toFixed(2)} span z[${box.min.z.toFixed(2)},${box.max.z.toFixed(2)}]`);
}

// --- 3. arena.glb keeps the platter classification (regression guard) ------
{
  const root = (await load(resolve(process.cwd(), 'assets', 'arenas', 'arena.glb'))).scene;
  const probe = lobbyPartyGround(root);
  check('arena: classified platter (unchanged field path)', probe?.kind === 'platter', String(probe?.kind));
}

console.log(`\n=== SUMMARY: ${failures === 0 ? 'all' : failures} passed ===`);
process.exit(failures > 0 ? 1 : 0);