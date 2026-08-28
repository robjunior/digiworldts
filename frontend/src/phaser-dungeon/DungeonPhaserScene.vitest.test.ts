/**
 * Regression test for: "Uncaught TypeError: can't access property 'add',
 * this.updateList is null" when entering the dungeon.
 *
 * Root cause: `game.destroy(true)` (fired by the React view's unmount cleanup)
 * tears the scene down via Phaser's DESTROY event — NOT the SHUTDOWN event.
 * The scene's `shutdown()` was bound only to SHUTDOWN, so on the destroy path
 * it never ran: `booted` stayed `true` while Phaser nulled `this.add` /
 * `updateList`. Any deferred recompose (a tileset `loader` COMPLETE handler, a
 * dot-fallback, a sheet preload) then called `renderParty` → `this.add.group()`
 * on the dead scene and crashed. A full page reload "fixed" it only because it
 * is a single clean mount.
 *
 * The fix: bind `shutdown()` to BOTH SHUTDOWN and DESTROY, and guard
 * `setProps`/`recompose` behind `isAlive()` (booted && !dead) so a torn-down
 * scene is inert.
 *
 * This test runs the REAL DungeonPhaserScene `create()` + `shutdown()` with a
 * minimal Phaser stub (headless+happy-dom cannot drive Phaser's renderer/loop),
 * then reproduces the exact destroy-then-late-recompose race. `this.add` is
 * doubled with a spy so we can assert the crash vector (`add.group`) is never
 * reached on a dead scene.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Phaser from "phaser";

import { DungeonPhaserScene, DUNGEON_SCENE_KEY } from "./DungeonPhaserScene";
import type { DungeonRunView } from "@digiworld/shared";
import type { RosterView } from "../lib/api";

function fakeProps(): Parameters<DungeonPhaserScene["setProps"]> {
  const view = {
    dungeon: {
      id: "d-test",
      name: "Test",
      width: 8,
      height: 8,
      gridX: 0,
      gridY: 0,
      tilesetId: "t",
      seed: 1,
    },
    run: { currentX: 4, currentY: 4, facing: "right" as const },
    tilesets: [],
  } as unknown as DungeonRunView;
  const party = [
    { catalogId: "agumon", slot: 0, status: "party" },
  ] as unknown as RosterView[];
  const noop = () => {};
  return [
    view,
    [],
    [],
    party,
    "right",
    200,
    [{ x: 4, y: 4 }],
    noop,
    noop,
    noop,
  ];
}

let game: Phaser.Game | null = null;

beforeEach(() => {
  game = new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 32,
    height: 32,
    scene: [],
    fps: { smoothStep: false },
  });
});

afterEach(() => {
  game?.destroy(true);
  game = null;
});

/**
 * Build a real DungeonPhaserScene whose `create()` has run (so the SHUTDOWN /
 * DESTROY teardown bindings are registered) using a minimal Phaser stub. Returns
 * the scene plus a spy on `this.add.group` (the exact call that crashed when the
 * scene was torn down while still "booted").
 */
