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
function installRafStub(): void {
  rafCallbacks = [];
  rafIdSeq = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallbacks.push(cb);
    return rafIdSeq++;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}
function stepFrames(count: number, startMs = 1000, stepMs = 16.7): void {
  for (let i = 0; i < count; i += 1) {
    const ts = startMs + i * stepMs;
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

  it("focusUnit pulls the camera in on its turn (zoomMult < 1)", async () => {
    const manager = await buildScene();
    const defaultZoom = manager.getSettings().camFrustum; // unused snapshot
    void defaultZoom;
    // Seed a default shot first.
    stepFrames(3);
    const idleZoom = (manager as unknown as { zoomMult: number }).zoomMult;
    manager.focusUnit("a:0");
    stepFrames(60);
    expect(clampZoom((manager as unknown as { zoomMult: number }).zoomMult)).toBeLessThan(1);
    expect((manager as unknown as { zoomMult: number }).zoomMult).toBeLessThan(idleZoom);
    manager.dispose();
  });

  it("melee cast advances the attacker face-to-face and walks it back", async () => {
    const manager = await buildScene();
    manager.focusUnit("a:0");
    stepFrames(30);

    const attacker = manager.getSprite("a:0")!;
    const startX = attacker.worldPosition.x;

    // Fire a basic melee attack from a:0 at b:0.
    manager.playEffect("fire", "a:0", "b:0");
    // ~0.6s in: charge (0.45s) done -> attacker is at/near contact, camera zoomed in.
    stepFrames(40); // ~0.67s
    const midX = attacker.worldPosition.x;
    const zoomMult = (manager as unknown as { zoomMult: number }).zoomMult;

    // Attacker crossed toward the enemy side (target x ≈ +3) — face to face.
    expect(midX).toBeGreaterThan(startX + 2);
    // Camera is zoomed in while following the cast.
    expect(zoomMult).toBeLessThan(1);

    // Let the whole cycle finish (charge + hold + return ≈ 1.8s).
    stepFrames(140); // ~2.3s more
    const endX = attacker.worldPosition.x;
    expect(endX).toBeCloseTo(startX, 0.5);
    // Camera settled back on the focused digimon (a:0) at the FOCUS zoom.
    const endZoom = (manager as unknown as { zoomMult: number }).zoomMult;
    expect(endZoom).toBeLessThan(1);
    expect(endZoom).toBeGreaterThan(0.5);
    manager.dispose();
  });
});