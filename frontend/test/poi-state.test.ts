/**
 * Headless verification for the POI state helpers extracted from
 * DungeonPhaserScene. These are pure (no Phaser runtime), so they run under
 * `node --experimental-strip-types` without a DOM — proving the renderMap
 * split preserved the lever/door/bridge resolution rules.
 *
 * Run: node --experimental-strip-types test/poi-state.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { DungeonRunView } from "@digiworld/shared";
import {
  computeBridgeDownKeys,
  computeDoorOpenIds,
  digimonSpriteName,
  catalogIdFromSpriteName,
  POI_BADGE_LETTER,
  ANIMATION_HOLD_MS,
  MIN_TWEEN_MS,
} from "../src/phaser-dungeon/poi-state.ts";

function baseView(overrides: Partial<DungeonRunView> = {}): DungeonRunView {
  return {
    dungeon: { id: "d1", width: 10, height: 10, gridX: 0, gridY: 0 },
    run: {
      currentX: 0,
      currentY: 0,
      unlockedDoors: [],
      defeatedEncounters: [],
      collectedItems: [],
    },
    tiles: [],
    tilesets: [],
    encounters: [],
    items: [],
    warps: [],
    doors: [],
    traps: [],
    chests: [],
    triggers: [],
    bridges: [],
    dungeonKeys: [],
    poiStates: [],
    firedTriggerIds: [],
    groupInventory: [],
    ...overrides,
  } as DungeonRunView;
}

describe("computeDoorOpenIds", () => {
  it("returns door ids targeted by fired levers, across the whole group", () => {
    const view = baseView({
      firedTriggerIds: ["t1", "t2"],
      triggers: [
        {
          id: "t1",
          enabled: true,
          x: 0,
          y: 0,
          usedTileGid: 1,
          unusedTileGid: 2,
          targets: [{ kind: "door", doorId: "door-a" }],
        },
        {
          id: "t2",
          enabled: true,
          x: 1,
          y: 1,
          usedTileGid: 3,
          unusedTileGid: 4,
          targets: [
            { kind: "bridge", bridgeId: "b1" },
            { kind: "door", doorId: "door-b" },
          ],
        },
        {
          id: "t3",
          enabled: true,
          x: 2,
          y: 2,
          usedTileGid: 5,
          unusedTileGid: 6,
          targets: [{ kind: "door", doorId: "door-c" }],
        },
      ],
    });
    const open = computeDoorOpenIds(view);
    assert.deepEqual([...open].sort(), ["door-a", "door-b"]);
  });
});

describe("computeBridgeDownKeys", () => {
  it("marks `x,y` of bridges lowered by a fired lever target", () => {
    const view = baseView({
      firedTriggerIds: ["t1"],
      triggers: [
        {
          id: "t1",
          enabled: true,
          x: 0,
          y: 0,
          usedTileGid: 1,
          unusedTileGid: 2,
          targets: [{ kind: "bridge", bridgeId: "b1" }],
        },
      ],
      bridges: [
        { id: "b1", enabled: true, x: 4, y: 5, upTileGid: 7, downTileGid: 8 },
      ],
    });
    assert.deepEqual([...computeBridgeDownKeys(view)], ["4,5"]);
  });

  it("does not mark a bridge whose lever has not fired", () => {
    const view = baseView({
      firedTriggerIds: [],
      triggers: [
        {
          id: "t1",
          enabled: true,
          x: 0,
          y: 0,
          usedTileGid: 1,
          unusedTileGid: 2,
          targets: [{ kind: "bridge", bridgeId: "b1" }],
        },
      ],
      bridges: [
        { id: "b1", enabled: true, x: 4, y: 5, upTileGid: 7, downTileGid: 8 },
      ],
    });
    assert.equal(computeBridgeDownKeys(view).size, 0);
  });
});

describe("digimon sprite name round-trip", () => {
  it("recovers the catalog id from a generated sprite name", () => {
    const name = digimonSpriteName("party", "agumon");
    assert.equal(name, "digimon:party:agumon");
    assert.equal(catalogIdFromSpriteName(name), "agumon");
    assert.equal(catalogIdFromSpriteName("digimon:party:sheet-agumon"), "agumon");
    assert.equal(catalogIdFromSpriteName("digimon:remote-leader:dot-agumon"), "agumon");
  });
});

describe("constants", () => {
  it("exposes the former magic numbers as named exports", () => {
    assert.equal(ANIMATION_HOLD_MS, 400);
    assert.equal(MIN_TWEEN_MS, 1);
    assert.equal(POI_BADGE_LETTER.encounter, "E");
  });
});
