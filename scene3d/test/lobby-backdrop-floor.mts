/**
 * Regression repro: biome/lodge GLBs without `hdd_plattertop` seat the lobby
 * party on the SCENE FLOOR, not at the raw `partyHeight` knob.
 *
 * Replicates LobbyScene3D.fitPartyToPlatter's no-platter fallback (and the
 * mirrored admin ScenePreview.loadLobbyGlb): reset root transform, scale to
 * 34/sourceSpan, then align the model's LOWEST POINT to groundY and place the
 * bounding-box center at z=-26. Before the fix the fallback centered the box
 * on the camera view ray, leaving the forest floor ~12u BELOW the party —
 * digimons floated ("renderizando lá em cima").
 *
 * Run:  npx tsx scene3d/test/lobby-backdrop-floor.mts
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GLB = resolve(process.cwd(), 'assets', 'arenas', 'forest_biome.glb');
if (!existsSync(GLB)) {
  console.error(`missing forest_biome.glb at ${GLB}`);
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

const gltf = await new GLTFLoader().loadAsync(new URL('file://' + GLB).href);
const root = gltf.scene;

// No platter in the biome.
let platterFound = false;
root.traverse((o) => { if (/hdd_plattertop/i.test(o.name)) platterFound = true; });
check('forest_biome.glb has no hdd_plattertop (fallback path)', platterFound === false);

// --- Exact fallback math (mirrors LobbyScene3D / ScenePreview) ---
function reframeAsBackdrop(model: THREE.Object3D, groundY: number): void {
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(model);
  const sourceSpan = Math.max(sourceBox.getSize(new THREE.Vector3()).length(), 1);
  model.scale.multiplyScalar(34 / sourceSpan);
  model.updateMatrixWorld(true);
  const backdropBox = new THREE.Box3().setFromObject(model);
  const backdropCenter = backdropBox.getCenter(new THREE.Vector3());
  model.position.set(
    0 - backdropCenter.x,
    groundY - backdropBox.min.y,
    -26 - backdropCenter.z,
  );
  model.updateMatrixWorld(true);
}

// Forest scene partyHeight = 3 (dev data) — party feet must TOUCH the floor.
const groundY = 3;
reframeAsBackdrop(root, groundY);
const box = new THREE.Box3().setFromObject(root);
const center = box.getCenter(new THREE.Vector3());
check('backdrop lowest point == party ground (feet on floor)',
  Math.abs(box.min.y - groundY) < 1e-6, `min.y=${box.min.y} groundY=${groundY}`);
check('backdrop bounding-box center at z=-26',
  Math.abs(center.z + 26) < 1e-6, `center.z=${center.z}`);
check('backdrop center x aligned to stage center (0)',
  Math.abs(center.x) < 1e-6, `center.x=${center.x}`);

// Default partyHeight (0) also rests on the floor.
const root2 = (await new GLTFLoader().loadAsync(new URL('file://' + GLB).href)).scene;
reframeAsBackdrop(root2, 0);
const box2 = new THREE.Box3().setFromObject(root2);
check('default partyHeight=0: feet on floor', Math.abs(box2.min.y) < 1e-6, `min.y=${box2.min.y}`);

console.log(`\n=== SUMMARY: ${failures === 0 ? 'all' : failures} passed ===`);
process.exit(failures > 0 ? 1 : 0);