/**
 * Regression test: SpriteRig unitScale.
 *
 * LobbyScene3D aplica escala externa nos sprites da party (setUnitScale).
 * Antes, `update()` re-aplicava `baseScale` a cada frame e anulava o
 * `mesh.scale.setScalar(...)` externo — os digimons do lobby renderizavam
 * minúsculos (0.7u) e os labels cobriam eles. Garante:
 *   1. unitScale sobrevive ao update() (mesh.scale não volta a 0.7);
 *   2. os pés continuam plantados no chão (center - altura/2 ≈ GROUND_Y);
 *   3. setUnitScale(0) é ignorado (nunca zera a escala);
 *   4. sem unitScale, o comportamento padrão (combate) é preservado.
 *
 * Run:  tsx test/lobby-sprite-scale.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as THREE from 'three';

type FakeImage = {
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
  _load(): void;
};

const SHEET_PATH = resolve(process.cwd(), '..', 'backend', 'public', 'assets', 'sprites', '1.png');
const sheetBytes = readFileSync(SHEET_PATH);
const sheetW = sheetBytes.readUInt32BE(16);
const sheetH = sheetBytes.readUInt32BE(20);

const GROUND_Y = 0.02;

const imgInstances: FakeImage[] = [];

function makeFakeImage(): FakeImage {
  const img: FakeImage = {
    naturalWidth: sheetW,
    naturalHeight: sheetH,
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
      _sx: number, _sy: number, _sw: number, _sh: number,
      _dx: number, _dy: number, _dw: number, _dh: number,
    ) {},
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

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  } else {
    console.log('ok  -', msg);
  }
}

function makeRig(unitScale?: number): { rig: InstanceType<typeof SpriteRig>; load: () => Promise<void> } {
  const before = imgInstances.length;
  const rig = new SpriteRig(new THREE.Scene(), {
    unitId: `probe:${before}`,
    side: 'you',
    slotIndex: 0,
    textureUrl: '/assets/sprites/1.png',
    isSpritesheet: true,
    idleAnimated: true,
    ...(unitScale !== undefined ? { unitScale } : {}),
  });
  const load = async (): Promise<void> => {
    for (const img of imgInstances.slice(before)) img._load();
    await new Promise((r) => setTimeout(r, 20));
  };
  return { rig, load };
}

// ── 1. unitScale sobrevive ao update() ──────────────────────────────
{
  const { rig, load } = makeRig(5.2);
  await load();
  rig.update(0.016, 0.1, new THREE.Quaternion());
  assert(
    Math.abs(rig.mesh.scale.x - 0.7 * 5.2) < 0.001,
    `update() preserva unitScale (mesh.scale.x = ${rig.mesh.scale.x.toFixed(3)}, esperado ~3.64)`,
  );
  assert(
    Math.abs(rig.mesh.scale.y / rig.mesh.scale.x - 1) <= 0.032,
    `escala preserva proporção (breathe ±3% só no eixo y, got y/x = ${(rig.mesh.scale.y / rig.mesh.scale.x).toFixed(3)})`,
  );
}

// ── 2. pés plantados no chão com o fator aplicado ───────────────────
{
  const { rig, load } = makeRig();
  await load();
  rig.setUnitScale(4.3);
  rig.update(0.016, 0.1, new THREE.Quaternion());
  const feetY = rig.worldPosition.y - (rig.spriteSize.y * 4.3) / 2;
  assert(
    Math.abs(feetY - GROUND_Y) < 0.01,
    `pés no chão após setUnitScale (feetY = ${feetY.toFixed(3)}, esperado ${GROUND_Y})`,
  );
  // re-scale ao vivo (digimon troca de slot/layout): pés re-ancoram
  rig.setUnitScale(2);
  rig.update(0.016, 0.2, new THREE.Quaternion());
  const feetY2 = rig.worldPosition.y - (rig.spriteSize.y * 2) / 2;
  assert(
    Math.abs(feetY2 - GROUND_Y) < 0.01,
    `re-escala mantém os pés no chão (feetY2 = ${feetY2.toFixed(3)})`,
  );
}

// ── 3. setUnitScale(0) é ignorado ───────────────────────────────────
{
  const { rig, load } = makeRig(3);
  await load();
  rig.setUnitScale(0);
  rig.update(0.016, 0.3, new THREE.Quaternion());
  assert(
    Math.abs(rig.mesh.scale.x - 0.7 * 3) < 0.001,
    `setUnitScale(0) não zera a escala (mesh.scale.x = ${rig.mesh.scale.x.toFixed(3)})`,
  );
}

// ── 4. default (combate) preserva comportamento antigo ──────────────
{
  const { rig, load } = makeRig();
  await load();
  rig.mesh.scale.setScalar(99); // escrita externa...
  rig.update(0.016, 0.4, new THREE.Quaternion());
  assert(
    Math.abs(rig.mesh.scale.x - 0.7) < 0.001,
    `sem unitScale, update() mantém o comportamento antigo (scale = ${rig.mesh.scale.x.toFixed(3)}, esperado 0.7)`,
  );
  const feetY = rig.worldPosition.y - rig.spriteSize.y / 2;
  assert(
    Math.abs(feetY - GROUND_Y) < 0.01,
    `combate: pés no chão sem unitScale (feetY = ${feetY.toFixed(3)})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');