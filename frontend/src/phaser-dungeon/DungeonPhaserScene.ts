import Phaser from 'phaser';

import type { DungeonGridNeighbor, DungeonRunView, DungeonTile, TilesetGrant } from '@digiworld/shared';
import { findTilesetForGid, WALKABLE_LAYER_KINDS } from '@digiworld/shared';
import type { RosterView } from '../lib/api';
import { primaryTileset } from '../lib/tileset-sprite';
import {
  applyTiledFlips,
  bareGidForTile,
  digimonDotKey,
  preloadDigimonDot,
  preloadTilesets,
  registerTilesets,
  registerTilesetsOnTilemap,
  tileFrame,
  tilesetKey,
  tiledFlipBits,
} from './tilesets';

export const DUNGEON_SCENE_KEY = 'DungeonPhaserScene';
export const DUNGEON_CAMERA_ZOOM = 2;
const TILE_SIZE_FALLBACK = 32;
const BACKGROUND_COLOR = '#1c1f2a';
const UNDERLAY_DEPTH = -1;
const FLAT_CELL_DEPTH = -2;
// Party sprites sit above every tile layer (BG_KIND_ORDER maps to depths
// -1..9 plus 99 for unknown kinds) — 1000 keeps the party on top.
const PARTY_DEPTH = 1000;
const POI_DEPTH = 120;
const BOSS_DEPTH = 125;
const MARKER_DEPTH = 130;

/**
 * Background layer stacking, mirrored from DungeonGrid (frontend
 * `components/dungeon/DungeonGrid.tsx` BG_KIND_ORDER): tiles within one cell
 * paint lowest-depth-first, so `floor` sits under `grass` under `wall`s.
 * The `liquid` underlay paints beneath `floor` (depth -1). Unknown kinds
 * fall through to a high depth (99) so they always stack on top.
 */
const BG_KIND_ORDER: Record<string, number> = {
  floor: 0,
  grass: 1,
  doors: 2,
  hidden: 3,
  decoration: 4,
  tree: 5,
  wall: 6,
  walls: 7,
  water: 8,
  pit: 9,
};

export type Facing = 'left' | 'right';

/** One rendered tilemap layer, exposed for QA via `getState().layers`. */
export type DungeonLayerInfo = {
  readonly kind: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Number of tiles placed on the layer (non-empty cells). */
  readonly count: number;
};

export type DungeonPhaserDebugState = {
  readonly sprites: readonly { readonly catalogId: string; readonly flipX: boolean; readonly x: number; readonly y: number }[];
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly follow: { readonly x: number; readonly y: number };
  /** One entry per tilemap layer created across every rendered map slot. */
  readonly layers: readonly DungeonLayerInfo[];
  /** Composed world size in pixels (all map slots). */
  readonly world: { readonly width: number; readonly height: number };
  /** Slot dimensions in pixels: max map size × tile size (Todo 4, mirrors
   * ContinuousDungeonGrid's `slotWidth`/`slotHeight`). */
  readonly slotW: number;
  readonly slotH: number;
  readonly tileSize: number;
  /** Count of cells painted with the flat walkable fallback color. */
  readonly flatCells: number;
  /** True when the view mixes tilesets of differing native tile sizes. */
  readonly mixedSizes: boolean;
  /** Number of maps rendered (active + neighbors). */
  readonly mapCount: number;
  /** True once the world has been composed at least once. */
  readonly rendered: boolean;
  /** POI entries across every rendered slot (active + neighbors), for QA. */
  readonly pois: readonly DungeonPoiInfo[];
};

export type DungeonPoiInfo = {
  readonly kind: 'door' | 'chest' | 'trap' | 'trigger' | 'bridge' | 'boss' | 'item' | 'encounter';
  readonly x: number;
  readonly y: number;
  readonly gid: number | string | null;
  readonly slotGridX: number;
  readonly slotGridY: number;
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
  readonly onCellClick: (x: number, y: number) => void;
};

type PositionedView = {
  readonly view: DungeonRunView;
  readonly gridX: number;
  readonly gridY: number;
};

type WorldLayout = {
  readonly width: number;
  readonly height: number;
  readonly playerX: number;
  readonly playerY: number;
  readonly positions: readonly PositionedView[];
  readonly slotW: number;
  readonly slotH: number;
  readonly minGridX: number;
  readonly minGridY: number;
  readonly tileSize: number;
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
  return {
    width,
    height,
    playerX,
    playerY,
    positions,
    slotW: slotWidth,
    slotH: slotHeight,
    minGridX,
    minGridY,
    tileSize,
  };
}

function uniqueGrants(views: readonly DungeonRunView[]): readonly TilesetGrant[] {
  const byId = new Map<string, TilesetGrant>();
  for (const view of views) {
    for (const grant of view.tilesets) {
      if (!byId.has(grant.id)) byId.set(grant.id, grant);
    }
  }
  return [...byId.values()];
}

