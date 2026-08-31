/**
 * Regression test for the Clock→Timer migration bug.
 *
 * `THREE.Timer` only advances its internal delta/elapsed when `update()` is
 * called once per frame. The render loop in `SceneManager.startLoop` reads
 * `clock.getDelta()` / `clock.getElapsed()` to drive the entrance camera
 * pan/zoom, sprite movement, and effect runners. If the loop never calls
 * `clock.update()`, `dt` stays 0 forever and the entire scene is frozen.
 *
 * This test drives the real `startLoop` and asserts that `clock.update()` is
 * invoked on every animation frame. Reverting the fix (removing the
 * `this.clock.update(...)` call) makes this fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { SceneManager } from "./scene";

// Replace only `WebGLRenderer` on the real `three` module; keep `Timer` and
// everything else intact (we want the genuine Timer behaviour under test).
// The fake renderer is defined *inside* the factory because `vi.mock` is
// hoisted above all top-level statements, so a class declared at module scope
// would not yet be initialized when the factory runs.
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

// happy-dom has no 2D canvas implementation; the texture builders throw if the
// context is null. Provide a no-op 2D context shim so `SceneManager` can build.
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

// Controllable requestAnimationFrame: captures the callback so the test can
// step frames deterministically with its own timestamps.
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

describe("SceneManager render loop drives THREE.Timer.update()", () => {
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

  it("calls clock.update() on every frame so dt advances", () => {
    const canvas = document.createElement("canvas");
    const manager = new SceneManager(canvas);
    manager.startLoop();

    const updateSpy = vi.spyOn(THREE.Timer.prototype, "update");
    const deltaValues: number[] = [];
    const originalGetDelta = THREE.Timer.prototype.getDelta;
    THREE.Timer.prototype.getDelta = function (this: THREE.Timer) {
      const d = originalGetDelta.call(this);
      deltaValues.push(d);
      return d;
    };
    // Reset counts collected during any construction-time path; we only care
    // about loop frames.
    updateSpy.mockClear();

    expect(updateSpy).not.toHaveBeenCalled();
    stepFrames(5);

    // One update() per animation frame — this is the line of code that was
    // missing after the Clock→Timer migration.
    expect(updateSpy).toHaveBeenCalledTimes(5);

    // And because update() ran, getDelta()/getElapsed() must no longer be 0.
    THREE.Timer.prototype.getDelta = originalGetDelta;
    expect(deltaValues.length).toBeGreaterThan(0);
    expect(deltaValues.every((d) => d > 0)).toBe(true);

    manager.dispose();
  });

  it("produces a non-zero delta on the very first frame (no frozen first tick)", () => {
    const canvas = document.createElement("canvas");
    const manager = new SceneManager(canvas);
    manager.startLoop();

    const deltas: number[] = [];
    const originalGetDelta = THREE.Timer.prototype.getDelta;
    THREE.Timer.prototype.getDelta = function (this: THREE.Timer) {
      const d = originalGetDelta.call(this);
      deltas.push(d);
      return d;
    };

    stepFrames(3);
    THREE.Timer.prototype.getDelta = originalGetDelta;

    // The bug left every delta at exactly 0. After the fix the first frame
    // already yields a positive delta.
    expect(deltas.length).toBeGreaterThanOrEqual(3);
    expect(deltas.every((d) => d > 0)).toBe(true);

    manager.dispose();
  });
});
