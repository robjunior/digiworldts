import Phaser from 'phaser';

import type { DungeonGridNeighbor, DungeonRunView, DungeonTile, TilesetGrant } from '@digiworld/shared';
import { findTilesetForGid } from '@digiworld/shared';
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
  readonly tileSize: number;
  /** Count of cells painted with the flat walkable fallback color. */
  readonly flatCells: number;
  /** True when the view mixes tilesets of differing native tile sizes. */
  readonly mixedSizes: boolean;
  /** Number of maps rendered (active + neighbors). */
  readonly mapCount: number;
  /** True once the world has been composed at least once. */
  readonly rendered: boolean;
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
  private tileSize = TILE_SIZE_FALLBACK;
  private partyGroup: Phaser.GameObjects.Group | null = null;
  private leaderSprite: Phaser.GameObjects.Sprite | null = null;
  private lastLeaderCatalogId: string | null = null;
  private dotsLoading = false;

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
    if (this.leaderSprite !== null) this.tweens.killTweensOf(this.leaderSprite);
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
  ): void {
    this.latestProps = { view, neighbors, party, facing, moveDurationMs, partyTrail };
    if (this.booted) this.recompose();
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
      tileSize: this.tileSize,
      flatCells: this.flatCells,
      mixedSizes: this.mixedSizes,
      mapCount: this.mapCount,
      rendered: this.rendered,
    };
  }

  private kindDepth(kind: string): number {
    if (kind === 'liquid') return UNDERLAY_DEPTH;
    return BG_KIND_ORDER[kind] ?? 99;
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
    const grants = uniqueGrants([props.view, ...props.neighbors.map((neighbor) => neighbor.view)]);
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
    this.renderedLayers = [];
    this.renderedSprites = [];
    this.flatGraphics = [];
    this.layerInfos = [];
    this.flatCells = 0;
    this.mixedSizes = false;
    this.mapCount = 0;
    this.rendered = false;
    this.worldInfo = { width: 0, height: 0 };
    this.tileSize = TILE_SIZE_FALLBACK;
  }

  /** Compose every map slot (active + neighbors) at its pixel offset. */
  private renderWorld(props: SceneProps, layout: WorldLayout): void {
    this.tileSize = layout.tileSize;
    this.worldInfo = { width: layout.width, height: layout.height };
    for (const position of layout.positions) {
      const offsetX = (position.gridX - layout.minGridX) * layout.slotW;
      const offsetY = (position.gridY - layout.minGridY) * layout.slotH;
      this.renderMap(position.view, offsetX, offsetY);
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
  renderMap(view: DungeonRunView, offsetX = 0, offsetY = 0): void {
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
        sprite.setFlipX(flip.flipX);
        sprite.setFlipY(flip.flipY);
        sprite.setAngle(flip.rotation);
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
  }
}
