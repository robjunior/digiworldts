/**
 * Regression test: when given the user's 32x32 "guide" sheet (4 colors, one per
 * 16x16 cell — dot000.PNG), the 3D rig must draw EXACTLY ONE cell at a time
 * (never the whole 2x2 block). This proves the "still showing 4 frames" symptom
 * is NOT caused by the rig drawing multiple cells.
 *
 * Run: `pnpm test` (vitest + happy-dom). Follows the repo's shim pattern.
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
      createdImages.push(this as unknown as { onload: (() => void) | null; _load(): void });
    }
    _load() {
      queueMicrotask(() => this.onload?.());
    }
  }
  // @ts-expect-error test shim
  globalThis.Image = FakeImage;
  const origCreate = document.createElement.bind(document);
  // @ts-expect-error test shim
  globalThis.document = {
    ...document,
    createElement: (tag: string) => {
      if (tag === "img") return new FakeImage() as unknown as HTMLImageElement;
      return origCreate(tag);
    },
  };
}

function clearShims() {
  drawCalls.length = 0;
  createdImages.length = 0;
  vi.unstubAllGlobals();
}

const COLS = 2;
const cellOf = (d: DrawCall) =>
  Math.round(d.sy / d.sh) * COLS + Math.round(d.sx / d.sw);

describe("SpriteRig with dot000 guide sheet (32x32, 4 colors)", () => {
  beforeEach(() => installShims());
  afterEach(() => clearShims());

  it("draws exactly one 16x16 cell per frame (never the whole 2x2)", async () => {
    const scene = new THREE.Scene();
    const rig = new SpriteRig(scene, {
      unitId: "t:0",
      side: "opp",
      slotIndex: 0,
      textureUrl: "/dev/null/dot000.png",
      isSpritesheet: true,
    });

    createdImages.forEach((img) => img._load());
    await new Promise((r) => setTimeout(r, 20));

    // Every drawImage in the recorded calls must be a 16x16 cell, never 32x32
    // (which would mean the whole 2x2 guide was drawn as one block).
    expect(drawCalls.length).toBeGreaterThan(0);
    for (const d of drawCalls) {
      expect(d.sw).toBe(16);
      expect(d.sh).toBe(16);
    }
    // The first frame is cell 0 (top-left) — one of the four guide cells, not all.
    const cells = new Set(drawCalls.map(cellOf));
    expect([...cells].sort()).toEqual([0]);

    rig.dispose();
  });
});