/**
 * Pure props renderer for the dungeon map tiles. All game rules stay in the
 * route + backend. Todo 3 replaces the Todo 2 one-tile scaffold with real
 * tilemap layers: tiles are grouped by `layerKind`, each group becomes a
 * `scene.make.tilemap` whose data array holds BARE GIDs (Tiled flip flags
 * stripped via `bareGidForTile`, empty cell = -1), registered on a layer at
 * (offsetX, offsetY) — pixel world offsets — via `registerTilesetsOnTilemap`
 * + `createLayer`, with Tiled flips re-applied per tile afterwards.
 */
export class DungeonPhaserScene extends Phaser.Scene {
  private latestProps: SceneProps | null = null;
  private followTarget: Phaser.GameObjects.Container | null = null;
  private booted = false;

  private renderedLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private renderedSprites: Phaser.GameObjects.Sprite[] = [];
  private flatGraphics: Phaser.GameObjects.Graphics[] = [];
  private layerInfos: DungeonLayerInfo[] = [];
  private flatCells = 0;
  private mixedSizes = false;
  private mapCount = 0;
  private rendered = false;
  private worldInfo: { readonly width: number; readonly height: number } = { width: 0, height: 0 };
  private slotInfo: { readonly w: number; readonly h: number } = { w: 0, h: 0 };
  private tileSize = TILE_SIZE_FALLBACK;
  private partyGroup: Phaser.GameObjects.Group | null = null;
  private leaderSprite: Phaser.GameObjects.Sprite | null = null;
  private lastLeaderCatalogId: string | null = null;
  private dotsLoading = false;
  private followTween: Phaser.Tweens.Tween | null = null;
  private lastFollowTarget: { readonly x: number; readonly y: number } | null = null;
  private clampBounds: { readonly width: number; readonly height: number } | null = null;
  private lastComposedNeighbors: readonly DungeonGridNeighbor[] | null = null;
  private poiInfos: DungeonPoiInfo[] = [];
  private renderedTexts: Phaser.GameObjects.Text[] = [];
  private activeSlotOrigin: { readonly x: number; readonly y: number } | null = null;

  constructor() {
    super({ key: DUNGEON_SCENE_KEY });
  }

  create(): void {
    this.booted = true;
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setZoom(DUNGEON_CAMERA_ZOOM);
    this.followTarget = this.add.container(0, 0);
    this.cameras.main.startFollow(this.followTarget, true, 1, 1);
    this.cameras.main.on(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, this.clampCameraScroll, this);
    this.input.on('pointerdown', this.handleCellPointer, this);
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
    if (this.leaderSprite !== null) this.tweens.killTweensOf(this.leaderSprite);
    if (this.followTween !== null) this.followTween.destroy();
    this.followTween = null;
    this.lastFollowTarget = null;
    this.clampBounds = null;
    this.cameras.main.off(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, this.clampCameraScroll, this);
    this.partyGroup?.destroy(true);
    this.partyGroup = null;
    this.leaderSprite = null;
    this.lastLeaderCatalogId = null;
    this.dotsLoading = false;
    this.clearRendered();
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
    onCellClick: (x: number, y: number) => void,
  ): void {
    const prev = this.latestProps;
    this.latestProps = { view, neighbors, party, facing, moveDurationMs, partyTrail, onCellClick };
    if (!this.booted) return;
    if (
      prev !== null &&
      prev.view === view &&
      prev.neighbors === neighbors &&
      prev.party === party &&
      prev.facing === facing &&
      prev.moveDurationMs === moveDurationMs &&
      prev.partyTrail === partyTrail
    ) {
      return;
    }
    this.recompose();
  }

  getState(): DungeonPhaserDebugState {
    const camera = this.cameras.main;
    const follow = this.followTarget;
    const sprites: { readonly catalogId: string; readonly flipX: boolean; readonly x: number; readonly y: number }[] = [];
    if (this.partyGroup !== null) {
      for (const child of this.partyGroup.getChildren()) {
        const sprite = child as Phaser.GameObjects.Sprite;
        sprites.push({
          catalogId: String(sprite.getData('catalogId') ?? ''),
          flipX: sprite.flipX,
          x: Math.round(sprite.x * 100) / 100,
          y: Math.round(sprite.y * 100) / 100,
        });
      }
    }
    return {
      sprites,
      camera: { x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom },
      follow: { x: follow?.x ?? 0, y: follow?.y ?? 0 },
      layers: this.layerInfos,
      world: this.worldInfo,
      slotW: this.slotInfo.w,
      slotH: this.slotInfo.h,
      tileSize: this.tileSize,
      flatCells: this.flatCells,
      mixedSizes: this.mixedSizes,
      mapCount: this.mapCount,
      rendered: this.rendered,
      pois: this.poiInfos,
    };
  }

