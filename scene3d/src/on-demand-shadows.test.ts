/**
 * Regression test for on-demand shadow updates (the scene3d stutter fix).
 *
 * With `renderer.shadowMap.autoUpdate = true` (the old default) the 2048² PCF
 * shadow map is re-rendered on EVERY animation frame — including idle frames
 * where nothing shadow-relevant moved. Combined with the per-frame key-light
 * jiggle that old code applied, the whole shadow map was recomputed ~60×/sec,
 * which read as low FPS / stutter.
 *
 * The fix sets `autoUpdate = false` and only requests a rebuild
 * (`shadowMap.needsUpdate = true`) on discrete shadow-affecting changes
 * (first frame, sprite add/remove, attack/hit anim windows, light/settings
 * changes, time-of-day blends, arena swaps). This test asserts that
 * invariant: prime once, then idle frames must NOT rebuild, but a
 * shadow-affecting action must trigger exactly one rebuild.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SceneManager } from "./scene";

// Spy on `shadowMap.needsUpdate` writes on the (mocked) renderer so we can
// count how many times the shadow map is actually requested for rebuild.
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

// happy-dom has no 2D canvas implementation; provide a no-op shim.
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

describe("SceneManager on-demand shadow updates", () => {
  let originalGetContext: unknown;
  let manager: SceneManager | null = null;
  let needsUpdateWrites: number[];
  let renderer: { shadowMap: { needsUpdate: boolean } } | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    install2DContextShim();
    installRafStub();
    needsUpdateWrites = [];
    const canvas = document.createElement("canvas");
    manager = new SceneManager(canvas);
    // Reach into the mocked renderer to count shadow-map rebuild requests.
    // `manager.renderer` is the FakeWebGLRenderer instance from the mock.
    renderer = manager.renderer as unknown as {
      shadowMap: { needsUpdate: boolean };
    };
    // Wrap the setter so every `shadowMap.needsUpdate = true` is recorded.
    let backing = renderer.shadowMap.needsUpdate;
    Object.defineProperty(renderer.shadowMap, "needsUpdate", {
      configurable: true,
      get: () => backing,
      set: (v: boolean) => {
        backing = v;
        if (v === true) needsUpdateWrites.push(needsUpdateWrites.length);
      },
    });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext =
      originalGetContext as typeof HTMLCanvasElement.prototype.getContext;
    vi.unstubAllGlobals();
    manager?.dispose();
    manager = null;
  });

  it("primes the shadow map once, then skips idle frames", () => {
    manager!.startLoop();
    // Construction may have already requested a build; clear the counter so we
    // only measure loop-driven requests.
    needsUpdateWrites.length = 0;

    // Frame 1 must prime the shadow map.
    stepFrames(1);
    expect(needsUpdateWrites.length).toBe(1);

    // Frames 2..6 are idle (no shadow-affecting change): the shadow map must
    // NOT be rebuilt again. This is the core stutter fix — old code rebuilt it
    // every one of these frames.
    stepFrames(5);
    expect(needsUpdateWrites.length).toBe(1);
  });

  it("rebuilds exactly once when a shadow-affecting action occurs", async () => {
    manager!.startLoop();
    needsUpdateWrites.length = 0;
    stepFrames(1); // prime
    expect(needsUpdateWrites.length).toBe(1);

    // Add a sprite (a new shadow caster) — should request one rebuild.
    await manager!.addSprite({
      unitId: "u1",
      side: "you",
      slotIndex: 0,
      textureUrl: "https://example.test/x.gif",
      onClick: undefined,
      initiallyDowned: false,
      isSpritesheet: false,
      idleAnimated: false,
    });
    stepFrames(1);
    expect(needsUpdateWrites.length).toBe(2);

    // Idle frames after the add must not rebuild again.
    stepFrames(4);
    expect(needsUpdateWrites.length).toBe(2);

    // Remove the sprite (caster gone) — one more rebuild.
    manager!.removeSprite("u1");
    stepFrames(1);
    expect(needsUpdateWrites.length).toBe(3);

    // And idle frames after removal stay quiet.
    stepFrames(4);
    expect(needsUpdateWrites.length).toBe(3);
  });

  it("tracks the shadow across the whole attack/hit anim window", async () => {
    manager!.startLoop();
    needsUpdateWrites.length = 0;
    stepFrames(1); // prime
    expect(needsUpdateWrites.length).toBe(1);

    const sprite = await manager!.addSprite({
      unitId: "attacker",
      side: "you",
      slotIndex: 0,
      textureUrl: "https://example.test/a.gif",
      onClick: undefined,
      initiallyDowned: false,
      isSpritesheet: false,
      idleAnimated: false,
    });
    // addSprite itself requested one rebuild.
    expect(needsUpdateWrites.length).toBe(2);

    // Begin the attack anim (lunge window ~0.5s). The sprite now actually moves,
    // so the loop must refresh the shadow map on every animation frame — this
    // is what fixes the stale-shadow-during-lunge regression.
    sprite.playAttack();
    stepFrames(1);
    expect(needsUpdateWrites.length).toBe(3); // animating frame 1
    stepFrames(5);
    // 5 more animating frames => 5 more rebuilds (window spans ~0.5s ≈ 30 frames,
    // so 6 frames are comfortably inside it).
    expect(needsUpdateWrites.length).toBe(8);

    // Trigger a hit anim too; step past BOTH anim windows (attack 0.5s + hit
    // 0.35s ≈ 51 frames) so everything returns to idle.
    sprite.playHit();
    stepFrames(60);
    const settled = needsUpdateWrites.length;
    expect(settled).toBeGreaterThan(8); // hit window rebuilt across its frames

    // Now idle: no further rebuilds (core on-demand invariant still holds).
    stepFrames(30);
    expect(needsUpdateWrites.length).toBe(settled);
  });
});