function wiredScene(): {
  scene: DungeonPhaserScene;
  groupSpy: ReturnType<typeof vi.fn>;
} {
  const scene = new DungeonPhaserScene();
  const groupSpy = vi.fn(() => ({ add: vi.fn() }));

  // Minimal Phaser surface that create()/shutdown()/recompose() touch.
  const noop = (): void => {};
  (scene as unknown as { cameras: unknown }).cameras = {
    main: {
      setBackgroundColor: noop,
      setZoom: noop,
      startFollow: noop,
      on: noop,
      off: noop,
      getBackgroundColor: () => 0,
    },
  };
  (scene as unknown as { add: unknown }).add = {
    container: () => ({ x: 0, y: 0 }),
    group: groupSpy,
    sprite: () => ({}),
    on: noop,
  };
  (scene as unknown as { input: unknown }).input = { on: noop, off: noop };
  (scene as unknown as { tweens: unknown }).tweens = {
    killTweensOf: noop,
    add: () => ({ remove: noop }),
  };
  (scene as unknown as { time: unknown }).time = {
    delayedCall: () => ({ remove: noop }),
  };
  (scene as unknown as { load: unknown }).load = {
    once: noop,
    start: noop,
    isLoading: () => false,
    list: { size: 0 },
  };
  (scene as unknown as { textures: unknown }).textures = {
    exists: () => true,
  };
  (scene as unknown as { anims: unknown }).anims = { exists: () => false };
  (scene as unknown as { make: unknown }).make = {
    tilemap: () => ({ addLayer: () => ({}), destroy: noop } as never),
  };
  (scene as unknown as { events: Phaser.Events.EventEmitter }).events =
    new Phaser.Events.EventEmitter();

  // Run the REAL create() so the SHUTDOWN/DESTROY → shutdown() bindings fire.
  scene.create();

  // Seed the props + follow target so a live recompose passes its guards.
  const props = fakeProps();
  (scene as unknown as { latestProps: unknown }).latestProps = {
    view: props[0],
    neighbors: props[1],
    remotePlayers: props[2],
    party: props[3],
    facing: props[4],
    moveDurationMs: props[5],
    partyTrail: props[6],
    onCellClick: props[7],
    onPlayerClick: props[8],
    onTextureFallback: props[9],
  };
  (scene as unknown as { followTarget: object }).followTarget = {
    x: 0,
    y: 0,
    setPosition: (nx: number, ny: number) => {
      (scene as unknown as { followTarget: { x: number; y: number } }).followTarget.x = nx;
      (scene as unknown as { followTarget: { x: number; y: number } }).followTarget.y = ny;
    },
  };
  // The render machinery (renderWorld/renderParty/renderRemotePlayers/moveFollowTarget)
  // needs a fully valid DungeonRunView and a real tilemap factory, which are out of
  // scope here. Stub them as no-ops so recompose exercises the gate/guard logic
  // (clearRendered + renderWorld call counts, follow-target move) without rendering.
  vi.spyOn(scene as unknown as { renderWorld: () => void }, "renderWorld").mockImplementation(noop);
  vi.spyOn(scene as unknown as { renderParty: () => void }, "renderParty").mockImplementation(noop);
  vi.spyOn(
    scene as unknown as { renderRemotePlayers: () => void },
    "renderRemotePlayers",
  ).mockImplementation(noop);
  vi.spyOn(
    scene as unknown as { moveFollowTarget: () => void },
    "moveFollowTarget",
  ).mockImplementation(noop);

  return { scene, groupSpy };
}

test("live scene is alive and recompose proceeds past the dead-guard", () => {
  const { scene } = wiredScene();
  expect(scene.isAlive()).toBe(true);

  // The render machinery (renderWorld/renderParty/renderRemotePlayers) needs a fully
  // valid DungeonRunView, which is out of scope here. Stub them so recompose proceeds
  // through the dead-guard and the follow-target move that runs right after it.
  const noop = (): void => {};
  vi.spyOn(
    scene as unknown as { moveFollowTarget: () => void },
    "moveFollowTarget",
  );
  vi.spyOn(scene as unknown as { renderWorld: () => void }, "renderWorld").mockImplementation(
    noop,
  );
  vi.spyOn(scene as unknown as { renderParty: () => void }, "renderParty").mockImplementation(
    noop,
  );
  vi.spyOn(
    scene as unknown as { renderRemotePlayers: () => void },
    "renderRemotePlayers",
  ).mockImplementation(noop);

  expect(() =>
    (scene as unknown as { recompose(): void }).recompose(),
  ).not.toThrow();
  expect(
    (
      scene as unknown as {
        moveFollowTarget: ReturnType<typeof vi.fn>;
      }
    ).moveFollowTarget,
  ).toHaveBeenCalled();
});

test("DESTROY path tears the scene down and a late recompose is inert (the original crash)", () => {
  const { scene, groupSpy } = wiredScene();

  // The bug vector: React calls game.destroy(true) (DESTROY) and a deferred
  // recompose (tileset load COMPLETE / dot fallback) fires afterwards.
  scene.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys, {});

  // With the fix, shutdown() is bound to DESTROY, so it ran and flipped dead.
  expect((scene as unknown as { dead: boolean }).dead).toBe(true);
  expect(scene.isAlive()).toBe(false);

  // A late recompose must NOT throw and must NOT reach this.add.group().
  expect(() =>
    (scene as unknown as { recompose(): void }).recompose(),
  ).not.toThrow();
  expect(groupSpy).not.toHaveBeenCalled();

  // setProps after teardown is also inert.
  expect(() => scene.setProps(...fakeProps())).not.toThrow();
  expect(groupSpy).not.toHaveBeenCalled();
});