  private kindDepth(kind: string): number {
    if (kind === 'liquid') return UNDERLAY_DEPTH;
    return BG_KIND_ORDER[kind] ?? 99;
  }

  private recompose(): void {
    const props = this.latestProps;
    if (props === null || this.followTarget === null) return;
    // Crossing continuity: when the run crosses into a neighbor, the route
    // navigates (replace:true) and the neighbors query refetches for the new
    // dungeon id — for a few renders the wrapper passes `neighbors: []`. That
    // empty list must NOT collapse the composed world to a single map mid-
    // crossing (a rebuild would snap the camera). Until the fresh neighbors
    // land, reuse the last composed neighbor list (the two slots are the same
    // two maps, just with the active swapped).
    let neighbors = props.neighbors;
    if (neighbors.length === 0 && this.lastComposedNeighbors !== null && this.lastComposedNeighbors.length > 0) {
      neighbors = this.lastComposedNeighbors;
    }
    const layout = computeLayout(props.view, neighbors);
    this.lastComposedNeighbors = neighbors;
    this.clampBounds = { width: layout.width, height: layout.height };
    // startFollow (lerp 1) tracks this target every frame, so moving it in
    // place keeps camera continuity across grid-crossing re-compositions.
    // A position change (a walk or a grid cross) glides the target to the new
    // cell over moveDurationMs instead of teleporting it — the camera follows
    // the glide, so crossing the seam stays continuous (the DOM animates the
    // canvas transform the same way via its 180ms CSS transition).
    const lastFollow = this.lastFollowTarget;
    if (lastFollow === null || lastFollow.x !== layout.playerX || lastFollow.y !== layout.playerY) {
      this.moveFollowTarget(layout.playerX, layout.playerY, props.moveDurationMs);
    }
    // The camera is NOT bounded via Phaser's setBounds: clampX/clampY mix the
    // camera's pixel width with displayWidth (width/zoom) and pin a world
    // narrower than the viewport to the corner. Instead clamp each axis
    // independently, exactly like ContinuousDungeonGrid: an axis that fits the
    // viewport stays free (the follow target keeps the player screen-centered,
    // the small-map centering branch); an overflowing axis clamps so no void
    // shows past the composed world's edge.
    const grants = uniqueGrants([props.view, ...neighbors.map((neighbor) => neighbor.view)]);
    const missing = grants.filter((grant) => !this.textures.exists(tilesetKey(grant)));
    if (missing.length > 0) {
      // Textures land async — queue the load, register frames on complete,
      // then recompose again (which renders once every grant has a texture).
      this.ensureTilesetsLoaded(grants);
    } else {
      this.clearRendered();
      this.renderWorld(props, layout);
    }
    // Party dots load independently of tilesets — render regardless (a
    // fallback dungeon with no tilesets must still show the party).
    this.renderParty(props, layout);
  }

  private moveFollowTarget(x: number, y: number, durationMs: number): void {
    const target = this.followTarget;
    if (target === null) return;
    const last = this.lastFollowTarget;
    if (last === null) {
      target.setPosition(x, y);
      this.lastFollowTarget = { x, y };
      return;
    }
    if (last.x === x && last.y === y) {
      if (this.followTween !== null && this.followTween.isPlaying()) return;
      target.setPosition(x, y);
      return;
    }
    if (this.followTween !== null) this.followTween.destroy();
    this.followTween = this.tweens.add({
      targets: target,
      x,
      y,
      duration: Math.max(1, durationMs),
      ease: 'Linear',
    });
    this.lastFollowTarget = { x, y };
  }

  private clampCameraScroll(): void {
    const camera = this.cameras.main;
    const bounds = this.clampBounds;
    if (bounds === null) return;
    // camera.scrollX is in SCREEN pixels ("not impacted by zooming" — Phaser).
    // Clamping to [0, bounds - displayW] would be off by that offset; the
    // zoom-aware window below mirrors Phaser's own clampX/clampY (BaseCamera).
    const displayW = camera.width / camera.zoom;
    const displayH = camera.height / camera.zoom;
    // Bug 2 focus: the camera frames the ACTIVE map slot — the visible window
    // is the active slot expanded by half a viewport on each side, intersected
    // with the composed world. Neighbors peek in only near the seam; the rest
    // of the grid stays off-screen. An axis whose window fits the viewport
    // stays free (the follow target keeps the player screen-centered). Falls
    // back to the composed-world clamp before the active slot is known.
    const origin = this.activeSlotOrigin;
    if (origin !== null && this.slotInfo.w > 0 && this.slotInfo.h > 0) {
      const winLeft = Math.max(0, origin.x - displayW / 2);
      const winRight = Math.min(bounds.width, origin.x + this.slotInfo.w + displayW / 2);
      const winTop = Math.max(0, origin.y - displayH / 2);
      const winBottom = Math.min(bounds.height, origin.y + this.slotInfo.h + displayH / 2);
      const winW = winRight - winLeft;
      const winH = winBottom - winTop;
      if (winW > displayW) {
        const minX = (displayW - camera.width) / 2;
        camera.scrollX = Phaser.Math.Clamp(camera.scrollX, minX + winLeft, minX + winLeft + winW - displayW);
      }
      if (winH > displayH) {
        const minY = (displayH - camera.height) / 2;
        camera.scrollY = Phaser.Math.Clamp(camera.scrollY, minY + winTop, minY + winTop + winH - displayH);
      }
      return;
    }
    if (bounds.width > displayW) {
      const minX = (displayW - camera.width) / 2;
      camera.scrollX = Phaser.Math.Clamp(camera.scrollX, minX, minX + bounds.width - displayW);
    }
    if (bounds.height > displayH) {
      const minY = (displayH - camera.height) / 2;
      camera.scrollY = Phaser.Math.Clamp(camera.scrollY, minY, minY + bounds.height - displayH);
    }
  }

