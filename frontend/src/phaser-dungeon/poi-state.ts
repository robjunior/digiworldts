/**
 * Phaser-free POI helpers extracted from `DungeonPhaserScene`. Keeping them in
 * a module that never imports the Phaser runtime means they can be unit-tested
 * headlessly (Phaser needs a DOM) and reused by the admin preview / tests.
 */
import type Phaser from "phaser";
import type { DungeonRunView, TilesetGrant } from "@digiworld/shared";

// Animation hold durations (ms) — previously hardcoded as 400 in the attack /
// take-hit poses and 1 in every tween-duration clamp.
export const ANIMATION_HOLD_MS = 400;
export const MIN_TWEEN_MS = 1;
// Letters drawn on the always-on-top POI badges. Bosses render as a digimon
// sprite (no badge), so they are intentionally omitted here.
export const POI_BADGE_LETTER = {
  door: "D",
  chest: "C",
  trap: "T",
  trigger: "L",
  bridge: "B",
  encounter: "E",
  item: "I",
} as const;
// Fill color for the fallback marker drawn when a lever/bridge POI has no tile
// GID picked (admin placed it without a tile).
export const FALLBACK_MARKER_COLOR = {
  trigger: 0xffcf4d,
  bridge: 0x4aa3ff,
} as const;

/** Stable, parseable name for a digimon party/remote/boss sprite. */
export function digimonSpriteName(
  catalogId: string,
  x: number,
  y: number,
): string {
  return `digimon:${catalogId}:${x}:${y}`;
}

/** Reverse of `digimonSpriteName`: recover the catalog id (strip sheet-/dot- prefixes). */
export function catalogIdFromSpriteName(name: string): string {
  const raw = name.split(":")[1] ?? "";
  return raw.replace(/^sheet-/, "").replace(/^dot-/, "");
}

/** Typed read of arbitrary game-object metadata stored via `setData`. */
export function getSpriteData<T>(
  obj: Phaser.GameObjects.GameObject,
  key: string,
): T | undefined {
  const value = obj.getData(key);
  return value === undefined || value === null ? undefined : (value as T);
}

/** Door ids unlocked by already-fired lever triggers (cross-map). */
export function computeDoorOpenIds(view: DungeonRunView): Set<string> {
  const firedSet = new Set(view.firedTriggerIds);
  const doorOpenIds = new Set<string>();
  for (const trigger of view.triggers) {
    if (!firedSet.has(trigger.id)) continue;
    for (const target of trigger.targets) {
      if (target.kind === "door" && target.doorId !== null)
        doorOpenIds.add(target.doorId);
    }
  }
  return doorOpenIds;
}

/** `"x,y"` keys of bridges currently lowered by a fired lever trigger. */
export function computeBridgeDownKeys(view: DungeonRunView): Set<string> {
  const firedSet = new Set(view.firedTriggerIds);
  const bridgeDownKeys = new Set<string>();
  for (const bridge of view.bridges) {
    const lowered = view.triggers.some(
      (trigger) =>
        firedSet.has(trigger.id) &&
        trigger.targets.some(
          (target) =>
            target.kind === "bridge" && target.bridgeId === bridge.id,
        ),
    );
    if (lowered) bridgeDownKeys.add(`${bridge.x},${bridge.y}`);
  }
  return bridgeDownKeys;
}

/**
 * Frozen view of one map slot's POI inputs, passed to the per-POI render
 * methods so `renderMap` stays a thin orchestrator instead of a 600-line blob.
 */
export type PoiRenderContext = {
  readonly view: DungeonRunView;
  readonly tileSize: number;
  readonly primary: TilesetGrant | null;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly slotGridX: number;
  readonly slotGridY: number;
  readonly poiCell: (x: number, y: number) => number;
  readonly poiRow: (x: number, y: number) => number;
  readonly firedSet: ReadonlySet<string>;
  readonly doorOpenIds: ReadonlySet<string>;
  readonly bridgeDownKeys: ReadonlySet<string>;
  readonly poiStateByKey: ReadonlyMap<string, string>;
};
