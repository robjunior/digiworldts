/**
 * Camera-system tests for DungeonPhaserScene: zoom (wheel + animated + clamp),
 * effects (shake/flash/fade), and the minimap (second viewport camera).
 *
 * These drive the REAL scene methods with a richer Phaser stub than the
 * lifecycle test: the main camera records shake/flash/fade/zoom calls, and
 * `cameras.add` returns a tracked minimap camera whose `ignore`/bounds we can
 * assert. The renderer/tilemap is mocked (renderWorld/renderParty) so the unit
 * under test is purely the camera API surface.
 */
import { expect, test, vi } from "vitest";
import Phaser from "phaser";

import { DungeonPhaserScene } from "./DungeonPhaserScene";

const noop = (): void => {};

type CameraLog = {
  shake: { duration: number; intensity: number } | null;
  flash: { duration: number; r: number; g: number; b: number } | null;
  fade: { dir: "out" | "in"; duration: number; rgb: number[] } | null;
  zoomTo: { zoom: number; duration: number } | null;
  setZoom: number | null;
  ignore: Phaser.GameObjects.GameObject[] | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  centerOn: { x: number; y: number } | null;
};

function makeCamera(width: number, height: number) {
  const log: CameraLog = {
    shake: null,
    flash: null,
    fade: null,
    zoomTo: null,
    setZoom: null,
    ignore: null,
    bounds: null,
    centerOn: null,
  };
  const cam = {
    width,
    height,
    x: 0,
    y: 0,
    zoom: 2,
    backgroundColor: 0,
    alpha: 1,
    setBackgroundColor: noop,
    setAlpha: noop,
    setZoom: (z: number) => {
      cam.zoom = z;
      log.setZoom = z;
    },
    zoomTo: (z: number, d: number) => {
      log.zoomTo = { zoom: z, duration: d };
    },
    shake: (d: number, i: number) => {
      log.shake = { duration: d, intensity: i };
    },
    flash: (d: number, r: number, g: number, b: number) => {
      log.flash = { duration: d, r, g, b };
    },
    fadeOut: (d: number, r: number, g: number, b: number) => {
      log.fade = { dir: "out", duration: d, rgb: [r, g, b] };
    },
    fadeIn: (d: number, r: number, g: number, b: number) => {
      log.fade = { dir: "in", duration: d, rgb: [r, g, b] };
    },
    startFollow: noop,
    on: noop,
    off: noop,
    once: noop,
    ignore: (objs: Phaser.GameObjects.GameObject[]) => {
      log.ignore = objs;
    },
    setBounds: (x: number, y: number, w: number, h: number) => {
      log.bounds = { x, y, width: w, height: h };
    },
    centerOn: (x: number, y: number) => {
      log.centerOn = { x, y };
    },
    remove: noop,
    _log: log,
  };
  return cam;
}

function cameraScene(): {
  scene: DungeonPhaserScene;
  main: ReturnType<typeof makeCamera> & { _log: CameraLog };
  added: (ReturnType<typeof makeCamera> & { _log: CameraLog })[];
} {
  const scene = new DungeonPhaserScene();
  const main = makeCamera(800, 600);
  const added: (ReturnType<typeof makeCamera> & { _log: CameraLog })[] = [];
  (scene as unknown as { cameras: unknown }).cameras = {
    main,
    getMain: () => main,
    add: (x: number, y: number, w: number, h: number) => {
      const c = makeCamera(w, h);
      c.x = x;
      c.y = y;
      added.push(c);
      return c;
    },
    remove: noop,
  };
  (scene as unknown as { add: unknown }).add = {
    container: () => ({ x: 0, y: 0, setPosition: noop, add: noop }),
    group: () => ({ add: noop }),
    sprite: () => ({}),
    rectangle: () => {
      const base = {
        destroy: noop,
        setOrigin: () => base,
        setStrokeStyle: () => base,
        setFillStyle: () => base,
        setScrollFactor: () => base,
        setDepth: () => base,
        setData: () => base,
      };
      return base;
    },
    on: noop,
  };
  (scene as unknown as { input: unknown }).input = { on: noop, off: noop };
  (scene as unknown as { tweens: unknown }).tweens = {
    killTweensOf: noop,
    add: () => ({ remove: noop }),
  };
  (scene as unknown as { time: unknown }).time = {
    delayedCall: (d: number, cb?: () => void) => {
      if (cb) cb();
      return { remove: noop };
    },
  };
  (scene as unknown as { load: unknown }).load = {
    once: noop,
    start: noop,
    isLoading: () => false,
    list: { size: 0 },
  };
  (scene as unknown as { textures: unknown }).textures = { exists: () => true };
  (scene as unknown as { anims: unknown }).anims = { exists: () => false };
  (scene as unknown as { make: unknown }).make = {
    tilemap: () => ({ addLayer: () => ({}), destroy: noop } as never),
  };
  (scene as unknown as { events: Phaser.Events.EventEmitter }).events =
    new Phaser.Events.EventEmitter();
  scene.create();
  return { scene, main, added };
}