  /**
   * Idempotent party rebuild from the latest props. Every recompose clears the
   * party group and redraws it — setProps can never accumulate sprites. The
   * leader's current position is captured before the clear so the walk tween
   * starts where the sprite actually is (the route fires two setProps per move:
   * data+facing land one render, partyTrail catches up the next; the second
   * restart must not snap the leader).
   *
   * Members: the leader (party[0]) at the run's cell, followers at
   * partyTrail[i] for i >= 1 (trail[i] maps to party[i]). partyTrail[0] is the
   * leader's own cell and is NEVER rendered as a marker — exactly the DOM
   * double-leader fix. Trail cells are already in the active map's coordinates,
   * so the party never appears in neighbor slots.
   */
  private renderParty(props: SceneProps, layout: WorldLayout): void {
    const tileSize = layout.tileSize;
    const gridX = props.view.dungeon.gridX ?? 0;
    const gridY = props.view.dungeon.gridY ?? 0;
    const slotOffsetX = (gridX - layout.minGridX) * layout.slotW;
    const slotOffsetY = (gridY - layout.minGridY) * layout.slotH;
    const leader = props.party[0];
    const members: { readonly catalogId: string; readonly isLeader: boolean; readonly x: number; readonly y: number }[] = [];
    if (leader !== undefined) {
      members.push({
        catalogId: leader.catalogId,
        isLeader: true,
        x: slotOffsetX + props.view.run.currentX * tileSize + tileSize / 2,
        y: slotOffsetY + props.view.run.currentY * tileSize + tileSize / 2,
      });
    }
    for (let i = 1; i < props.party.length; i += 1) {
      const trailCell = props.partyTrail[i];
      const member = props.party[i];
      if (trailCell === undefined || member === undefined) continue;
      members.push({
        catalogId: member.catalogId,
        isLeader: false,
        x: slotOffsetX + trailCell.x * tileSize + tileSize / 2,
        y: slotOffsetY + trailCell.y * tileSize + tileSize / 2,
      });
    }

    const neededDots = [...new Set(members.map((member) => member.catalogId))];
    if (!this.ensureDigimonDotsLoaded(neededDots)) return;

    const previousLeader = this.leaderSprite;
    const previousLeaderPos =
      previousLeader !== null ? { x: previousLeader.x, y: previousLeader.y } : null;
    if (previousLeader !== null) this.tweens.killTweensOf(previousLeader);
    this.partyGroup?.destroy(true);
    this.partyGroup = null;
    this.leaderSprite = null;

    if (members.length === 0) return;

    const flipX = props.facing === 'left';
    const group = this.add.group();
    this.partyGroup = group;

    const leaderMember = members.find((member) => member.isLeader);
    const leaderMoved =
      previousLeaderPos !== null &&
      leaderMember !== undefined &&
      leaderMember.catalogId === this.lastLeaderCatalogId &&
      (previousLeaderPos.x !== leaderMember.x || previousLeaderPos.y !== leaderMember.y);

    for (const member of members) {
      const sprite = this.add.sprite(member.x, member.y, digimonDotKey(member.catalogId));
      sprite.setOrigin(0.5, 0.5);
      sprite.setDisplaySize(tileSize, tileSize);
      sprite.setFlipX(flipX);
      sprite.setDepth(PARTY_DEPTH);
      sprite.setData('catalogId', member.catalogId);
      group.add(sprite);
      if (member.isLeader) {
        this.leaderSprite = sprite;
        if (leaderMoved) {
          sprite.setPosition(previousLeaderPos.x, previousLeaderPos.y);
          this.tweens.add({
            targets: sprite,
            x: member.x,
            y: member.y,
            duration: props.moveDurationMs,
            ease: 'Linear',
          });
        }
      }
    }
    this.lastLeaderCatalogId = leader?.catalogId ?? null;
  }

