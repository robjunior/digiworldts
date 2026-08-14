import Phaser from 'phaser';

import type { DungeonGridNeighbor, DungeonRunView } from '@digiworld/shared';
import type { RosterView } from '../lib/api';
import { primaryTileset } from '../lib/tileset-sprite';

export const DUNGEON_SCENE_KEY = 'DungeonPhaserScene';
export const DUNGEON_CAMERA_ZOOM = 2;
const TILE_SIZE_FALLBACK = 32;
const BACKGROUND_COLOR = '#1c1f2a';

export type Facing = 'left' | 'right';

export type DungeonPhaserDebugState = {
  readonly sprites: readonly { readonly catalogId: string; readonly flipX: boolean; readonly x: number; readonly y: number }[];
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly follow: { readonly x: number; readonly y: number };
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
    if (this.latestProps !== null) this.recompose();
  }

  shutdown(): void {
    if (window.__dungeonPhaser?.scene === this) {
      delete window.__dungeonPhaser;
    }
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
    camera.setBounds(0, 0, layout.width, layout.height);
  }
}