test("shake dispatches camera.shake with clamped-free intensity", () => {
  const { scene, main } = cameraScene();
  scene.shake(300, 0.02);
  expect(main._log.shake).toEqual({ duration: 300, intensity: 0.02 });
});

test("flash dispatches camera.flash with rgb", () => {
  const { scene, main } = cameraScene();
  scene.flash(120, 255, 0, 0);
  expect(main._log.flash).toEqual({ duration: 120, r: 255, g: 0, b: 0 });
});

test("fadeOut records fade-out + fadeIn records fade-in", () => {
  const { scene, main } = cameraScene();
  let completed = false;
  scene.fadeOut(500, 0, 0, 0, () => {
    completed = true;
  });
  expect(main._log.fade).toEqual({ dir: "out", duration: 500, rgb: [0, 0, 0] });
  expect(completed).toBe(false); // onComplete only fires on the Phaser event
  scene.fadeIn(800, 0, 0, 0);
  expect(main._log.fade).toEqual({ dir: "in", duration: 800, rgb: [0, 0, 0] });
});

test("setZoom animates via zoomTo and clamps to MAX_ZOOM", () => {
  const { scene, main } = cameraScene();
  scene.setZoom(99, 250);
  expect(main._log.zoomTo).toEqual({ zoom: 3.5, duration: 250 });
});

test("setZoom clamps to MIN_ZOOM", () => {
  const { scene, main } = cameraScene();
  scene.setZoom(-5, 0);
  expect(main._log.setZoom).toBe(1);
});

test("mouse wheel zoom zooms out on scroll-down and clamps", () => {
  const { scene, main } = cameraScene();
  // @ts-expect-error testing private handler directly
  scene.applyWheelZoom({}, [], 0, 120);
  // wheel down (deltaY>0) => zoom out: 2 - 0.2 = 1.8
  expect(main._log.zoomTo?.zoom).toBeCloseTo(1.8, 5);
});

test("enableMinimap creates a second camera in the bottom-right corner", () => {
  const { scene, added } = cameraScene();
  // Seed a composed world so clampBounds exists for reframe.
  (scene as unknown as { clampBounds: unknown }).clampBounds = {
    x: 0,
    y: 0,
    width: 3200,
    height: 1600,
  };
  scene.enableMinimap();
  expect(added.length).toBe(1);
  const mini = added[0]!;
  // Bottom-right: x = 800 - size - 8, y = 600 - size - 8
  expect(mini.x).toBe(800 - 150 - 8);
  expect(mini.y).toBe(600 - 150 - 8);
  expect(mini.width).toBe(150);
  expect(mini.height).toBe(150);
  // Reframed to the whole world (centerOn world center).
  expect(mini._log.centerOn).toEqual({ x: 1600, y: 800 });
  expect(scene.isMinimapEnabled()).toBe(true);
  // getState reports the minimap camera.
  const state = scene.getState();
  expect(state.minimap?.enabled).toBe(true);
  expect(state.minimap?.width).toBe(150);
});

test("disableMinimap clears the enabled flag", () => {
  const { scene } = cameraScene();
  (scene as unknown as { clampBounds: unknown }).clampBounds = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  };
  scene.enableMinimap();
  scene.disableMinimap();
  expect(scene.isMinimapEnabled()).toBe(false);
  expect(scene.getState().minimap).toBeNull();
});

test("dead scene ignores camera calls (no crash, no-op)", () => {
  const { scene, main } = cameraScene();
  // Tear down via DESTROY (mirrors the real unmount path).
  scene.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys, {});
  expect(scene.isAlive()).toBe(false);
  expect(() => scene.shake()).not.toThrow();
  expect(() => scene.flash()).not.toThrow();
  expect(() => scene.fadeOut()).not.toThrow();
  expect(() => scene.setZoom(2)).not.toThrow();
  expect(() => scene.enableMinimap()).not.toThrow();
  expect(main._log.shake).toBeNull();
  expect(scene.isMinimapEnabled()).toBe(false);
});

test("triggerBossHit fires shake + flash (game-feel) when a boss exists", () => {
  const { scene, main } = cameraScene();
  // Inject a fake boss sprite into renderedSprites with the right data.
  const boss = {
    name: "boss:metalgreymon",
    anims: { currentAnim: { key: "" } },
    setData: (k: string, v: unknown) => {
      (boss as Record<string, unknown>)[k] = v;
    },
    getData: (k: string) => (boss as Record<string, unknown>)[k],
    play: noop,
  };
  boss.setData("poiKind", "boss");
  boss.setData("bossCatalogId", "metalgreymon");
  (scene as unknown as { renderedSprites: unknown }).renderedSprites = [boss];
  // getSpriteData reads via getData; stub children + anims.
  (scene as unknown as { children: unknown }).children = { getByName: () => null };
  // playDigimonAttack needs this.anims.exists; it returns false -> no play called.
  scene.triggerBossHit("metalgreymon");
  expect(main._log.shake).toEqual({ duration: 150, intensity: 0.008 });
  expect(main._log.flash).toEqual({ duration: 80, r: 255, g: 255, b: 255 });
});
