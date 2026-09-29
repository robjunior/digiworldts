/**
 * Combat camera director — turn-focus framing and melee cast advance.
 *
 * Two layers:
 *   1) `CameraDirector` (pure) — easing toward a framing target, zoom clamp.
 *   2) `SceneManager` integration — `focusUnit` pulls the camera in on a
 *      digimon's turn; `playEffect` (melee) walks the attacker to a
 *      face-to-face contact point and back while the camera tracks it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { CameraDirector, clampZoom, framePoint, targetsEqual } from "./camera-direction";
import { SceneManager } from "./scene";

vi.mock("three", async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import("three");
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement | null = null;
    shadowMap = { enabled: false, type: 0, needsUpdate: false };
    outputColorSpace = "";
    toneMapping = 0;
    toneMappingExposure = 1;
    info = { render: { calls: 0, triangles: 0 } };
    constructor(params: { canvas: HTMLCanvasElement }) {
      this.domElement = params.canvas;
    }
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...mod, WebGLRenderer: FakeWebGLRenderer };
});

function install2DContextShim(): void {
  const noop = () => {};
  const shim = {
    fillStyle: "",
    strokeStyle: "",
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillRect: noop,
    clearRect: noop,
    beginPath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    canvas: null as HTMLCanvasElement | null,
  };
  // @ts-expect-error override for test environment only
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    shim.canvas = this;
    return shim as unknown as CanvasRenderingContext2D;
  };
}

let rafCallbacks: Array<(t: number) => void> = [];
let rafIdSeq = 1;
let nowMs = 1000;
function installRafStub(): void {
  rafCallbacks = [];
  rafIdSeq = 1;
  nowMs = 1000;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallbacks.push(cb);
    return rafIdSeq++;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}
// Monotonically increasing rAF timestamps — THREE.Timer computes delta from
// consecutive timestamps, so resetting the base each call would go backward
// and yield negative/zero dt (a false read on the cast timeline).
function stepFrames(count: number, stepMs = 16.7): void {
  for (let i = 0; i < count; i += 1) {
    const ts = nowMs;
    nowMs += stepMs;
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(ts);
  }
}

describe("CameraDirector", () => {
  it("eases zoom toward a framing target and settles", () => {
    const dir = new CameraDirector({
      lookX: 0, lookY: 0, lookZ: 0, dist: 14, elevDeg: 22, yawDeg: 22, zoom: 1,
    });
    const target = { ...dir.target, zoom: 0.7, lookX: 3 };
    dir.easeTo(target, 1);
    expect(dir.active).toBe(true);
    dir.tick(0.5);
    expect(dir.target.zoom).toBeGreaterThan(0.7);
    expect(dir.target.zoom).toBeLessThan(1);
    expect(dir.target.lookX).toBeGreaterThan(0);
    dir.tick(2);
    expect(dir.active).toBe(false);
    expect(dir.target.zoom).toBeCloseTo(0.7, 5);
    expect(dir.target.lookX).toBeCloseTo(3, 5);
  });

  it("clamps the zoom to the safe range", () => {
    expect(clampZoom(3)).toBe(2);
    expect(clampZoom(-1)).toBe(0.4);
    expect(clampZoom(0.86)).toBe(0.86);
  });

  it("framePoint + targetsEqual agree on a settled frame", () => {
    const base = { dist: 14, elevDeg: 22, yawDeg: 22 };
    const a = framePoint({ x: 1, y: 2, z: 3 }, 0.7, base.dist, base.elevDeg, base.yawDeg);
    const b = framePoint({ x: 1, y: 2, z: 3 }, 0.7, base.dist, base.elevDeg, base.yawDeg);
    expect(targetsEqual(a, b)).toBe(true);
    expect(a.zoom).toBe(0.7);
  });
});

describe("SceneManager combat camera", () => {
  let originalGetContext: unknown;
  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    install2DContextShim();
    installRafStub();
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext =
      originalGetContext as typeof HTMLCanvasElement.prototype.getContext;
    vi.unstubAllGlobals();
  });

  async function buildScene(): Promise<SceneManager> {
    const canvas = document.createElement("canvas");
    const manager = new SceneManager(canvas);
    await manager.addSprite({
      unitId: "a:0", side: "you", slotIndex: 0, textureUrl: "/assets/sprites/1.png",
      isSpritesheet: true, idleAnimated: false, onClick: undefined,
    });
    await manager.addSprite({
      unitId: "b:0", side: "opp", slotIndex: 0, textureUrl: "/assets/sprites/2.png",
      isSpritesheet: true, idleAnimated: false, onClick: undefined,
    });
    manager.startLoop();
    return manager;
  }

  it("focusUnit does NOT zoom — camera holds the fixed stage zoom", async () => {
    const manager = await buildScene();
    void manager.getSettings().camFrustum;
    stepFrames(3);
    const idleZoom = (manager as unknown as { zoomMult: number }).zoomMult;
    manager.focusUnit("a:0");
    stepFrames(60);
    // The scene deliberately never zooms — the camera only re-tracks position.
    expect((manager as unknown as { zoomMult: number }).zoomMult).toBeCloseTo(idleZoom, 2);
    expect((manager as unknown as { zoomMult: number }).zoomMult).toBeCloseTo(clampZoom(idleZoom), 2);
    manager.dispose();
  });

  it("melee cast advances face-to-face then walks the attacker back to its slot", async () => {
    const manager = await buildScene();
    manager.focusUnit("a:0");
    stepFrames(20);

    const attacker = manager.getSprite("a:0")!;
    const startX = attacker.worldPosition.x; // ≈ -3 (its slot)
    const startZ = attacker.worldPosition.z;
    const zoomBefore = (manager as unknown as { zoomMult: number }).zoomMult;

    // Fire a basic melee attack from a:0 at b:0.
    manager.playEffect("fire", "a:0", "b:0");

    // ~0.37s in: charge reaches full face-to-face contact (target x ≈ +3,
    // contact ≈ +2.1). Assert it crossed deep into the enemy half.
    stepFrames(22);
    const contactX = attacker.worldPosition.x;
    expect(contactX).toBeGreaterThan(startX + 4); // > +1, well past the midline
    // The attack must NOT change zoom — keep the pre-attack (turn) zoom.
    expect((manager as unknown as { zoomMult: number }).zoomMult).toBeCloseTo(zoomBefore, 2);

    // Let the whole cycle finish (charge + walk-back-while-hold + camera reset).
    // Cast ends at impact + hold ≈ 1.3s; camera settles shortly after.
    stepFrames(140);
    // The attacker MUST be back at its exact slot (x and z).
    expect(attacker.worldPosition.x).toBeCloseTo(startX, 0.5);
    expect(attacker.worldPosition.z).toBeCloseTo(startZ, 0.5);
    // Camera reset toward the next turn's framing at the same fixed stage zoom.
    const endZoom = (manager as unknown as { zoomMult: number }).zoomMult;
    expect(endZoom).toBeCloseTo(1, 2);
    expect(endZoom).toBeCloseTo(zoomBefore, 2);
    manager.dispose();
  });
});