test("without the isAlive guard a dead scene would crash on the nulled factory", () => {
  const { scene, groupSpy } = wiredScene();
  scene.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys, {});
  expect(scene.isAlive()).toBe(false);

  // Simulate Phaser having nulled the factory (what game.destroy(true) does).
  (scene as unknown as { add: unknown }).add = null;

  // With the guard, recompose bails before touching the null factory.
  expect(() =>
    (scene as unknown as { recompose(): void }).recompose(),
  ).not.toThrow();
  expect(groupSpy).not.toHaveBeenCalled();

  // Sanity: on a dead scene, recompose must NOT reach the render pipeline at all
  // (renderParty/renderWorld are never invoked). The guard short-circuits before
  // touching the nulled factory, which is exactly what prevents the original crash.
  const partySpy = vi.spyOn(
    scene as unknown as { renderParty: () => void },
    "renderParty",
  );
  (scene as unknown as { recompose(): void }).recompose();
  expect(groupSpy).not.toHaveBeenCalled();
  expect(partySpy).not.toHaveBeenCalled();
});

test("rebinding: create() again after DESTROY resets isAlive to true", () => {
  const { scene } = wiredScene();
  scene.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys, {});
  expect(scene.isAlive()).toBe(false);

  // A fresh mount re-runs create(), which resets the dead flag.
  scene.create();
  expect((scene as unknown as { dead: boolean }).dead).toBe(false);
  expect(scene.isAlive()).toBe(true);
});

/**
 * Regression test for the remote-player-positioning bug: a remote leader used
 * to be spawned via `spawnDigimonSprite(catalogId, 0, 0, ...)` inside a
 * Container, which left the async-loaded sprite orphaned at the WORLD ORIGIN
 * (0,0) — the "gray dot in the wrong place" — while the placeholder circle
 * sat at the correct cell. The fix places the leader (and name tag) at WORLD
 * coordinates `slotX + x*tileSize + tileSize/2` directly, with no container.
 *
 * This test drives the REAL `renderRemotePlayers` with a recording `add` stub
 * and asserts: (1) a remote player renders a leader object at its real cell,
 * (2) NO object is left orphaned at (0,0), and (3) the leader + name tag share
 * the same x/y.
 */
