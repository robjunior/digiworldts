import Phaser from 'phaser';

import type { DungeonGridNeighbor, DungeonRunView, TilesetGrant } from '@digiworld/shared';
import { TILED_GID_FLIP_H, findTilesetForGid } from '@digiworld/shared';
import type { RosterView } from '../lib/api';
import { primaryTileset } from '../lib/tileset-sprite';
import {
  bareGidForTile,
  preloadTilesets,
  registerTilesets,
  tileFrame,
  tileFrameForGid,
  tilesetKey,
  tiledFlipBits,
} from './tilesets';

export const DUNGEON_SCENE_KEY = 'DungeonPhaserScene';
export const DUNGEON_CAMERA_ZOOM = 2;
const TILE_SIZE_FALLBACK = 32;
const BACKGROUND_COLOR = '#1c1f2a';

export type Facing = 'left' | 'right';

export type DungeonPhaserTileFrame = {
  readonly texture: string;
  readonly frame: number;
};

export type DungeonPhaserDebugState = {
  readonly sprites: readonly { readonly catalogId: string; readonly flipX: boolean; readonly x: number; readonly y: number }[];
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly follow: { readonly x: number; readonly y: number };
  /**
   * Todo 2 debug scaffold: the single tile drawn via `tileFrame` at a known
   * cell (the first tileset-backed tile of the run view). Todo 3 replaces the
   * one-tile draw with full tilemap layers. Absent on fallback dungeons with
   * no tilesets.
   */
  readonly debugTile?: {
    readonly x: number;
    readonly y: number;
    readonly gid: number;
    readonly bareGid: number;
    readonly texture: string;
    readonly frame: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
    readonly rotation: number;
  };
  /** tileFrame probes proving the malformed-input contract (null, never throws). */
  readonly tileFrames?: {
    readonly inRange: DungeonPhaserTileFrame | null;
    readonly flipped: DungeonPhaserTileFrame | null;
    readonly outOfRange: DungeonPhaserTileFrame | null;
    readonly noOwner: DungeonPhaserTileFrame | null;
  };
};

declare global {
  interface Window {
    __dungeonPhaser?: {
      readonly scene: DungeonPhaserScene;
      getState(): DungeonPhaserDebugState;
    };
  }
}

type SceneProps = {
  readonly view: DungeonRunView;
  readonly neighbors: readonly DungeonGridNeighbor[];
  readonly party: readonly RosterView[];
  readonly facing: Facing;
  readonly moveDurationMs: number;
  readonly partyTrail: readonly { readonly x: number; readonly y: number }[];
};

type WorldLayout = {
  readonly width: number;
  readonly height: number;
  readonly playerX: number;
  readonly playerY: number;
};

type PositionedView = {
  readonly view: DungeonRunView;
  readonly gridX: number;
  readonly gridY: number;
};

/**
 * Slot math mirrored verbatim from ContinuousDungeonGrid: the composed world
 * is a grid of slots, one per map (active + neighbors). World units are native
 * tile size; the camera zooms ×2 so the screen cell matches the DOM's
 * PLAYER_ZOOM. The player's world position is the follow target.
 */
function computeLayout(view: DungeonRunView, neighbors: readonly DungeonGridNeighbor[]): WorldLayout {
  const active: PositionedView = {
    view,
    gridX: view.dungeon.gridX ?? 0,
    gridY: view.dungeon.gridY ?? 0,
  };
  const positions: readonly PositionedView[] = [
    active,
    ...neighbors.map((neighbor) => ({ view: neighbor.view, gridX: neighbor.gridX, gridY: neighbor.gridY })),
  ];
  const tileSize = primaryTileset(view.tilesets)?.tileWidth ?? TILE_SIZE_FALLBACK;
  const slotWidth = Math.max(...positions.map((entry) => entry.view.dungeon.width)) * tileSize;
  const slotHeight = Math.max(...positions.map((entry) => entry.view.dungeon.height)) * tileSize;
  const minGridX = Math.min(...positions.map((entry) => entry.gridX));
  const minGridY = Math.min(...positions.map((entry) => entry.gridY));
  const maxGridX = Math.max(...positions.map((entry) => entry.gridX));
  const maxGridY = Math.max(...positions.map((entry) => entry.gridY));
  const width = (maxGridX - minGridX + 1) * slotWidth;
  const height = (maxGridY - minGridY + 1) * slotHeight;
  const playerX = (active.gridX - minGridX) * slotWidth + view.run.currentX * tileSize + tileSize / 2;
  const playerY = (active.gridY - minGridY) * slotHeight + view.run.currentY * tileSize + tileSize / 2;
  return { width, height, playerX, playerY };
}