  /**
   * Ensure every party dot texture is loaded, returning true only when all
   * exist. Loads piggyback on any in-flight tileset load (Phaser `start()` is
   * a no-op while loading) and re-render on COMPLETE. The idle-with-empty-list
   * guard prevents a failed load from spinning: start() on an empty queue
   * emits COMPLETE synchronously, which would otherwise recompose forever.
   */
  private ensureDigimonDotsLoaded(catalogIds: readonly string[]): boolean {
    const missing = catalogIds.filter((catalogId) => !this.textures.exists(digimonDotKey(catalogId)));
    if (missing.length === 0) return true;
    if (this.dotsLoading) return false;
    const loader = this.load;
    if (loader.isLoading()) {
      this.dotsLoading = true;
      for (const catalogId of missing) preloadDigimonDot(this, catalogId);
      loader.once(Phaser.Loader.Events.COMPLETE, () => {
        this.dotsLoading = false;
        this.recompose();
      });
      return false;
    }
    const listSizeBefore = loader.list.size;
    for (const catalogId of missing) preloadDigimonDot(this, catalogId);
    if (loader.list.size === listSizeBefore) return false;
    this.dotsLoading = true;
    loader.once(Phaser.Loader.Events.COMPLETE, () => {
      this.dotsLoading = false;
      this.recompose();
    });
    loader.start();
    return false;
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

  /** Destroy every display object created by the previous composition. */
  private clearRendered(): void {
    for (const layer of this.renderedLayers) layer.destroy();
    for (const sprite of this.renderedSprites) sprite.destroy();
    for (const gfx of this.flatGraphics) gfx.destroy();
    for (const text of this.renderedTexts) text.destroy();
    this.renderedLayers = [];
    this.renderedSprites = [];
    this.flatGraphics = [];
    this.renderedTexts = [];
    this.poiInfos = [];
    this.layerInfos = [];
    this.flatCells = 0;
    this.mixedSizes = false;
    this.mapCount = 0;
    this.rendered = false;
    this.worldInfo = { width: 0, height: 0 };
    this.slotInfo = { w: 0, h: 0 };
    this.tileSize = TILE_SIZE_FALLBACK;
  }

  /** Compose every map slot (active + neighbors) at its pixel offset. */
  private renderWorld(props: SceneProps, layout: WorldLayout): void {
    this.tileSize = layout.tileSize;
    this.worldInfo = { width: layout.width, height: layout.height };
    this.slotInfo = { w: layout.slotW, h: layout.slotH };
    const activeGridX = props.view.dungeon.gridX ?? 0;
    const activeGridY = props.view.dungeon.gridY ?? 0;
    this.activeSlotOrigin = {
      x: (activeGridX - layout.minGridX) * layout.slotW,
      y: (activeGridY - layout.minGridY) * layout.slotH,
    };
    const bossDots = [
      ...new Set(
        [props.view, ...props.neighbors.map((neighbor) => neighbor.view)].flatMap((view) =>
          view.encounters
            .filter((encounter) => encounter.difficulty === 'boss' && !view.run.defeatedEncounters.includes(encounter.id))
            .flatMap((encounter) => encounter.digimon.map((digimon) => digimon.catalogId)),
        ),
      ),
    ];
    if (bossDots.length > 0) this.ensureDigimonDotsLoaded(bossDots);
    const camera = this.cameras.main;
    const displayW = camera.width / camera.zoom;
    const displayH = camera.height / camera.zoom;
    // Viewport culling (bug 2): render only the slots that intersect the
    // region the camera can show around the follow target — the visible
    // viewport plus a generous margin (1.5× viewport + one full slot) so a
    // follow glide toward a seam never pops a neighbor in/out mid-tween.
    const cullHalfW = displayW * 1.5 + layout.slotW;
    const cullHalfH = displayH * 1.5 + layout.slotH;
    const cullLeft = layout.playerX - cullHalfW;
    const cullRight = layout.playerX + cullHalfW;
    const cullTop = layout.playerY - cullHalfH;
    const cullBottom = layout.playerY + cullHalfH;
    for (const position of layout.positions) {
      const offsetX = (position.gridX - layout.minGridX) * layout.slotW;
      const offsetY = (position.gridY - layout.minGridY) * layout.slotH;
      if (offsetX + layout.slotW < cullLeft || offsetX > cullRight || offsetY + layout.slotH < cullTop || offsetY > cullBottom) continue;
      this.renderMap(position.view, offsetX, offsetY, position.gridX, position.gridY);
      this.mapCount++;
    }
    this.rendered = true;
  }

  /**
   * Render ONE dungeon map onto tilemap layers. `offsetX`/`offsetY` are the
   * slot's world pixel origin (0,0 for the active map; Todo 4 lays out
   * neighbor slots via `(gridX - minGridX) * slotW`).
   *
   * Tiles are grouped by `layerKind`; each group becomes a tilemap whose data
   * holds BARE GIDs (`bareGidForTile`), empty cells = -1, positioned via
   * `map.createLayer(0, map.tilesets, offsetX, offsetY)`. Tiled flip flags are
   * re-applied per tile from the raw GIDs kept alongside the bare data.
   *
   * Edge cases mandated by the plan:
   *   - cells whose tile GID has NO owning tileset → flat walkable `#1c1f2a`
   *     (CSS vars are unavailable to canvas) painted below every layer;
   *   - mixed native tile sizes across grants → the non-primary tileset's
   *     tiles render as `tileFrame` sprites over the tilemap (Phaser tilemap
   *     layers cannot scale per-tileset, so only the primary tileset is
   *     registered on the layer);
   *   - liquid underlay layer renders at depth -1 (beneath floor at 0).
   *
   * No collision/physics — `setCollision` is never called.
   */
  renderMap(view: DungeonRunView, offsetX = 0, offsetY = 0, slotGridX = 0, slotGridY = 0): void {
    const grants = view.tilesets;
    const primary = primaryTileset(grants);
    const tileSize = primary?.tileWidth ?? TILE_SIZE_FALLBACK;
    const mixed = primary !== null && grants.some((grant) => grant.tileWidth !== primary.tileWidth || grant.tileHeight !== primary.tileHeight);
    this.mixedSizes = this.mixedSizes || mixed;
    const width = view.dungeon.width;
    const height = view.dungeon.height;

    const buckets = new Map<string, DungeonTile[]>();
    for (const tile of view.tiles) {
      const list = buckets.get(tile.layerKind);
      if (list) list.push(tile);
      else buckets.set(tile.layerKind, [tile]);
    }
    const bucketEntries = [...buckets.entries()].sort((a, b) => this.kindDepth(a[0]) - this.kindDepth(b[0]));
    const flatCells = new Set<string>();

    for (const [kind, tiles] of bucketEntries) {
      const depth = this.kindDepth(kind);
      const data: number[][] = [];
      for (let y = 0; y < height; y++) data.push(new Array<number>(width).fill(-1));
      const rawByCell = new Map<string, number>();
      const spriteCells: { readonly x: number; readonly y: number; readonly rawGid: number }[] = [];
      let placed = 0;

      for (const tile of tiles) {
        const owner = findTilesetForGid(tile.gid, grants);
        if (owner === null) {
          flatCells.add(`${tile.x},${tile.y}`);
          continue;
        }
        if (mixed && owner !== primary) {
          spriteCells.push({ x: tile.x, y: tile.y, rawGid: tile.gid });
          continue;
        }
        const row = data[tile.y];
        if (!row || tile.x < 0 || tile.x >= width || tile.y < 0 || tile.y >= height) continue;
        row[tile.x] = bareGidForTile(tile.gid);
        rawByCell.set(`${tile.x},${tile.y}`, tile.gid);
        placed++;
      }

      if (placed > 0) {
        const map = this.make.tilemap({ data, tileWidth: tileSize, tileHeight: tileSize });
        registerTilesetsOnTilemap(map, mixed && primary !== null ? [primary] : grants);
        const layer = map.createLayer(0, map.tilesets, offsetX, offsetY);
        if (layer !== null) {
          layer.setDepth(depth);
          // Re-apply the Tiled flip flags from the raw GIDs (never put flagged
          // gids in the data array — Phaser resolves bare gids through the
          // tileset firstgid spaces).
          for (const [key, rawGid] of rawByCell) {
            const coords = key.split(',').map(Number);
            const tile = layer.getTileAt(coords[0]!, coords[1]!);
            if (tile !== null) applyTiledFlips(tile, rawGid);
          }
          this.renderedLayers.push(layer);
          this.layerInfos.push({ kind, depth, x: offsetX, y: offsetY, width, height, count: placed });
        }
      }

      for (const cell of spriteCells) {
        const owner = findTilesetForGid(cell.rawGid, grants);
        const frame = owner !== null ? tileFrame(owner, cell.rawGid) : null;
        if (frame === null || !this.textures.exists(frame.texture)) continue;
        const sprite = this.add.sprite(
          offsetX + cell.x * tileSize + tileSize / 2,
          offsetY + cell.y * tileSize + tileSize / 2,
          frame.texture,
          frame.frame,
        );
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        const flip = tiledFlipBits(cell.rawGid);
        sprite.setFlipX(flip.flipped);
        sprite.setFlipY(false);
        sprite.setAngle(flip.rotation * 180 / Math.PI);
        sprite.setDepth(depth);
        this.renderedSprites.push(sprite);
      }
    }

    if (flatCells.size > 0) {
      const gfx = this.add.graphics();
      gfx.fillStyle(Phaser.Display.Color.HexStringToColor(BACKGROUND_COLOR).color, 1);
      for (const key of flatCells) {
        const coords = key.split(',').map(Number);
        gfx.fillRect(offsetX + coords[0]! * tileSize, offsetY + coords[1]! * tileSize, tileSize, tileSize);
      }
      gfx.setDepth(FLAT_CELL_DEPTH);
      this.flatGraphics.push(gfx);
      this.flatCells += flatCells.size;
    }

    if (primary !== null) {
    const run = view.run;
    const firedSet = new Set(view.firedTriggerIds);
    const doorOpenIds = new Set<string>();
    for (const trigger of view.triggers) {
      if (!firedSet.has(trigger.id)) continue;
      for (const target of trigger.targets) {
        if (target.kind === 'door' && target.doorId !== null) doorOpenIds.add(target.doorId);
      }
    }
    const bridgeDownKeys = new Set<string>();
    for (const bridge of view.bridges) {
      const lowered = view.triggers.some((trigger) =>
        firedSet.has(trigger.id) && trigger.targets.some((target) => target.kind === 'bridge' && target.bridgeId === bridge.id),
      );
      if (lowered) bridgeDownKeys.add(`${bridge.x},${bridge.y}`);
    }
    const poiStateByKey = new Map(view.poiStates.map((s) => [`${s.poiKind}:${s.poiId}`, s.state] as const));

    const poiCell = (x: number, y: number): number => offsetX + x * tileSize + tileSize / 2;
    const poiRow = (x: number, y: number): number => offsetY + y * tileSize + tileSize / 2;

    for (const door of view.doors) {
      const doorOpen = run.unlockedDoors.includes(door.id) || doorOpenIds.has(door.id);
      const gid = doorOpen ? door.usedTileGid : door.unusedTileGid;
      if (gid === null) continue;
      const frame = tileFrame(primary, gid);
      if (frame !== null && this.textures.exists(frame.texture)) {
        const sprite = this.add.sprite(poiCell(door.x, door.y), poiRow(door.x, door.y), frame.texture, frame.frame);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        sprite.setDepth(POI_DEPTH);
        sprite.setData('poiKind', 'door');
        sprite.setData('poiId', door.id);
        this.renderedSprites.push(sprite);
      }
      this.poiInfos.push({ kind: 'door', x: door.x, y: door.y, gid, slotGridX, slotGridY });
      this.addPoiBadge(poiCell(door.x, door.y), poiRow(door.x, door.y), 'D');
    }

    for (const chest of view.chests) {
      const chestState = poiStateByKey.get(`chest:${chest.id}`) ?? 'unused';
      const gid = chestState === 'used' ? chest.usedTileGid : chest.unusedTileGid;
      if (gid === null) continue;
      const frame = tileFrame(primary, gid);
      if (frame !== null && this.textures.exists(frame.texture)) {
        const sprite = this.add.sprite(poiCell(chest.x, chest.y), poiRow(chest.x, chest.y), frame.texture, frame.frame);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        sprite.setDepth(POI_DEPTH);
        sprite.setData('poiKind', 'chest');
        sprite.setData('poiId', chest.id);
        this.renderedSprites.push(sprite);
      }
      this.poiInfos.push({ kind: 'chest', x: chest.x, y: chest.y, gid, slotGridX, slotGridY });
      this.addPoiBadge(poiCell(chest.x, chest.y), poiRow(chest.x, chest.y), 'C');
    }

    for (const trap of view.traps) {
      const trapState = poiStateByKey.get(`trap:${trap.id}`) ?? 'unused';
      if (trapState !== 'used') continue;
      const gid = trap.usedTileGid;
      if (gid === null) continue;
      const frame = tileFrame(primary, gid);
      if (frame !== null && this.textures.exists(frame.texture)) {
        const sprite = this.add.sprite(poiCell(trap.x, trap.y), poiRow(trap.x, trap.y), frame.texture, frame.frame);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        sprite.setDepth(POI_DEPTH);
        sprite.setData('poiKind', 'trap');
        sprite.setData('poiId', trap.id);
        this.renderedSprites.push(sprite);
      }
      this.poiInfos.push({ kind: 'trap', x: trap.x, y: trap.y, gid, slotGridX, slotGridY });
      this.addPoiBadge(poiCell(trap.x, trap.y), poiRow(trap.x, trap.y), 'T');
    }

    for (const trigger of view.triggers) {
      if (!trigger.enabled) continue;
      const triggerUsed = firedSet.has(trigger.id);
      const gid = triggerUsed ? trigger.usedTileGid : trigger.unusedTileGid;
      if (gid === null) continue;
      const frame = tileFrame(primary, gid);
      if (frame !== null && this.textures.exists(frame.texture)) {
        const sprite = this.add.sprite(poiCell(trigger.x, trigger.y), poiRow(trigger.x, trigger.y), frame.texture, frame.frame);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        sprite.setDepth(POI_DEPTH);
        sprite.setData('poiKind', 'trigger');
        sprite.setData('poiId', trigger.id);
        this.renderedSprites.push(sprite);
      }
      this.poiInfos.push({ kind: 'trigger', x: trigger.x, y: trigger.y, gid, slotGridX, slotGridY });
      this.addPoiBadge(poiCell(trigger.x, trigger.y), poiRow(trigger.x, trigger.y), 'L');
    }

    for (const bridge of view.bridges) {
      if (!bridge.enabled) continue;
      const bridgeDown = bridgeDownKeys.has(`${bridge.x},${bridge.y}`);
      const gid = bridgeDown ? bridge.downTileGid : bridge.upTileGid;
      if (gid === null) continue;
      const frame = tileFrame(primary, gid);
      if (frame !== null && this.textures.exists(frame.texture)) {
        const sprite = this.add.sprite(poiCell(bridge.x, bridge.y), poiRow(bridge.x, bridge.y), frame.texture, frame.frame);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(tileSize, tileSize);
        sprite.setDepth(POI_DEPTH);
        sprite.setData('poiKind', 'bridge');
        sprite.setData('poiId', bridge.id);
        this.renderedSprites.push(sprite);
      }
      this.poiInfos.push({ kind: 'bridge', x: bridge.x, y: bridge.y, gid, slotGridX, slotGridY });
    }

    for (const encounter of view.encounters) {
      if (run.defeatedEncounters.includes(encounter.id)) continue;
      if (encounter.difficulty === 'boss') {
        const leader = encounter.digimon[0];
        if (leader === undefined) continue;
        const dotKey = digimonDotKey(leader.catalogId);
        const bossWorldX = poiCell(encounter.x, encounter.y);
        const bossWorldY = poiRow(encounter.x, encounter.y);
        if (this.textures.exists(dotKey)) {
          const sprite = this.add.sprite(bossWorldX, bossWorldY, dotKey);
          sprite.setOrigin(0.5, 0.5);
          sprite.setDisplaySize(tileSize, tileSize);
          sprite.setDepth(BOSS_DEPTH);
          sprite.setFlipX(run.currentX < encounter.x);
          sprite.setData('poiKind', 'boss');
          sprite.setData('bossCatalogId', leader.catalogId);
          this.renderedSprites.push(sprite);
        }
        this.poiInfos.push({ kind: 'boss', x: encounter.x, y: encounter.y, gid: leader.catalogId, slotGridX, slotGridY });
      } else {
        this.poiInfos.push({ kind: 'encounter', x: encounter.x, y: encounter.y, gid: null, slotGridX, slotGridY });
        this.addPoiBadge(poiCell(encounter.x, encounter.y), poiRow(encounter.x, encounter.y), 'E');
      }
    }

    for (const item of view.items) {
      if (run.collectedItems.includes(item.id)) continue;
      this.poiInfos.push({ kind: 'item', x: item.x, y: item.y, gid: null, slotGridX, slotGridY });
      this.addPoiBadge(poiCell(item.x, item.y), poiRow(item.x, item.y), 'I');
    }
    }
  }

  private addPoiBadge(x: number, y: number, letter: string): void {
    const text = this.add.text(x, y, letter, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: 'rgba(28,31,42,0.8)',
      padding: { x: 2, y: 1 },
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(MARKER_DEPTH);
    text.setData('poiBadge', letter);
    this.renderedTexts.push(text);
  }

  private handleCellPointer(pointer: Phaser.Input.Pointer): void {
    const props = this.latestProps;
    const origin = this.activeSlotOrigin;
    if (props === null || origin === null || !this.rendered) return;
    const view = props.view;
    const tileSize = this.tileSize;
    const x = Math.floor((pointer.worldX - origin.x) / tileSize);
    const y = Math.floor((pointer.worldY - origin.y) / tileSize);
    if (x < 0 || y < 0 || x >= view.dungeon.width || y >= view.dungeon.height) return;
    const run = view.run;
    if (run.currentX === x && run.currentY === y) return;
    if (Math.abs(x - run.currentX) + Math.abs(y - run.currentY) !== 1) return;
    const cellTiles = view.tiles.filter((tile) => tile.x === x && tile.y === y);
    const hasWalkable = cellTiles.some((tile) => (WALKABLE_LAYER_KINDS as readonly string[]).includes(tile.layerKind));
    const hasObstacle = cellTiles.some((tile) => !(WALKABLE_LAYER_KINDS as readonly string[]).includes(tile.layerKind));
    const bridgeDown = view.bridges.some(
      (bridge) =>
        bridge.enabled &&
        bridge.x === x &&
        bridge.y === y &&
        view.firedTriggerIds.some((tid) =>
          view.triggers.some((trigger) => trigger.id === tid && trigger.targets.some((target) => target.kind === 'bridge' && target.bridgeId === bridge.id)),
        ),
    );
    if (!((hasWalkable && !hasObstacle) || bridgeDown)) return;
    props.onCellClick(x, y);
  }
}
