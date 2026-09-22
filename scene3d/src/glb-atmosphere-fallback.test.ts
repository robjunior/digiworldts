/**
 * Regression test for the GLB-default fallback atmosphere.
 *
 * When the scene editor is in "GLB as default" mode (`useGlbSettings=true`),
 * combat + the admin preview load the arena with `loadArenaModelBare`. Most
 * GLBs — including `arena.glb` — ship no KHR_lights_punctual lights (they only
 * carry emissive materials / an atmosphere volume), so the manager must fall
 * back to a coherent arena-keyed atmosphere instead of rendering in darkness.
 *
 * This asserts the invariant: bare-load with no GLB lights applies the
 * arena-keyed (or per-filename override) lighting but keeps scene fog disabled;
 * bare-load of a GLB that DOES embed a punctual light surrenders the rig.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { SceneManager } from "./scene";

/* ── renderer + 2D context shims (same harness as on-demand-shadows.test) ── */
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

/* Allow the test to inject an arbitrary GLTF scene (lights or bare meshes).
 * vi.hoisted runs before the mocked module is imported, so the factory can
 * safely read `holder.root` without a TDZ error. */
const holder = vi.hoisted(() => ({ root: undefined as unknown }));
vi.mock("three-stdlib", async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import("three-stdlib");
  const FakeGLTFLoader = class {
    async loadAsync(): Promise<{ scene: THREE.Object3D }> {
      return { scene: holder.root as unknown as THREE.Object3D };
    }
  };
  return { ...mod, GLTFLoader: FakeGLTFLoader };
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

/* The `steel` arena atmosphere — mirrored from the const array in scene.ts so
 * the test asserts an actual value instead of a magic constant. */
const STEEL_ATMOSPHERE = {
  sky: 0x60789a,
  ground: 0x1a2028,
  hemiIntensity: 0.55,
  keyColor: 0xffe0a8,
  keyIntensity: 1.05,
  rimColor: 0x2c74ff,
  rimIntensity: 0.6,
  fillColor: 0xffb676,
  fillIntensity: 0.22,
  exposure: 1.0,
  dustColor: 0xa8b4c8,
  dustOpacity: 0.22,
};

type ManagerAccess = {
  hemi: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
};

describe("loadArenaModelBare GLB-default fallback atmosphere", () => {
  let originalGetContext: unknown;
  let manager: SceneManager | null = null;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    install2DContextShim();
    const canvas = document.createElement("canvas");
    manager = new SceneManager(canvas);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext =
      originalGetContext as typeof HTMLCanvasElement.prototype.getContext;
    vi.unstubAllGlobals();
    manager?.dispose();
    manager = null;
    holder.root = undefined;
  });

  function access(): ManagerAccess {
    return {
      hemi: (manager as unknown as { hemi: THREE.HemisphereLight }).hemi,
      keyLight: (manager as unknown as { keyLight: THREE.DirectionalLight }).keyLight,
      rimLight: (manager as unknown as { rimLight: THREE.DirectionalLight }).rimLight,
      fillLight: (manager as unknown as { fillLight: THREE.DirectionalLight }).fillLight,
    };
  }

  it("applies the arena-keyed atmosphere when the GLB ships no lights (bare mesh)", async () => {
    holder.root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()),
    );

    await manager!.loadArenaModelBare("https://assets.test/forest_biome.glb", "steel");

    // No GLB lights → arena-keyed lighting must be applied as the fallback.
    expect(access().hemi.color.getHex()).toBe(STEEL_ATMOSPHERE.sky);
    expect(access().hemi.intensity).toBe(STEEL_ATMOSPHERE.hemiIntensity);
    expect(access().keyLight.color.getHex()).toBe(STEEL_ATMOSPHERE.keyColor);
    expect(access().keyLight.intensity).toBe(STEEL_ATMOSPHERE.keyIntensity);
    expect(access().rimLight.intensity).toBe(STEEL_ATMOSPHERE.rimIntensity);
    expect(access().fillLight.intensity).toBe(STEEL_ATMOSPHERE.fillIntensity);
    // GLB-default mode keeps scene fog off — the GLB's own atmosphere owns haze.
    expect(manager!.scene.fog).toBeNull();
  });

  it("falls back to `steel` for arena.glb even without an arena key (per-filename override)", async () => {
    holder.root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()),
    );

    // arena.glb is the neutral cyber/factory arena with no embedded lights.
    await manager!.loadArenaModelBare("https://assets.test/arena.glb");

    expect(access().hemi.color.getHex()).toBe(STEEL_ATMOSPHERE.sky);
    expect(access().keyLight.intensity).toBe(STEEL_ATMOSPHERE.keyIntensity);
  });

  it("surrenders the rig when the GLB embeds a punctual light", async () => {
    const light = new THREE.PointLight(0xffffff, 2);
    light.position.set(0, 10, 0);
    holder.root = new THREE.Group().add(light);

    await manager!.loadArenaModelBare("https://assets.test/dark_lodge_biome.glb", "dark");

    // A GLB with real lights drives the lighting: the manager dims its own rig.
    expect(access().hemi.intensity).toBe(0.15);
    expect(access().keyLight.intensity).toBe(0.35);
    expect(access().rimLight.intensity).toBe(0);
    expect(access().fillLight.intensity).toBe(0);
    expect(manager!.scene.fog).toBeNull();
  });
});