test("remote leader is positioned at its world cell, not orphaned at origin", () => {
  const created: Array<Record<string, unknown>> = [];
  const scene = new DungeonPhaserScene();
  const noop = (): void => {};

  (scene as unknown as { cameras: unknown }).cameras = {
    main: {
      setBackgroundColor: noop,
      setZoom: noop,
      startFollow: noop,
      on: noop,
      off: noop,
      getBackgroundColor: () => 0,
      width: 64,
      height: 64,
    },
  };
  const makeObj = (kind: string, x: number, y: number): Record<string, unknown> => {
    const obj: Record<string, unknown> = {
      kind,
      x,
      y,
      name: "",
      depth: 0,
      flipX: false,
      active: true,
      destroy: noop,
      setOrigin: () => obj,
      setDepth: (d: number) => {
        obj.depth = d;
        return obj;
      },
      setName: (n: string) => {
        obj.name = n;
        return obj;
      },
      setText: () => obj,
      setDisplaySize: () => obj,
      setFrame: () => obj,
      setFlipX: () => obj,
      play: () => obj,
      setData: () => obj,
      setPosition: (nx: number, ny: number) => {
        obj.x = nx;
        obj.y = ny;
        return obj;
      },
    };
    created.push(obj);
    return obj;
  };
  (scene as unknown as { add: unknown }).add = {
    container: () => ({ x: 0, y: 0, add: noop, setDepth: noop, destroy: noop, removeAll: noop, setPosition: noop }),
    group: () => ({ add: noop }),
    sprite: (x: number, y: number) => makeObj("sprite", x, y),
    circle: (x: number, y: number) => makeObj("circle", x, y) as never,
    text: (x: number, y: number) => makeObj("text", x, y),
    on: noop,
  };
  (scene as unknown as { input: unknown }).input = { on: noop, off: noop };
  (scene as unknown as { tweens: unknown }).tweens = {
    killTweensOf: noop,
    add: () => ({ remove: noop }),
  };
  (scene as unknown as { time: unknown }).time = {
    delayedCall: () => ({ remove: noop }),
  };
  (scene as unknown as { load: unknown }).load = {
    once: noop,
    start: noop,
    isLoading: () => false,
    list: { size: 0 },
    binary: noop,
    image: noop,
  };
  // No sheet/dot texture exists -> spawnDigimonSprite returns null (async load
  // never settles in the stub) -> leader renders as the placeholder circle.
  (scene as unknown as { textures: unknown }).textures = {
    exists: () => false,
  };
  (scene as unknown as { anims: unknown }).anims = { exists: () => false, create: noop, remove: noop };
  (scene as unknown as { children: unknown }).children = {
    getByName: () => null,
  };
  (scene as unknown as { make: unknown }).make = {
    tilemap: () => ({ addLayer: () => ({}), destroy: noop } as never),
  };
  (scene as unknown as { events: Phaser.Events.EventEmitter }).events =
    new Phaser.Events.EventEmitter();

  scene.create();
  // Isolate the unit under test: renderRemotePlayers. renderWorld/renderParty
  // need a fully-valid DungeonRunView (many POI fields) out of scope here.
  const noop3 = (): void => {};
  vi.spyOn(scene as unknown as { renderWorld: () => void }, "renderWorld").mockImplementation(noop3);
  vi.spyOn(scene as unknown as { renderParty: () => void }, "renderParty").mockImplementation(noop3);
  // moveFollowTarget is also exercised by recompose before renderRemotePlayers;
  // leave it (followTarget stub supports setPosition via add.container).
  const view = {
    dungeon: { id: "d1", name: "D", width: 8, height: 8, gridX: 0, gridY: 0, tilesetId: "t", seed: 1 },
    run: { currentX: 4, currentY: 4, facing: "right" as const },
    tilesets: [],
    tiles: [],
    encounters: [],
    doors: [],
    triggers: [],
    bridges: [],
    firedTriggerIds: [],
    defeatedEncounters: [],
    collectedItems: [],
    chests: [],
    poiStates: [],
  } as unknown as DungeonRunView;
  const party = [{ catalogId: "agumon", slot: 0, status: "party" }] as unknown as RosterView[];
  const remotePlayers = [
    {
      userId: "u2",
      displayName: "Satanoso",
      x: 5,
      y: 3,
      gridX: 0,
      gridY: 0,
      leaderCatalogId: "satanoso",
      party: ["satanoso"],
    },
  ];
  const noop2 = (): void => {};
  scene.setProps(
    view,
    [],
    remotePlayers,
    party,
    "right",
    200,
    [{ x: 4, y: 4 }],
    noop2,
    noop2,
    noop2,
  );

  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const leaders = created.filter((o) => str(o.kind) === "circle" && num(o.depth) === 999); // PARTY_DEPTH-1 = 1000-1
  // The placeholder circle (leader) is created at (176, 112), never at (0,0).
  const leaderAtCell = created.find(
    (o) => (str(o.kind) === "circle" || str(o.kind) === "sprite") && num(o.x) === 176 && num(o.y) === 112,
  );
  const orphanAtOrigin = created.find(
    (o) => (str(o.kind) === "circle" || str(o.kind) === "sprite") && num(o.x) === 0 && num(o.y) === 0,
  );
  expect(leaderAtCell, "remote leader should render at its world cell (176,112)").toBeDefined();
  expect(orphanAtOrigin, "no sprite/circle should be orphaned at the world origin (0,0)").toBeUndefined();
  // Exactly one leader object (circle) for the single remote player.
  expect(leaders.length).toBe(1);
});


