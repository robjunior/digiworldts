/**
 * Regression test: the combat 3D sprite rig must animate a USER-SUPPLIED 32x32
 * sheet (4 frames of 16x16) the same way it animates the authored 64x64 sheets.
 *
 * The rig derives the cell size from the sheet's actual pixel dimensions
 * (Math.floor(w / SHEET_COLS)), so a 32x32 sheet yields 16x16 cells. This test
 * drives the real SpriteRig with a 32x32 sheet and asserts:
 *   - the initial walk cell is frame 0, drawn at source rect (0,0,16,16)
 *   - advancing one walk interval moves to frame 1 (16,0,16,16)
 *   - playAttack() lands on the attack pose (cell 3, bottom-right)
 *
 * Runs under vitest (happy-dom). The 2D context shim records drawImage source
 * rects so we can recover which cell the rig drew without a GPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { SpriteRig } from "./sprite-rig";

const SHEET_W = 32;
const SHEET_H = 32;

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
      // Record every instance (the rig loads sheets via `new Image()`).
      createdImages.push(this as unknown as { onload: (() => void) | null; _load(): void });
    }
    _load() {
      queueMicrotask(() => this.onload?.());
    }
  }
  // The rig loads sheets via `new Image()`, not document.createElement('img'),
  // so we stub the global Image and record every instance it creates.
  vi.stubGlobal("Image", FakeImage);
  const origCreate = document.createElement.bind(document);
  vi.stubGlobal("document", {
    ...document,
    createElement: (tag: string) => {
      if (tag === "img") {
        return new FakeImage() as unknown as HTMLImageElement;
      }
      return origCreate(tag);
    },
  });
}

function clearShims() {
  drawCalls.length = 0;
  createdImages.length = 0;
  vi.unstubAllGlobals();
}

const COLS = 2;
const cellOf = (d: DrawCall) =>
  Math.round(d.sy / d.sh) * COLS + Math.round(d.sx / d.sw);

describe("SpriteRig with a 32x32 (16x16 cells) spritesheet", () => {
  beforeEach(() => installShims());
  afterEach(() => clearShims());

  it("slices 16x16 cells and walks 0 -> 1, attack lands on cell 3", async () => {
    const scene = new THREE.Scene();
    const rig = new SpriteRig(scene, {
      unitId: "t:0",
      side: "opp",
      slotIndex: 0,
      textureUrl: "/dev/null/32x32.png",
      isSpritesheet: true,
    });

    // Trigger the async image load the rig registered.
    createdImages.forEach((img) => img._load());
    await new Promise((r) => setTimeout(r, 20));

    const initial = drawCalls[drawCalls.length - 1]!;
    expect(cellOf(initial)).toBe(0);
    expect(initial).toMatchObject({ sx: 0, sy: 0, sw: 16, sh: 16 });

    // Advance one walk interval (WALK_FRAME_MS = 320, +slack).
    rig.update((320 + 50) / 1000, 0, new THREE.Quaternion());
    const afterWalk = drawCalls[drawCalls.length - 1]!;
    expect(cellOf(afterWalk)).toBe(1);
    expect(afterWalk).toMatchObject({ sx: 16, sy: 0, sw: 16, sh: 16 });

    // Attack pose should land on the bottom-right cell (index 3).
    rig.playAttack();
    const attack = drawCalls[drawCalls.length - 1]!;
    expect(cellOf(attack)).toBe(3);

    rig.dispose();
  });
});