/**
 * Skeleton of the Phaser dungeon renderer. Pure props renderer — all game
 * rules stay in the route + backend. Todo 1 renders nothing but a solid
 * background: this class establishes the lifecycle (`create`/`shutdown`),
 * the idempotent `setProps` re-composition (which later todos fill with tile
 * layers, POIs and party sprites), and the `window.__dungeonPhaser` debug
 * hook every QA scenario reads.
 */
export class DungeonPhaserScene extends Phaser.Scene {
  private latestProps: SceneProps | null = null;
  private followTarget: Phaser.GameObjects.Container | null = null;
  private booted = false;
  private debugTileSprite: Phaser.GameObjects.Sprite | null = null;
  private debugTileState: DungeonPhaserDebugState['debugTile'] = undefined;
  private tileFrameProbes: DungeonPhaserDebugState['tileFrames'] = undefined;

  constructor() {
    super({ key: DUNGEON_SCENE_KEY });
  }

  create(): void {
    this.booted = true;
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setZoom(DUNGEON_CAMERA_ZOOM);
    this.followTarget = this.add.container(0, 0);
    this.cameras.main.startFollow(this.followTarget, true, 1, 1);
    window.__dungeonPhaser = {
      scene: this,
      getState: () => this.getState(),
    };
    // Props arrive after create() (wrapper READY event) — the texture pipeline
    // runs lazily from setProps → recompose, not from a preload() hook.
    if (this.latestProps !== null) this.recompose();
  }

  shutdown(): void {
    if (window.__dungeonPhaser?.scene === this) {
      delete window.__dungeonPhaser;
    }
    this.debugTileSprite = null;
    this.debugTileState = undefined;
    this.tileFrameProbes = undefined;
    this.booted = false;
    this.latestProps = null;
    this.followTarget = null;
  }

  /**
   * Idempotent world re-composition from the latest props. Safe to call
   * before `create()` (the wrapper mounts the game async): props are stored
   * and applied when the scene boots. Camera scroll and the follow target are
   * preserved across re-composition — the grid-crossing case (dungeon.id
   * change) recomposes in place instead of snapping the camera back to the
   * origin.
   */
  setProps(
    view: DungeonRunView,
    neighbors: readonly DungeonGridNeighbor[],
    party: readonly RosterView[],
    facing: Facing,
    moveDurationMs: number,
    partyTrail: readonly { readonly x: number; readonly y: number }[],
  ): void {
    this.latestProps = { view, neighbors, party, facing, moveDurationMs, partyTrail };
    if (this.booted) this.recompose();
  }

  getState(): DungeonPhaserDebugState {
    const camera = this.cameras.main;
    const follow = this.followTarget;
    return {
      sprites: [],
      camera: { x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom },
      follow: { x: follow?.x ?? 0, y: follow?.y ?? 0 },
      ...(this.debugTileState !== undefined ? { debugTile: this.debugTileState } : {}),
      ...(this.tileFrameProbes !== undefined ? { tileFrames: this.tileFrameProbes } : {}),
    };
  }

