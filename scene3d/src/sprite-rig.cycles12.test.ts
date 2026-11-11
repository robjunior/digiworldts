/**
 * Regression test: the 3D rig must drive the NEW 3×4 (twelve-frame) sheet layout
 * through the exact cycle semantics the user specified:
 *
 *   walk  = cells 0,1,2   (movement)     happy = 3,7 (DEFAULT idle state)
 *   angry = 6,8,11 (attack)              sad = 9,10 (status until cleared)
 *   death = 4,5 (dead, persists in place, can still be revived)
 *
 * Layout is detected from the sheet's real dimensions: non-square -> cycles-12
 * (3 cols × 4 rows), square -> legacy fallback (untouched).
 *
 * Run: `pnpm test` (vitest + happy-dom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { SpriteRig, type SpriteRigConfig } from "./sprite-rig";

// Non-square -> 3×4 layout; each cell is 32×32 (96×128 sheet).
const SHEET_W = 96;
const SHEET_H = 128;

interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
const drawCalls: DrawCall[] = [];
const createdImages: { onload: (() => void) | null; _load(): void }[] = [];

function installShims() {
  const noop = () => {};
  const ctxShim = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    arc: noop,
    fill: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage(
      _i: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      _dx: number,
      _dy: number,
      _dw: number,
      _dh: number,
    ) {
      drawCalls.push({ sx, sy, sw, sh });
    },
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData: noop,
    setTransform: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    canvas: null as HTMLCanvasElement | null,
  };
  // @ts-expect-error override for test environment only
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    ctxShim.canvas = this;
    return ctxShim as unknown as CanvasRenderingContext2D;
  };

  class FakeImage {
    naturalWidth = SHEET_W;
    naturalHeight = SHEET_H;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    remove() {}
    constructor() {
      createdImages.push(this as unknown as { onload: (() => void) | null; _load(): void });
    }
    _load() {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
  const origCreate = document.createElement.bind(document);
  vi.stubGlobal("document", {
    ...document,
    createElement: (tag: string) => {
      if (tag === "img") return new FakeImage() as unknown as HTMLImageElement;
      return origCreate(tag);
    },
  });
}

function clearShims() {
  drawCalls.length = 0;
  createdImages.length = 0;
  vi.unstubAllGlobals();
}

const COLS = 3; // cycles-12 layout
const currentCell = () => {
  const d = drawCalls[drawCalls.length - 1]!;
  return Math.round(d.sy / d.sh) * COLS + Math.round(d.sx / d.sw);
};

function makeRig(opts?: { idleAnimated?: boolean }) {
  const scene = new THREE.Scene();
  const rig = new SpriteRig(scene, {
    unitId: "t:0",
    side: "opp",
    slotIndex: 0,
    textureUrl: "/dev/null/12frames.png",
    isSpritesheet: true,
    ...(opts?.idleAnimated !== undefined ? { idleAnimated: opts.idleAnimated } : {}),
  });
  createdImages.forEach((img) => img._load());
  return rig;
}

const HAPPY_CELLS = [3, 7]; // happy cycle (default idle) = frames 4 & 8

describe("SpriteRig with a 3×4 (twelve-frame) spritesheet", () => {
  beforeEach(() => installShims());
  afterEach(() => clearShims());

  it("defaults to the happy cycle and does not walk when idle", async () => {
    const rig = makeRig(); // default idleAnimated=true → happy loops 3↔7
    await new Promise((r) => setTimeout(r, 20));

    expect(HAPPY_CELLS).toContain(currentCell());
    for (let i = 0; i < 10; i += 1) {
      rig.update(0.35, 0, new THREE.Quaternion());
      // Idle stays on the happy idle frame — never a walk cell (0,1,2).
      expect(HAPPY_CELLS).toContain(currentCell());
    }
    rig.dispose();
  });

  it("walks the walk cycle (0,1,2) while moving, and returns to happy when stopped", async () => {
    const rig = makeRig();
    await new Promise((r) => setTimeout(r, 20));

    rig.setMoving(true);
    expect([0, 1, 2]).toContain(currentCell());
    const seen = new Set<number>();
    for (let i = 0; i < 24; i += 1) {
      rig.update((320 + 50) / 1000, 0, new THREE.Quaternion());
      seen.add(currentCell());
    }
    // Walk cycle must be exactly the three walk cells.
    expect([...seen].sort()).toEqual([0, 1, 2]);

    rig.setMoving(false);
    expect(HAPPY_CELLS).toContain(currentCell());
    rig.dispose();
  });

  it("plays the angry cycle (attack) as a transient reaction then settles back", async () => {
    const rig = makeRig();
    await new Promise((r) => setTimeout(r, 20));

    rig.playAttack();
    expect([6, 8, 11]).toContain(currentCell()); // angry 1 first

    // Walk the transient reaction to completion in fine steps so every angry
    // cell is visited; the reaction resolves back to the persistent happy cycle.
    const visited = new Set<number>([currentCell()]);
    let safety = 0;
    while (safety < 40) {
      rig.update(0.05, 0, new THREE.Quaternion());
      visited.add(currentCell());
      if ([...visited].every((c) => c === 3 || c === 7)) break; // returned to happy
      safety += 1;
    }
    // All three angry cells were visited during the reaction.
    expect([6, 8, 11].every((c) => visited.has(c))).toBe(true);

    // After the reaction ends it returns to the default happy state.
    expect(HAPPY_CELLS).toContain(currentCell());
    rig.dispose();
  });

  it("shows the sad cycle (9,10) while afflicted and reverts when the status clears", async () => {
    const rig = makeRig();
    await new Promise((r) => setTimeout(r, 20));

    rig.setSad(true);
    expect([9, 10]).toContain(currentCell());
    for (let i = 0; i < 3; i += 1) rig.update((320 + 50) / 1000, 0, new THREE.Quaternion());
    expect([9, 10]).toContain(currentCell());

    rig.setSad(false);
    expect(HAPPY_CELLS).toContain(currentCell());
    rig.dispose();
  });

  it("stays in the death cycle when downed (visible, persists) and revives to happy", async () => {
    const rig = makeRig();
    await new Promise((r) => setTimeout(r, 20));

    rig.setDowned(true);
    expect([4, 5]).toContain(currentCell());
    for (let i = 0; i < 5; i += 1) rig.update((320 + 50) / 1000, 0, new THREE.Quaternion());
    expect([4, 5]).toContain(currentCell());

    rig.setDowned(false);
    expect(HAPPY_CELLS).toContain(currentCell());
    rig.dispose();
  });
});