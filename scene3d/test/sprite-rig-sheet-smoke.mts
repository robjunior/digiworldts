/**
 * Smoke test for the four-frame spritesheet refactor in src/sprite-rig.ts.
 *
 * Drives the REAL SpriteRig class with a minimal DOM/canvas shim so we can
 * assert, against an actual generated sheet
 * (../backend/public/assets/sprites/1.png):
 *   1. The walk loop advances to cell 1 after WALK_FRAME_MS.
 *   2. playAttack() draws the ATTACK frame (cell 3, giving hit) and reverts to walk 0.
 *   3. playHit() draws the TAKE_HIT frame (cell 2, taking hit) and reverts to walk 0.
 *
 * Run:  tsx test/sprite-rig-sheet-smoke.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as THREE from 'three';

// --- DOM / canvas shim -----------------------------------------------------
type FakeImage = {
  naturalWidth: number;
  naturalHeight: number;
  _src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
  _load(): void;
};

const SHEET_PATH = resolve(process.cwd(), '..', 'backend', 'public', 'assets', 'sprites', '1.png');
const sheetBytes = readFileSync(SHEET_PATH);
const sheetW = sheetBytes.readUInt32BE(16);
const sheetH = sheetBytes.readUInt32BE(20);

interface DrawCall { sx: number; sy: number; sw: number; sh: number; }

const imgInstances: FakeImage[] = [];
const drawCalls: DrawCall[] = [];

function makeFakeImage(): FakeImage {
  const img: FakeImage = {
    naturalWidth: sheetW,
    naturalHeight: sheetH,
    _src: '',
    onload: null,
    onerror: null,
    remove() {},
    _load() {
      queueMicrotask(() => this.onload?.());
    },
  };
  imgInstances.push(img);
  return img;
}

function makeFakeCanvas() {
  let width = 0;
  let height = 0;
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
    drawImage(
      _img: unknown,
      sx: number, sy: number, sw: number, sh: number,
      _dx: number, _dy: number, _dw: number, _dh: number,
    ) {
      drawCalls.push({ sx, sy, sw, sh });
    },
    getImageData() {
      return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    },
  };
  return {
    set width(v: number) { width = v; },
    get width() { return width; },
    set height(v: number) { height = v; },
    get height() { return height; },
    getContext: () => ctx,
  };
}

const fakeDocument = {
  createElement(tag: string) {
    if (tag === 'canvas') return makeFakeCanvas();
    if (tag === 'img') return makeFakeImage();
    throw new Error(`unexpected element ${tag}`);
  },
  body: { appendChild() {} },
};

(globalThis as unknown as { document: unknown }).document = fakeDocument;
(globalThis as unknown as { Image: unknown }).Image = function () { return makeFakeImage(); };
(globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async (b: unknown) => b;

const { SpriteRig } = await import('../src/sprite-rig.ts');

const SHEET_COLS = 2;
const WALK_FRAME_MS = 320;
const HIT_FRAME_MS = 160;

function cellOf(d: DrawCall): number {
  const cellW = d.sw;
  const cellH = d.sh;
  const col = Math.round(d.sx / cellW);
  const row = Math.round(d.sy / cellH);
  return row * SHEET_COLS + col;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  -', msg);
}

const scene = new THREE.Scene();
const rig = new SpriteRig(scene, {
  unitId: 'test:0',
  side: 'opp',
  slotIndex: 0,
  textureUrl: '/assets/sprites/1.png',
  isSpritesheet: true,
});

for (const img of imgInstances) img._load();
await new Promise((r) => setTimeout(r, 10));

assert(drawCalls.length >= 1, 'sheet loaded and at least one frame drawn');
const firstCell = cellOf(drawCalls[drawCalls.length - 1]!);
assert(firstCell === 0, `initial frame is walk cell 0 (got ${firstCell})`);

rig.update((WALK_FRAME_MS + 50) / 1000, 0, new THREE.Quaternion());
const afterWalkCell = cellOf(drawCalls[drawCalls.length - 1]!);
assert(afterWalkCell === 1, `after WALK_FRAME_MS it loops to walk cell 1 (got ${afterWalkCell})`);

// playAttack -> frame 3 (ATTACK = giving hit), then revert to walk 0
drawCalls.length = 0;
rig.playAttack();
const attackCell = cellOf(drawCalls[drawCalls.length - 1]!);
assert(attackCell === 3, `playAttack draws ATTACK frame 3 (got ${attackCell})`);

rig.update((HIT_FRAME_MS + 10) / 1000, 0, new THREE.Quaternion());
const reverted = cellOf(drawCalls[drawCalls.length - 1]!);
assert(reverted === 0, `after HIT_FRAME_MS reverts to walk cell 0 (got ${reverted})`);

// playHit -> frame 2 (TAKE_HIT = taking hit), then revert to walk 0
drawCalls.length = 0;
rig.playHit();
const takeHitCell = cellOf(drawCalls[drawCalls.length - 1]!);
assert(takeHitCell === 2, `playHit draws TAKE_HIT frame 2 (got ${takeHitCell})`);

rig.update((HIT_FRAME_MS + 10) / 1000, 0, new THREE.Quaternion());
const reverted2 = cellOf(drawCalls[drawCalls.length - 1]!);
assert(reverted2 === 0, `after HIT_FRAME_MS reverts to walk cell 0 (got ${reverted2})`);

rig.dispose();
console.log('\nALL SPRITE-RIG SHEET SMOKE CHECKS PASSED');