  private recompose(): void {
    const props = this.latestProps;
    if (props === null || this.followTarget === null) return;
    const camera = this.cameras.main;
    const layout = computeLayout(props.view, props.neighbors);
    // startFollow (lerp 1) tracks this target every frame, so moving it in
    // place keeps camera continuity across grid-crossing re-compositions.
    this.followTarget.setPosition(layout.playerX, layout.playerY);
    // Small maps: with useBounds, Phaser's clamp re-centers the whole world
    // (bx = (displayWidth - width)/2) and tiles drift off-screen — match the
    // DOM grid by leaving bounds off so the follow target stays centered.
    const viewW = camera.width / camera.zoom;
    const viewH = camera.height / camera.zoom;
    if (layout.width <= viewW && layout.height <= viewH) {
      camera.useBounds = false;
    } else {
      camera.setBounds(0, 0, layout.width, layout.height);
    }
    const grants = props.view.tilesets;
    const missing = grants.filter((grant) => !this.textures.exists(tilesetKey(grant)));
    if (missing.length > 0) {
      // Textures land async — queue the load, register frames on complete,
      // then recompose again (which renders once every grant has a texture).
      this.ensureTilesetsLoaded(grants);
      return;
    }
    this.renderDebugTile(props);
  }

  private texturesLoading = false;

  /**
   * Kick off a runtime tileset load for grants that have no texture yet.
   * `preloadTilesets` returns only the keys actually queued, so a re-entrant
   * call for already-requested (e.g. failed) grants registers no listener and
   * cannot spin on an empty loader.
   */
  private ensureTilesetsLoaded(grants: readonly TilesetGrant[]): void {
    if (this.texturesLoading) return;
    const missing = grants.filter((grant) => !this.textures.exists(tilesetKey(grant)));
    if (missing.length === 0) return;
    const queued = preloadTilesets(this, missing);
    if (queued.length === 0) return;
    this.texturesLoading = true;
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.texturesLoading = false;
      registerTilesets(this, missing);
      this.recompose();
    });
    this.load.start();
  }

  /**
   * Todo 2 temporary scaffold: draw ONE tile via `tileFrame` at a known cell —
   * the first tileset-backed tile of the run view — so Playwright can
   * pixel-compare it against the DOM render. Todo 3 replaces this with the
   * real tilemap layers (which use `registerTilesetsOnTilemap` + bare GIDs).
   * No-op on dungeons without tilesets (the flat fallback path).
   */
  private renderDebugTile(props: SceneProps): void {
    if (this.debugTileSprite !== null) {
      this.debugTileSprite.destroy();
      this.debugTileSprite = null;
    }
    this.debugTileState = undefined;
    this.tileFrameProbes = undefined;
    const grants = props.view.tilesets;
    if (grants.length === 0) return;
    const tileSize = primaryTileset(grants)?.tileWidth ?? TILE_SIZE_FALLBACK;
    const candidate = props.view.tiles.find((tile) => findTilesetForGid(tile.gid, grants) !== null);
    if (candidate === undefined) return;
    const grant = findTilesetForGid(candidate.gid, grants)!;
    const frame = tileFrame(grant, candidate.gid);
    if (frame === null) return;
    const outOfRangeGid = grant.firstgid + grant.tileCount + 5;
    const flippedGid = (candidate.gid | TILED_GID_FLIP_H) >>> 0;
    this.tileFrameProbes = {
      inRange: frame,
      flipped: tileFrame(grant, flippedGid),
      outOfRange: tileFrame(grant, outOfRangeGid),
      noOwner: tileFrameForGid(outOfRangeGid, grants),
    };
    if (!this.textures.exists(frame.texture)) return;
    const sprite = this.add.sprite(
      candidate.x * tileSize + tileSize / 2,
      candidate.y * tileSize + tileSize / 2,
      frame.texture,
      frame.frame,
    );
    sprite.setOrigin(0.5, 0.5);
    const flip = tiledFlipBits(candidate.gid);
    sprite.setFlipX(flip.flipX);
    sprite.setFlipY(flip.flipY);
    sprite.setAngle(flip.rotation);
    this.debugTileSprite = sprite;
    this.debugTileState = {
      x: candidate.x,
      y: candidate.y,
      gid: candidate.gid,
      bareGid: bareGidForTile(candidate.gid),
      texture: frame.texture,
      frame: frame.frame,
      flipX: flip.flipX,
      flipY: flip.flipY,
      rotation: flip.rotation,
    };
  }
}
