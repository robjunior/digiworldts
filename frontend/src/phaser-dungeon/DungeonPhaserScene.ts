import Phaser from "phaser";

import type {
  DungeonGridNeighbor,
  DungeonRemotePlayer,
  DungeonRunView,
  DungeonTile,
  LayerKind,
  TilesetGrant,
} from "@digiworld/shared";
import {
  findTilesetForGid,
  LAYER_DEPTH,
  layerDepth,
  WALKABLE_LAYER_KINDS,
  WATER_ALPHA,
} from "@digiworld/shared";
import type { RosterView } from "../lib/api";
import { primaryTileset } from "../lib/tileset-sprite";
import {
  applyTiledFlips,
  bareGidForTile,
  buildDigimonSheet,
  buildDotTexture,
  digimonDotKey,
  digimonSheetKey,
  dotAnimKey,
  ensureDigimonSpriteLoaded,
  fallbackStaticDot,
  isTextureAbandoned,
  markTextureLoadFailed,
  MAX_TEXTURE_RETRIES,
  preloadDigimonDot,
  preloadTilesets,
  preloadDigimonSheet,
  registerTilesets,
  registerTilesetsOnTilemap,
  sheetHitAnimKey,
  sheetWalkAnimKey,
  sheetTakeHitAnimKey,
  sheetAttackAnimKey,
  tileFrame,
  tilesetKey,
  tiledFlipBits,
} from "./tilesets";
import {
  ANIMATION_HOLD_MS,
  catalogIdFromSpriteName,
  computeBridgeDownKeys,
  computeDoorOpenIds,
  getSpriteData,
  MIN_TWEEN_MS,
  POI_BADGE_LETTER,
  FALLBACK_MARKER_COLOR,
  PoiRenderContext,
  digimonSpriteName,
} from "./poi-state";

export const DUNGEON_SCENE_KEY = "DungeonPhaserScene";
export const DUNGEON_CAMERA_ZOOM = 2;
const TILE_SIZE_FALLBACK = 32;
const BACKGROUND_COLOR = "#1c1f2a";
const UNDERLAY_DEPTH = -1;
const FLAT_CELL_DEPTH = -2;
// Flat (tileset-less) cells paint a dark-neutral distinct from the camera
// background (#1c1f2a) with a 1px gridline so adjacent cells stay
// distinguishable — a tileset-less dungeon is visible and playable, not a
// void-colored maze. Same muted PSX palette family as BACKGROUND_COLOR.
const FLAT_CELL_FILL = "#232733";
const FLAT_CELL_GRIDLINE = "#1a1e28";
// Party sprites sit above every tile layer (BG_KIND_ORDER maps to depths
// -1..9 plus 99 for unknown kinds) — 1000 keeps the party on top.
const PARTY_DEPTH = 1000;
const POI_DEPTH = 120;
const BOSS_DEPTH = 125;
const MARKER_DEPTH = 130;

/**
 * Background layer stacking. Tiles within one cell paint lowest-depth-first,
 * so `floor` sits under `grass` under `wall`s. `water` and `liquid` are the
 * topmost terrain kinds: they render ABOVE floor/grass/walls (so the water is
 * actually visible) but still BELOW the party sprites (PARTY_DEPTH 1000) and
 * BELOW the POI overlays (bridges/triggers at POI_DEPTH+). They are drawn at
 * < 1 alpha (WATER_ALPHA) so the terrain bed shows through — the "transparent
 * tileset" look. `liquid` sits just above `water` so e.g. lava/water-under-
 * bridge composites correctly. Unknown kinds fall through to a high depth (99)
 * so they always stack on top of the known terrain kinds.
 *
 * The authoritative depth values live in `@digiworld/shared` (`LAYER_DEPTH`,
 * `layerDepth`, `WATER_ALPHA`) — kept in one place so the renderer, the admin
 * preview, and any tests can't drift apart (this is what regressed `liquid`
 * into an invisible underlay before).
 */
const BG_KIND_ORDER = LAYER_DEPTH;

export type Facing = "left" | "right";

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
  readonly sprites: readonly {
    readonly catalogId: string;
    readonly flipX: boolean;
    readonly x: number;
    readonly y: number;
  }[];
  readonly camera: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
  };
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
  readonly kind:
    | "door"
    | "chest"
    | "trap"
    | "trigger"
    | "bridge"
    | "boss"
    | "item"
    | "encounter"
    | "warp";
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
      triggerBossHit(catalogId: string): void;
      toggleHud(): void;
    };
  }
}

type SceneProps = {
  readonly view: DungeonRunView;
  readonly neighbors: readonly DungeonGridNeighbor[];
  readonly remotePlayers: readonly DungeonRemotePlayer[];
  readonly party: readonly RosterView[];
  readonly facing: Facing;
  readonly moveDurationMs: number;
  readonly partyTrail: readonly { readonly x: number; readonly y: number }[];
  readonly onCellClick: (x: number, y: number) => void;
  /** Phase 2 player interaction: fired when a remote player's cell is
   * clicked (any visible distance). Wins over movement when the cell is
   * also adjacent — the route opens the context menu instead of stepping. */
  readonly onPlayerClick?: (
    userId: string,
    displayName: string,
    x: number,
    y: number,
  ) => void;
  readonly onTextureFallback: (failed: readonly TilesetGrant[]) => void;
};

type RemotePlayerRender = {
  /** Leader digimon sprite (or placeholder circle) at WORLD coordinates. */
  leader: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc;
  /** Name tag, at WORLD coordinates, follows the leader's cell. */
  nameText: Phaser.GameObjects.Text;
  cell: { x: number; y: number; gridX: number; gridY: number };
  catalogId: string | null;
  followers: {
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc;
    cell: { x: number; y: number };
  }[];
};

type PositionedView = {
  readonly view: DungeonRunView;
  readonly gridX: number;
  readonly gridY: number;
};

type WorldLayout = {
  readonly width: number;
  readonly height: number;
  /** World-space origin of the slot grid (minGridX * slotW). Kept stable
   * across re-compositions so a grid crossing never re-anchors the world. */
  readonly originX: number;
  readonly originY: number;
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
function computeLayout(
  view: DungeonRunView,
  neighbors: readonly DungeonGridNeighbor[],
  abandonedIds?: ReadonlySet<string>,
): WorldLayout {
  const active: PositionedView = {
    view,
    gridX: view.dungeon.gridX ?? 0,
    gridY: view.dungeon.gridY ?? 0,
  };
  const positions: readonly PositionedView[] = [
    active,
    ...neighbors.map((neighbor) => ({
      view: neighbor.view,
      gridX: neighbor.gridX,
      gridY: neighbor.gridY,
    })),
  ];
  const usableGrants =
    abandonedIds === undefined || abandonedIds.size === 0
      ? view.tilesets
      : view.tilesets.filter((grant) => !abandonedIds.has(grant.id));
  const tileSize =
    primaryTileset(usableGrants)?.tileWidth ?? TILE_SIZE_FALLBACK;
  const slotWidth =
    Math.max(...positions.map((entry) => entry.view.dungeon.width)) * tileSize;
  const slotHeight =
    Math.max(...positions.map((entry) => entry.view.dungeon.height)) * tileSize;
  const minGridX = Math.min(...positions.map((entry) => entry.gridX));
  const minGridY = Math.min(...positions.map((entry) => entry.gridY));
  const maxGridX = Math.max(...positions.map((entry) => entry.gridX));
  const maxGridY = Math.max(...positions.map((entry) => entry.gridY));
  const width = (maxGridX - minGridX + 1) * slotWidth;
  const height = (maxGridY - minGridY + 1) * slotHeight;
  // Absolute slot coordinates: `gridX * slotW`, NOT `(gridX - minGridX) * slotW`.
  // A relative anchor shifts the world origin whenever the slot set changes, so
  // a grid crossing re-renders every map a full slot away from where it was and
  // the follow target's relative position jumps -> the camera pans half a
  // viewport and the map content "warps" under the player. Absolute anchoring
  // keeps each map at its grid position forever; a crossing merely glides the
  // player one tile into an already-rendered neighbor and the follow target
  // never moves when real neighbors land.
  const playerX =
    active.gridX * slotWidth + view.run.currentX * tileSize + tileSize / 2;
  const playerY =
    active.gridY * slotHeight + view.run.currentY * tileSize + tileSize / 2;
  return {
    width,
    height,
    originX: minGridX * slotWidth,
    originY: minGridY * slotHeight,
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

function uniqueGrants(
  views: readonly DungeonRunView[],
): readonly TilesetGrant[] {
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
  /**
   * Set the moment the scene is torn down (SHUTDOWN *or* DESTROY). While
   * `booted` only guards against a pre-create scene, `dead` also guards against
   * a scene whose systems have been nulled by `game.destroy(true)` — that path
   * fires DESTROY, not SHUTDOWN, so `booted` would wrongly stay `true`.
   */
  private dead = false;

  private renderedLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private renderedSprites: Phaser.GameObjects.Sprite[] = [];
  private flatGraphics: Phaser.GameObjects.Graphics[] = [];
  private layerInfos: DungeonLayerInfo[] = [];
  private flatCells = 0;
  private mixedSizes = false;
  private mapCount = 0;
  private rendered = false;
  // --- Opt-in perf HUD (zero-cost when off; see enableHud/toggleHud) ---
  private hudEnabled = false;
  private hudText: Phaser.GameObjects.Text | null = null;
  private hudTimer: Phaser.Time.TimerEvent | null = null;
  private worldInfo: { readonly width: number; readonly height: number } = {
    width: 0,
    height: 0,
  };
  private slotInfo: { readonly w: number; readonly h: number } = { w: 0, h: 0 };
  private tileSize = TILE_SIZE_FALLBACK;
  private partyGroup: Phaser.GameObjects.Group | null = null;
  private leaderSprite: Phaser.GameObjects.Sprite | null = null;
  private lastLeaderCatalogId: string | null = null;
  /** Set of party catalog ids from the last renderParty; used to avoid rebuilding
   * sprites (and restarting the walk animation) on every move. */
  private lastPartyKey: string | null = null;
  /** Live party sprites keyed by catalogId; preserved across recomposes so the
   * walk animation keeps running. Rebuilt only when the party set changes. */
  private partySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private dotsLoading = false;
  private followTween: Phaser.Tweens.Tween | null = null;
  private lastFollowTarget: { readonly x: number; readonly y: number } | null =
    null;
  private clampBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null = null;
  private lastComposedNeighbors: readonly DungeonGridNeighbor[] | null = null;
  private lastComposedActiveView: DungeonRunView | null = null;
  private poiInfos: DungeonPoiInfo[] = [];
  private renderedTexts: Phaser.GameObjects.Text[] = [];
  private activeSlotOrigin: { readonly x: number; readonly y: number } | null =
    null;
  private textureFallbackReported = new Set<string>();
  private remotePlayers = new Map<string, RemotePlayerRender>();

  constructor() {
    super({ key: DUNGEON_SCENE_KEY });
  }

  create(): void {
    this.booted = true;
    this.dead = false;
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setZoom(DUNGEON_CAMERA_ZOOM);
    this.followTarget = this.add.container(0, 0);
    this.cameras.main.startFollow(this.followTarget, true, 1, 1);
    this.cameras.main.on(
      Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE,
      this.clampCameraScroll,
      this,
    );
    // Wire teardown to BOTH scene lifecycle events:
    //  • SHUTDOWN — fired when the scene is stopped/put to sleep (e.g. the
    //    scene manager stops it without destroying the game).
    //  • DESTROY — fired by `game.destroy(true)` (the React view's unmount
    //    cleanup). Phaser's Systems.destroy() emits DESTROY and nulls
    //    `this.add` / `updateList` / `scene` / `events` but does NOT emit
    //    SHUTDOWN. Without binding to DESTROY too, shutdown() never ran on the
    //    unmount path, leaving a zombie scene whose `booted` stayed true and
    //    whose async recompose callbacks (tileset loads, dot fallbacks) later
    //    crashed with "can't access property 'add', this.updateList is null".
    // Phaser does NOT auto-call a `shutdown` method, so both bindings are
    // required for real teardown.
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.on(Phaser.Scenes.Events.DESTROY, this.shutdown, this);
    this.input.on("pointerdown", this.handleCellPointer, this);
    window.__dungeonPhaser = {
      scene: this,
      getState: () => this.getState(),
      triggerBossHit: (catalogId: string) => this.triggerBossHit(catalogId),
      toggleHud: () => this.toggleHud(),
    };
    // Opt-in perf HUD: ?hud=1 (or window.__dungeonPhaser.toggleHud()). Zero cost
    // unless enabled — sampling only starts when the HUD is on.
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("hud")) {
      this.enableHud();
    }
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
    // CameraManager nulls `cameras.main` (and destroys the camera GameObject,
    // dropping its FOLLOW_UPDATE listener) before this runs, so guard the off.
    this.cameras?.main?.off(
      Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE,
      this.clampCameraScroll,
      this,
    );
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.shutdown, this);
    // Tear down the opt-in HUD so a destroyed scene leaks no timer/text.
    this.disableHud();
    this.hudText?.destroy();
    this.hudText = null;
    this.partyGroup?.destroy(true);
    this.partyGroup = null;
    this.leaderSprite = null;
    this.lastLeaderCatalogId = null;
    this.dotsLoading = false;
    this.textureFallbackReported.clear();
    for (const render of this.remotePlayers.values())
      this.destroyRemotePlayer(render);
    this.remotePlayers.clear();
    this.clearRendered();
    this.booted = false;
    // Mark the scene dead: its systems (`add`, `updateList`, `cameras`, etc.)
    // have been nulled by the teardown that triggered this. Any async
    // recompose callback that still fires afterwards must bail instead of
    // touching a dead GameObjectFactory.
    this.dead = true;
    this.latestProps = null;
    this.lastComposedNeighbors = null;
    this.lastComposedActiveView = null;
    this.followTarget = null;
  }

  /**
   * True once the scene has been torn down (SHUTDOWN or DESTROY). After teardown
   * Phaser has nulled `this.add` / `this.updateList` / `this.cameras`, so any
   * deferred work (tileset `loader` complete, dot fallback, sheet preload) must
   * treat the scene as inert and never call `recompose`/`renderParty`.
   */
  isAlive(): boolean {
    return this.booted && !this.dead;
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
    remotePlayers: readonly DungeonRemotePlayer[],
    party: readonly RosterView[],
    facing: Facing,
    moveDurationMs: number,
    partyTrail: readonly { readonly x: number; readonly y: number }[],
    onCellClick: (x: number, y: number) => void,
    onPlayerClick: (
      userId: string,
      displayName: string,
      x: number,
      y: number,
    ) => void,
    onTextureFallback: (failed: readonly TilesetGrant[]) => void,
  ): void {
    const prev = this.latestProps;
    this.latestProps = {
      view,
      neighbors,
      remotePlayers,
      party,
      facing,
      moveDurationMs,
      partyTrail,
      onCellClick,
      onPlayerClick,
      onTextureFallback,
    };
    if (!this.isAlive()) return;
    if (
      prev !== null &&
      prev.view === view &&
      prev.neighbors === neighbors &&
      prev.party === party &&
      prev.facing === facing &&
      prev.moveDurationMs === moveDurationMs &&
      prev.partyTrail === partyTrail
    ) {
      if (prev.remotePlayers !== remotePlayers)
        this.renderRemotePlayers(this.latestProps);
      return;
    }
    this.recompose();
  }

  // --- Opt-in perf HUD -------------------------------------------------------
  // Measures the live frame rate, frame time, and object counts so a dungeon
  // "feels laggy" report can be triaged with numbers instead of guesses. Zero
  // cost when off: a 500ms sampler runs only while enabled, and `create()` only
  // turns it on for `?hud=1`. Toggle at runtime via
  // `window.__dungeonPhaser.toggleHud()`.
  toggleHud(): void {
    if (this.hudEnabled) this.disableHud();
    else this.enableHud();
  }

  private enableHud(): void {
    this.hudEnabled = true;
    if (this.hudText === null) {
      this.hudText = this.add
        .text(8, 8, "", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#7CFC00",
          backgroundColor: "rgba(0,0,0,0.5)",
        })
        .setScrollFactor(0)
        .setDepth(99999);
    }
    this.hudText.setVisible(true);
    this.hudTimer?.remove();
    this.hudTimer = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.sampleHud(),
    });
    this.sampleHud();
  }

  private disableHud(): void {
    this.hudEnabled = false;
    this.hudTimer?.remove();
    this.hudTimer = null;
    this.hudText?.setVisible(false);
  }

  private sampleHud(): void {
    if (this.hudText === null) return;
    const loop = this.game.loop;
    const fps = Math.round(loop.actualFps);
    const ms = loop.delta.toFixed(1);
    // Phaser WebGLRenderer exposes `renderer.drawCount`; fall back to "n/a".
    const drawCount = (this.game.renderer as { drawCount?: number }).drawCount;
    const draw = drawCount === undefined ? "n/a" : String(drawCount);
    const textures = this.textures.getTextureKeys().length;
    const party = this.partySprites.size;
    const remote = this.remotePlayers.size;
    const w = Math.round(this.cameras.main.width / this.cameras.main.zoom);
    const h = Math.round(this.cameras.main.height / this.cameras.main.zoom);
    this.hudText.setText(
      [
        `FPS ${fps}  ${ms}ms`,
        `draws ${draw}`,
        `maps ${this.mapCount}  tex ${textures}`,
        `party ${party}  remote ${remote}`,
        `viewport ${w}x${h}  zoom ${this.cameras.main.zoom}`,
      ].join("\n"),
    );
  }

  getState(): DungeonPhaserDebugState {
    const camera = this.cameras.main;
    const follow = this.followTarget;
    const sprites: {
      readonly catalogId: string;
      readonly flipX: boolean;
      readonly x: number;
      readonly y: number;
    }[] = [];
    if (this.partyGroup !== null) {
      for (const child of this.partyGroup.getChildren()) {
        if (!(child instanceof Phaser.GameObjects.Sprite)) continue;
        sprites.push({
          catalogId: String(getSpriteData(child, "catalogId") ?? ""),
          flipX: child.flipX,
          x: Math.round(child.x * 100) / 100,
          y: Math.round(child.y * 100) / 100,
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
    // `liquid` is no longer an underlay: it renders above the floor/grass bed
    // (see `LAYER_DEPTH` in @digiworld/shared) so the water is visible, while
    // still sitting below the party and the bridge/trigger POIs. Unknown kinds
    // fall to 99 (top of the terrain stack).
    return layerDepth(kind as LayerKind);
  }

  private recompose(): void {
    if (this.dead || !this.booted) return;
    const props = this.latestProps;
    if (props === null || this.followTarget === null) return;
    // Crossing continuity: when the run crosses into a neighbor, the route
    // navigates (replace:true) and the neighbors query refetches for the new
    // dungeon id — for a few renders the wrapper passes `neighbors: []`. That
    // empty list must NOT collapse the composed world to a single map mid-
    // crossing (a rebuild would snap the camera). Until the fresh neighbors
    // land, rebuild the SAME slot set as the last composition: the crossed-
    // into dungeon (now the active view) drops out of its own neighbor slot
    // and the previous active view takes that slot's place as a neighbor. The
    // two maps swap roles, so world size + origin are unchanged and the camera
    // never snaps; when the real neighbor list lands (same slot set), the
    // recomposition is a no-op render.
    let neighbors = props.neighbors;
    if (
      neighbors.length === 0 &&
      this.lastComposedActiveView !== null &&
      this.lastComposedNeighbors !== null &&
      this.lastComposedNeighbors.length > 0
    ) {
      const activeId = props.view.dungeon.id;
      const previousActive = this.lastComposedActiveView;
      if (previousActive.dungeon.id === activeId) {
        neighbors = this.lastComposedNeighbors;
      } else {
        const crossedInto = this.lastComposedNeighbors.find(
          (neighbor) => neighbor.dungeonId === activeId,
        );
        if (crossedInto !== undefined) {
          neighbors = [
            {
              dungeonId: previousActive.dungeon.id,
              gridX: previousActive.dungeon.gridX ?? 0,
              gridY: previousActive.dungeon.gridY ?? 0,
              view: previousActive,
            },
            ...this.lastComposedNeighbors.filter(
              (neighbor) => neighbor.dungeonId !== activeId,
            ),
          ];
        }
      }
    }
    const grants = uniqueGrants([
      props.view,
      ...neighbors.map((neighbor) => neighbor.view),
    ]);
    const abandonedIds = new Set(
      grants
        .filter((grant) => isTextureAbandoned(this.textures, tilesetKey(grant)))
        .map((grant) => grant.id),
    );
    const layout = computeLayout(props.view, neighbors, abandonedIds);
    this.lastComposedNeighbors = neighbors;
    this.lastComposedActiveView = props.view;
    this.clampBounds = {
      x: layout.originX,
      y: layout.originY,
      width: layout.width,
      height: layout.height,
    };
    // startFollow (lerp 1) tracks this target every frame, so moving it in
    // place keeps camera continuity across grid-crossing re-compositions.
    // A position change (a walk or a grid cross) glides the target to the new
    // cell over moveDurationMs instead of teleporting it — the camera follows
    // the glide, so crossing the seam stays continuous (the DOM animates the
    // canvas transform the same way via its 180ms CSS transition).
    const lastFollow = this.lastFollowTarget;
    if (
      lastFollow === null ||
      lastFollow.x !== layout.playerX ||
      lastFollow.y !== layout.playerY
    ) {
      this.moveFollowTarget(
        layout.playerX,
        layout.playerY,
        props.moveDurationMs,
      );
    }
    // The camera is NOT bounded via Phaser's setBounds: clampX/clampY mix the
    // camera's pixel width with displayWidth (width/zoom) and pin a world
    // narrower than the viewport to the corner. Instead clamp each axis
    // independently, exactly like ContinuousDungeonGrid: an axis that fits the
    // viewport stays free (the follow target keeps the player screen-centered,
    // the small-map centering branch); an overflowing axis clamps so no void
    // shows past the composed world's edge.
    const missing = grants.filter(
      (grant) => !this.textures.exists(tilesetKey(grant)),
    );
    const retryable = missing.filter((grant) => !abandonedIds.has(grant.id));
    if (retryable.length > 0) {
      // Textures land async — queue the load, register frames on complete,
      // then recompose again (which renders once every grant has a texture).
      // Grants past their retry budget are excluded, so a permanently missing
      // image falls back to the flat path instead of deadlocking forever.
      this.ensureTilesetsLoaded(grants);
    } else {
      this.clearRendered();
      this.renderWorld(props, layout);
    }
    // Party dots load independently of tilesets — render regardless (a
    // fallback dungeon with no tilesets must still show the party).
    this.renderParty(props, layout);
    this.renderRemotePlayers(props);
  }

  private destroyRemotePlayer(render: RemotePlayerRender): void {
    this.tweens.killTweensOf(render.leader);
    this.tweens.killTweensOf(render.nameText);
    render.leader.destroy();
    render.nameText.destroy();
    for (const follower of render.followers) {
      this.tweens.killTweensOf(follower.sprite);
      follower.sprite.destroy();
    }
    render.followers = [];
  }

  /**
   * Diff the remote-player list against the rendered sprites: create a
   * digimon sprite (or placeholder circle) + name tag per newcomer, tween
   * moves cell to cell with the same glide the local party uses, keep the
   * follower fileira in sync with the trail, and destroy leavers.
   *
   * Positioning contract: the leader sprite, name tag, and every follower are
   * placed at WORLD coordinates (`slotX + x*tileSize + tileSize/2`) — the same
   * absolute math the local party uses — and tweened in place. They are NOT
   * parented to a Container. A Container would be fine for positioning (Phaser
   * 3.90's `Container.add` keeps the child's local coords, so a sprite added at
   * (0,0) still renders at the container's world position), but the previous
   * code created the leader sprite at WORLD (0,0) and only added it on the
   * placeholder path, leaving the async-loaded sprite orphaned at the world
   * origin. World-space placement with no container removes that whole class of
   * bug: the sprite is always created at its real cell.
   */
  private renderRemotePlayers(props: SceneProps): void {
    const layout = computeLayout(props.view, props.neighbors);
    const tileSize = layout.tileSize;
    const byId = new Map(
      props.remotePlayers.map((player) => [player.userId, player] as const),
    );

    for (const [userId, render] of this.remotePlayers) {
      if (!byId.has(userId)) {
        this.destroyRemotePlayer(render);
        this.remotePlayers.delete(userId);
      }
    }

    for (const player of props.remotePlayers) {
      const cell = {
        x: player.x,
        y: player.y,
        gridX: player.gridX,
        gridY: player.gridY,
      };
      const slotX = player.gridX * layout.slotW;
      const slotY = player.gridY * layout.slotH;
      const targetX = slotX + player.x * tileSize + tileSize / 2;
      const targetY = slotY + player.y * tileSize + tileSize / 2;
      const known = this.remotePlayers.get(player.userId);

      // The leader's sprite is created at its real WORLD cell the moment the
      // texture is ready (spawnDigimonSprite), so there is no longer a
      // placeholder→sprite rebuild: spawnDigimonSprite returns null until the
      // sheet lands, at which point it creates the sprite straight at targetX/Y.
      // If an already-shown placeholder circle needs upgrading to the real
      // digimon, swap it in place (no destroy/recreate churn).
      if (known !== undefined) {
        const moved =
          known.cell.x !== cell.x ||
          known.cell.y !== cell.y ||
          known.cell.gridX !== cell.gridX ||
          known.cell.gridY !== cell.gridY;
        if (moved) {
          this.tweens.killTweensOf(known.leader);
          this.tweens.killTweensOf(known.nameText);
          this.tweens.add({
            targets: [known.leader, known.nameText],
            x: targetX,
            y: targetY,
            duration: Math.max(MIN_TWEEN_MS, props.moveDurationMs),
            ease: "Linear",
          });
          known.cell = cell;
        }
        // Upgrade placeholder circle → real digimon sprite once the sheet lands.
        if (
          known.catalogId === null &&
          player.leaderCatalogId !== undefined &&
          player.leaderCatalogId !== ""
        ) {
          const sprite = this.spawnDigimonSprite(
            player.leaderCatalogId,
            known.leader.x,
            known.leader.y,
            PARTY_DEPTH - 1,
            false,
            "remote-leader",
          );
          if (sprite !== null) {
            known.leader.destroy();
            known.leader = sprite;
            known.catalogId = player.leaderCatalogId;
          }
        }
        this.syncRemoteFollowers(
          known,
          player,
          slotX,
          slotY,
          tileSize,
          props.moveDurationMs,
        );
        continue;
      }

      const catalogId = player.leaderCatalogId ?? player.party?.[0] ?? "";
      // spawnDigimonSprite returns null until the sheet texture has loaded; the
      // loader's COMPLETE handler re-renders, so the next pass upgrades the
      // placeholder to the real digimon in place (see known!==undefined branch).
      const leader =
        catalogId !== ""
          ? this.spawnDigimonSprite(catalogId, targetX, targetY, PARTY_DEPTH - 1, false, "remote-leader")
          : null;
      const leaderObj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc =
        leader !== null
          ? leader
          : this.add.circle(targetX, targetY, tileSize * 0.3, 0x9aa3b5).setDepth(PARTY_DEPTH - 1);
      const name = this.add.text(
        targetX,
        targetY - tileSize / 2 - 4,
        player.displayName,
        {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
        },
      );
      name.setOrigin(0.5, 1);
      name.setDepth(PARTY_DEPTH - 1);
      const render: RemotePlayerRender = {
        leader: leaderObj,
        nameText: name,
        cell,
        catalogId: leader !== null ? catalogId : null,
        followers: [],
      };
      this.remotePlayers.set(player.userId, render);
      this.syncRemoteFollowers(
        render,
        player,
        slotX,
        slotY,
        tileSize,
        props.moveDurationMs,
      );
    }
  }

  private syncRemoteFollowers(
    render: RemotePlayerRender,
    player: DungeonRemotePlayer,
    slotX: number,
    slotY: number,
    tileSize: number,
    moveDurationMs: number,
  ): void {
    const party = player.party ?? [];
    const trail = player.trail ?? [];
    const wanted = Math.max(0, Math.min(party.length - 1, trail.length - 1, 2));
    this.removeExcessFollowers(render, wanted);
    for (let i = 0; i < wanted; i++) {
      const memberIndex = i + 1;
      const trailCell = trail[memberIndex];
      if (trailCell === undefined) continue;
      const catalogId = party[memberIndex] ?? "";
      const targetX = slotX + trailCell.x * tileSize + tileSize / 2;
      const targetY = slotY + trailCell.y * tileSize + tileSize / 2;
      const existing = render.followers[i];
      if (existing !== undefined) {
        this.syncExistingFollower(
          render,
          i,
          existing,
          trailCell,
          catalogId,
          targetX,
          targetY,
          moveDurationMs,
        );
        continue;
      }
      render.followers.push({
        sprite: this.createFollowerSprite(catalogId, targetX, targetY, tileSize),
        cell: { x: trailCell.x, y: trailCell.y },
      });
    }
  }

  /** Drop trailing follower sprites past the wanted count. */
  private removeExcessFollowers(
    render: RemotePlayerRender,
    wanted: number,
  ): void {
    while (render.followers.length > wanted) {
      const removed = render.followers.pop();
      if (removed === undefined) break;
      this.tweens.killTweensOf(removed.sprite);
      removed.sprite.destroy();
    }
  }

  /** Tween an existing follower to its new cell and swap a circle for a loaded dot. */
  private syncExistingFollower(
    render: RemotePlayerRender,
    index: number,
    existing: RemotePlayerRender["followers"][number],
    trailCell: { readonly x: number; readonly y: number },
    catalogId: string,
    targetX: number,
    targetY: number,
    moveDurationMs: number,
  ): void {
    if (existing.cell.x !== trailCell.x || existing.cell.y !== trailCell.y) {
      this.tweens.killTweensOf(existing.sprite);
      this.tweens.add({
        targets: existing.sprite,
        x: targetX,
        y: targetY,
        duration: Math.max(MIN_TWEEN_MS, moveDurationMs),
        ease: "Linear",
      });
      existing.cell = { x: trailCell.x, y: trailCell.y };
    }
    if (existing.sprite instanceof Phaser.GameObjects.Arc && catalogId !== "") {
      const dot = this.spawnDigimonSprite(
        catalogId,
        targetX,
        targetY,
        PARTY_DEPTH - 1,
        false,
        "remote-follower",
      );
      existing.sprite.destroy();
      if (dot !== null) {
        render.followers[index] = {
          sprite: dot,
          cell: { x: trailCell.x, y: trailCell.y },
        };
      }
    }
  }

  /** A remote follower is a digimon dot when the catalog id resolved, else a placeholder circle. */
  private createFollowerSprite(
    catalogId: string,
    targetX: number,
    targetY: number,
    tileSize: number,
  ): Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc {
    const dot =
      catalogId !== ""
        ? this.spawnDigimonSprite(
            catalogId,
            targetX,
            targetY,
            PARTY_DEPTH - 1,
            false,
            "remote-follower",
          )
        : null;
    if (dot === null) {
      return this.add
        .circle(targetX, targetY, tileSize * 0.3, 0x9aa3b5)
        .setDepth(PARTY_DEPTH - 1);
    }
    return dot;
  }

  private clampFollowTargetPos(
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } {
    const bounds = this.clampBounds;
    if (bounds === null) return { x, y };
    const camera = this.cameras.main;
    // Defensive: a scene whose camera has been torn down (SHUTDOWN) must never
    // throw here. If this still fires on a dead scene, booted/followTarget
    // should have already short-circuited recompose — this is the backstop.
    if (!camera) return { x, y };
    const displayW = camera.displayWidth / camera.zoom;
    const displayH = camera.displayHeight / camera.zoom;
    const cx =
      bounds.width > displayW
        ? Phaser.Math.Clamp(
            x,
            bounds.x + displayW / 2,
            bounds.x + bounds.width - displayW / 2,
          )
        : bounds.x + bounds.width / 2;
    const cy =
      bounds.height > displayH
        ? Phaser.Math.Clamp(
            y,
            bounds.y + displayH / 2,
            bounds.y + bounds.height - displayH / 2,
          )
        : bounds.y + bounds.height / 2;
    return { x: cx, y: cy };
  }

  private moveFollowTarget(x: number, y: number, durationMs: number): void {
    const target = this.followTarget;
    if (target === null) return;
    const clamped = this.clampFollowTargetPos(x, y);
    const last = this.lastFollowTarget;
    if (last === null) {
      target.setPosition(clamped.x, clamped.y);
      this.lastFollowTarget = { x: clamped.x, y: clamped.y };
      return;
    }
    if (last.x === clamped.x && last.y === clamped.y) {
      if (this.followTween !== null && this.followTween.isPlaying()) return;
      target.setPosition(clamped.x, clamped.y);
      return;
    }
    if (this.followTween !== null) this.followTween.destroy();
    this.followTween = this.tweens.add({
      targets: target,
      x: clamped.x,
      y: clamped.y,
      duration: Math.max(MIN_TWEEN_MS, durationMs),
      ease: "Linear",
    });
    this.lastFollowTarget = { x: clamped.x, y: clamped.y };
  }

  private clampCameraScroll(): void {
    const bounds = this.clampBounds;
    const target = this.followTarget;
    if (bounds === null || target === null) return;
    if (this.followTween !== null && this.followTween.isPlaying()) return;
    // Safety net for mid-game viewport resizes (the walk path pre-clamps its
    // destination, so this only ever corrects a stale target after a resize).
    const clamped = this.clampFollowTargetPos(target.x, target.y);
    if (clamped.x !== target.x || clamped.y !== target.y)
      target.setPosition(clamped.x, clamped.y);
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
    const slotOffsetX = gridX * layout.slotW;
    const slotOffsetY = gridY * layout.slotH;
    const leader = props.party[0];
    const members: {
      readonly catalogId: string;
      readonly isLeader: boolean;
      readonly x: number;
      readonly y: number;
    }[] = [];
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
    // Stability key: only the SET of digimon catalog ids forces a sprite rebuild.
    // A plain move (position change, facing flip) must NOT destroy + recreate the
    // sprites — recreate() restarts the walk animation on frame 0 every
    // recompose, which made the whole party look frozen/static even though the
    // sheets animated fine. When only positions change we reposition in place.
    const partyKey = members.map((m) => m.catalogId).join("|");
    const partyChanged = partyKey !== this.lastPartyKey;
    this.lastPartyKey = partyKey;

    const previousLeader = this.leaderSprite;
    const previousLeaderPos =
      previousLeader !== null
        ? { x: previousLeader.x, y: previousLeader.y }
        : null;
    if (previousLeader !== null) this.tweens.killTweensOf(previousLeader);
    if (partyChanged) {
      this.partyGroup?.destroy(true);
      this.partyGroup = null;
      this.leaderSprite = null;
    }

    if (members.length === 0) return;

    // The digimon art in these sheets faces LEFT by default, so we mirror
    // (flipX) when the party is moving RIGHT — not left. (Previously
    // flipX = facing === "left", which made walk-left face right: backwards.)
    const flipX = props.facing === "right";
    // Keep a persistent group across recomposes (only (re)built when the party
    // set changes) so the walk animation is never restarted by a plain move.
    if (this.partyGroup === null) {
      this.partyGroup = this.add.group();
    }
    const group = this.partyGroup;
    if (partyChanged) {
      this.partySprites.clear();
    }

    const leaderMember = members.find((member) => member.isLeader);
    const leaderMoved =
      previousLeaderPos !== null &&
      leaderMember !== undefined &&
      leaderMember.catalogId === this.lastLeaderCatalogId &&
      (previousLeaderPos.x !== leaderMember.x ||
        previousLeaderPos.y !== leaderMember.y);

    for (const member of members) {
      // Reuse the existing sprite for this digimon instead of destroying it;
      // only create once per catalog id, then reposition (preserves the walk
      // animation that was running).
      let sprite = this.partySprites.get(member.catalogId) ?? null;
      if (sprite === null || !sprite.active) {
        sprite = this.spawnDigimonSprite(
          member.catalogId,
          member.x,
          member.y,
          PARTY_DEPTH,
          flipX,
          "party",
        );
        if (sprite !== null) {
          sprite.setName(`digimon-party:${member.catalogId}`);
          this.partySprites.set(member.catalogId, sprite);
        }
      }
      if (sprite === null) continue;
      sprite.setData("catalogId", member.catalogId);
      if (!group.contains(sprite)) group.add(sprite);
      sprite.setFlipX(flipX);
      if (member.isLeader) {
        this.leaderSprite = sprite;
        if (leaderMoved) {
          sprite.setPosition(previousLeaderPos.x, previousLeaderPos.y);
          this.tweens.add({
            targets: sprite,
            x: member.x,
            y: member.y,
            duration: props.moveDurationMs,
            ease: "Linear",
          });
        } else {
          sprite.setPosition(member.x, member.y);
        }
      } else {
        sprite.setPosition(member.x, member.y);
      }
    }
    // Drop sprites whose digimon is no longer in the party.
    for (const [catalogId, sprite] of this.partySprites) {
      if (!members.some((m) => m.catalogId === catalogId)) {
        sprite.destroy();
        this.partySprites.delete(catalogId);
      }
    }
    this.lastLeaderCatalogId = leader?.catalogId ?? null;
  }

  /**
   * Ensure every party dot texture is loaded, returning true only when all
   * exist. Loads piggyback on any in-flight tileset load (Phaser `start()` is
   * a no-op while loading) and re-render on COMPLETE. The idle-with-empty-list
   * guard prevents a failed load from spinning: start() on an empty queue
   * emits COMPLETE synchronously, which would otherwise recompose forever. On
   * COMPLETE, dots whose GIF never landed (404/network) are reported to the
   * pipeline so they can be retried after the quarantine window instead of
   * being stuck "requested" forever.
   */
  private ensureDigimonDotsLoaded(catalogIds: readonly string[]): boolean {
    const missing = catalogIds.filter(
      (catalogId) => !this.textures.exists(digimonDotKey(catalogId)),
    );
    if (missing.length === 0) return true;
    if (this.dotsLoading) return false;
    const loader = this.load;
    const settle = () => {
      this.dotsLoading = false;
      for (const catalogId of missing) {
        const key = digimonDotKey(catalogId);
        if (this.textures.exists(key)) continue;
        if (buildDotTexture(this, catalogId)) continue;
        fallbackStaticDot(this, catalogId, () => this.recompose());
        markTextureLoadFailed(this, key);
      }
      this.recompose();
    };
    if (loader.isLoading()) {
      this.dotsLoading = true;
      for (const catalogId of missing) preloadDigimonDot(this, catalogId);
      loader.once(Phaser.Loader.Events.COMPLETE, settle);
      return false;
    }
    const listSizeBefore = loader.list.size;
    for (const catalogId of missing) preloadDigimonDot(this, catalogId);
    if (loader.list.size === listSizeBefore) return false;
    this.dotsLoading = true;
    loader.once(Phaser.Loader.Events.COMPLETE, settle);
    loader.start();
    return false;
  }

  /**
   * Pre-queue the 2×2 sprite sheets for the given catalog ids (bosses, remote
   * leaders) so they are ready before the sprites are spawned. Mirrors
   * `ensureDigimonDotsLoaded` but targets the generated sheet endpoint; missing
   * sheets simply 404 and fall back to the GIF dot when the sprite is spawned.
   */
  /**
   * Queue the 2×2 sprite sheets for the given catalog ids so they are ready
   * before sprites are spawned. Returns `true` when every sheet is already
   * loaded (callers can spawn immediately); `false` while a load is in flight
   * or queued. The COMPLETE handler re-renders so callers that got `false`
   * converge on the loaded sprites on the next pass. (Previously this always
   * returned `false`, which made any caller relying on the boolean as an
   * "arrived" signal dead code.)
   */
  private ensureDigimonSheetPreloaded(catalogIds: readonly string[]): boolean {
    const loader = this.load;
    if (loader.isLoading()) return false;
    const allReady = catalogIds.every((id) =>
      this.textures.exists(digimonSheetKey(id)),
    );
    if (allReady) return true;
    const listSizeBefore = loader.list.size;
    for (const catalogId of catalogIds) preloadDigimonSheet(this, catalogId);
    if (loader.list.size === listSizeBefore) return false;
    loader.once(Phaser.Loader.Events.COMPLETE, () => this.recompose());
    loader.start();
    return false;
  }

  /**
   * Create a digimon sprite at `(x, y)` using the shared 2×2 sprite-sheet system
   * (walk + hit rows). Prefers the generated sheet; on a 404 it falls back to the
   * legacy GIF dot. The sprite is added to `renderedSprites` and plays its walk
   * anim immediately. Returns the sprite (or null if it could not be placed yet).
   */
  private spawnDigimonSprite(
    catalogId: string,
    x: number,
    y: number,
    depth: number,
    flipX: boolean,
    role: string,
  ): Phaser.GameObjects.Sprite | null {
    const existing = this.children.getByName(
      digimonSpriteName(role, catalogId),
    );
    if (existing instanceof Phaser.GameObjects.Sprite) return existing;
    let sprite: Phaser.GameObjects.Sprite | null = null;
    ensureDigimonSpriteLoaded(this, catalogId, (load) => {
      if (load.kind === "none") return;
      if (this.textures.exists(load.key)) {
        sprite = this.add.sprite(
          x,
          y,
          load.key,
          load.kind === "sheet" ? "cell0" : undefined,
        );
        sprite.setName(digimonSpriteName(role, catalogId));
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(this.tileSize, this.tileSize);
        // Force the sliced cell frame explicitly: the numeric "0" frame name used
        // to collide with Phaser's __BASE whole-sheet frame, so set it directly.
        if (load.kind === "sheet") sprite.setFrame("cell0");
        sprite.setFlipX(flipX);
        sprite.setDepth(depth);
        if (this.anims.exists(load.walkAnim)) sprite.play(load.walkAnim);
        this.renderedSprites.push(sprite);
      }
    });
    return sprite;
  }

  /** Play the attack pose (frame 3) on a digimon sprite; after a brief hold return to walk. */
  private playDigimonAttack(sprite: Phaser.GameObjects.Sprite): void {
    const catalogId = catalogIdFromSpriteName(sprite.name);
    const attackAnim = sheetAttackAnimKey(catalogId);
    if (
      sprite.anims.currentAnim?.key !== attackAnim &&
      this.anims.exists(attackAnim)
    ) {
      sprite.play(attackAnim);
      this.time.delayedCall(ANIMATION_HOLD_MS, () => {
        const walkAnim = sheetWalkAnimKey(catalogId);
        if (this.anims.exists(walkAnim)) sprite.play(walkAnim);
      });
    }
  }

  /** Play the take-hit pose (frame 2) on a digimon sprite; after a brief hold return to walk. */
  private playDigimonTakeHit(sprite: Phaser.GameObjects.Sprite): void {
    const catalogId = catalogIdFromSpriteName(sprite.name);
    const takeHitAnim = sheetTakeHitAnimKey(catalogId);
    if (
      sprite.anims.currentAnim?.key !== takeHitAnim &&
      this.anims.exists(takeHitAnim)
    ) {
      sprite.play(takeHitAnim);
      this.time.delayedCall(ANIMATION_HOLD_MS, () => {
        const walkAnim = sheetWalkAnimKey(catalogId);
        if (this.anims.exists(walkAnim)) sprite.play(walkAnim);
      });
    }
  }

  /** Trigger the boss's attack pose when an encounter starts. */
  triggerBossHit(catalogId: string): void {
    for (const sprite of this.renderedSprites) {
      if (
        getSpriteData<string>(sprite, "poiKind") === "boss" &&
        getSpriteData<string>(sprite, "bossCatalogId") === catalogId
      ) {
        this.playDigimonAttack(sprite);
        return;
      }
    }
  }

  private texturesLoading = false;

  /**
   * Kick off a runtime tileset load for grants that have no texture yet.
   * `preloadTilesets` returns only the keys actually queued, so a re-entrant
   * call for grants that are already loaded, in-flight, or quarantined after
   * a failure registers no listener and cannot spin on an empty loader. On
   * COMPLETE, grants whose texture still never landed (404/network) are
   * reported to the pipeline so they can be retried after the quarantine
   * window instead of being stuck "requested" forever.
   */
  private ensureTilesetsLoaded(grants: readonly TilesetGrant[]): void {
    if (this.texturesLoading) return;
    const missing = grants.filter(
      (grant) => !this.textures.exists(tilesetKey(grant)),
    );
    if (missing.length === 0) return;
    const queued = preloadTilesets(this, missing);
    if (queued.length === 0) return;
    this.texturesLoading = true;
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.texturesLoading = false;
      const newlyAbandoned: TilesetGrant[] = [];
      for (const grant of missing) {
        const key = tilesetKey(grant);
        if (this.textures.exists(key)) continue;
        markTextureLoadFailed(this, key);
        if (
          isTextureAbandoned(this.textures, key) &&
          !this.textureFallbackReported.has(key)
        ) {
          this.textureFallbackReported.add(key);
          newlyAbandoned.push(grant);
        }
      }
      if (newlyAbandoned.length > 0) {
        console.error(
          `[dungeon] tileset textures failed after ${MAX_TEXTURE_RETRIES} retries — falling back to flat rendering: ` +
            newlyAbandoned
              .map((grant) => `${grant.id} (${grant.imageUrl})`)
              .join(", "),
        );
        this.latestProps?.onTextureFallback(newlyAbandoned);
      }
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
      x: activeGridX * layout.slotW,
      y: activeGridY * layout.slotH,
    };
    const bossDots = [
      ...new Set(
        [
          props.view,
          ...props.neighbors.map((neighbor) => neighbor.view),
        ].flatMap((view) =>
          view.encounters
            .filter(
              (encounter) =>
                encounter.difficulty === "boss" &&
                !view.run.defeatedEncounters.includes(encounter.id),
            )
            .flatMap((encounter) =>
              encounter.digimon.map((digimon) => digimon.catalogId),
            ),
        ),
      ),
    ];
    if (bossDots.length > 0) this.ensureDigimonSheetPreloaded(bossDots);
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
      const offsetX = position.gridX * layout.slotW;
      const offsetY = position.gridY * layout.slotH;
      if (
        offsetX + layout.slotW < cullLeft ||
        offsetX > cullRight ||
        offsetY + layout.slotH < cullTop ||
        offsetY > cullBottom
      )
        continue;
      this.renderMap(
        position.view,
        offsetX,
        offsetY,
        position.gridX,
        position.gridY,
      );
      this.mapCount++;
    }
    this.rendered = true;
  }

  /**
   * Render ONE dungeon map onto tilemap layers. `offsetX`/`offsetY` are the
   * slot's world pixel origin (0,0 for the active map at grid (0,0); Todo 4
   * lays out neighbor slots via `gridX * slotW` — absolute grid coordinates,
   * so a grid crossing never re-anchors the composed world).
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
  renderMap(
    view: DungeonRunView,
    offsetX = 0,
    offsetY = 0,
    slotGridX = 0,
    slotGridY = 0,
  ): void {
    const grants = view.tilesets.filter(
      (grant) => !isTextureAbandoned(this.textures, tilesetKey(grant)),
    );
    const primary = primaryTileset(grants);
    const tileSize = primary?.tileWidth ?? TILE_SIZE_FALLBACK;
    const mixed =
      primary !== null &&
      grants.some(
        (grant) =>
          grant.tileWidth !== primary.tileWidth ||
          grant.tileHeight !== primary.tileHeight,
      );
    this.mixedSizes = this.mixedSizes || mixed;
    const width = view.dungeon.width;
    const height = view.dungeon.height;

    const buckets = new Map<string, DungeonTile[]>();
    for (const tile of view.tiles) {
      const list = buckets.get(tile.layerKind);
      if (list) list.push(tile);
      else buckets.set(tile.layerKind, [tile]);
    }
    const bucketEntries = [...buckets.entries()].sort(
      (a, b) => this.kindDepth(a[0]) - this.kindDepth(b[0]),
    );
    const flatCells = new Set<string>();

    for (const [kind, tiles] of bucketEntries) {
      const depth = this.kindDepth(kind);
      const data: number[][] = [];
      for (let y = 0; y < height; y++)
        data.push(new Array<number>(width).fill(-1));
      const rawByCell = new Map<string, number>();
      const spriteCells: {
        readonly x: number;
        readonly y: number;
        readonly rawGid: number;
      }[] = [];
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
        if (
          !row ||
          tile.x < 0 ||
          tile.x >= width ||
          tile.y < 0 ||
          tile.y >= height
        )
          continue;
        row[tile.x] = bareGidForTile(tile.gid);
        rawByCell.set(`${tile.x},${tile.y}`, tile.gid);
        placed++;
      }

      if (placed > 0) {
        const map = this.make.tilemap({
          data,
          tileWidth: tileSize,
          tileHeight: tileSize,
        });
        registerTilesetsOnTilemap(
          map,
          mixed && primary !== null ? [primary] : grants,
        );
        const layer = map.createLayer(0, map.tilesets, offsetX, offsetY);
        if (layer !== null) {
          layer.setDepth(depth);
          // `water` / `liquid` are transparent overlays: render them at < 1
          // alpha so the floor/grass bed beneath shows through (the spike
          // proved this "water on top of an opaque bed" model). Other terrain
          // kinds stay fully opaque.
          if (kind === "water" || kind === "liquid")
            layer.setAlpha(WATER_ALPHA);
          // Re-apply the Tiled flip flags from the raw GIDs (never put flagged
          // gids in the data array — Phaser resolves bare gids through the
          // tileset firstgid spaces).
          for (const [key, rawGid] of rawByCell) {
            const coords = key.split(",").map(Number);
            const tile = layer.getTileAt(coords[0]!, coords[1]!);
            if (tile !== null) applyTiledFlips(tile, rawGid);
          }
          this.renderedLayers.push(layer);
          this.layerInfos.push({
            kind,
            depth,
            x: offsetX,
            y: offsetY,
            width,
            height,
            count: placed,
          });
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
        sprite.setAngle((flip.rotation * 180) / Math.PI);
        sprite.setDepth(depth);
        this.renderedSprites.push(sprite);
      }
    }

    if (flatCells.size > 0) {
      const gfx = this.add.graphics();
      const flatFill =
        Phaser.Display.Color.HexStringToColor(FLAT_CELL_FILL).color;
      const gridFill =
        Phaser.Display.Color.HexStringToColor(FLAT_CELL_GRIDLINE).color;
      for (const key of flatCells) {
        const coords = key.split(",").map(Number);
        const px = offsetX + coords[0]! * tileSize;
        const py = offsetY + coords[1]! * tileSize;
        gfx.fillStyle(flatFill, 1);
        gfx.fillRect(px, py, tileSize, tileSize);
        gfx.fillStyle(gridFill, 1);
        gfx.fillRect(px, py, tileSize, 1);
        gfx.fillRect(px, py + tileSize - 1, tileSize, 1);
        gfx.fillRect(px, py, 1, tileSize);
        gfx.fillRect(px + tileSize - 1, py, 1, tileSize);
      }
      gfx.setDepth(FLAT_CELL_DEPTH);
      this.flatGraphics.push(gfx);
      this.flatCells += flatCells.size;
      const totalCells = new Set(
        view.tiles.map((tile) => `${tile.x},${tile.y}`),
      ).size;
      if (totalCells > 0 && flatCells.size === totalCells) {
        console.warn(
          `[dungeon] map ${view.dungeon.id} rendered with zero owned tiles (${flatCells.size}/${totalCells} cells flat) — tileset-less dungeon`,
        );
      }
    }

    const run = view.run;
    const ctx: PoiRenderContext = {
      view,
      tileSize,
      primary,
      offsetX,
      offsetY,
      slotGridX,
      slotGridY,
      poiCell: (x, y) => offsetX + x * tileSize + tileSize / 2,
      poiRow: (x, y) => offsetY + y * tileSize + tileSize / 2,
      firedSet: new Set(view.firedTriggerIds),
      doorOpenIds: computeDoorOpenIds(view),
      bridgeDownKeys: computeBridgeDownKeys(view),
      poiStateByKey: new Map(
        view.poiStates.map((s) => [`${s.poiKind}:${s.poiId}`, s.state] as const),
      ),
    };

    this.renderDoors(ctx);
    this.renderChests(ctx);
    this.renderTraps(ctx);
    this.renderTriggers(ctx);
    this.renderBridges(ctx);
    this.renderEncounters(ctx);
    this.renderItems(ctx);
    this.renderWarps(ctx);
  }

  // --- POI sub-renderers (split out of renderMap) -------------------------

  private pushPoiInfo(
    kind: DungeonPoiInfo["kind"],
    x: number,
    y: number,
    gid: number | string | null,
    slotGridX: number,
    slotGridY: number,
  ): void {
    this.poiInfos.push({ kind, x, y, gid, slotGridX, slotGridY });
  }

  /**
   * Shared sprite creation for tile-backed POIs (door/chest/trap/trigger/
   * bridge). Pushes a POI-depth sprite when the tile frame exists; otherwise
   * does nothing (the badge / fallback marker is added separately). The old
   * renderMap duplicated this ~10-line block once per POI type.
   */
  private createPoiSprite(
    ctx: PoiRenderContext,
    kind: DungeonPoiInfo["kind"],
    x: number,
    y: number,
    gid: number | null,
    poiId: string,
  ): void {
    if (gid === null) return;
    const frame = ctx.primary !== null ? tileFrame(ctx.primary, gid) : null;
    if (frame === null || !this.textures.exists(frame.texture)) return;
    const sprite = this.add.sprite(
      ctx.poiCell(x, y),
      ctx.poiRow(x, y),
      frame.texture,
      frame.frame,
    );
    sprite.setOrigin(0.5, 0.5);
    sprite.setDisplaySize(ctx.tileSize, ctx.tileSize);
    sprite.setDepth(POI_DEPTH);
    sprite.setData("poiKind", kind);
    sprite.setData("poiId", poiId);
    this.renderedSprites.push(sprite);
  }

  private renderDoors(ctx: PoiRenderContext): void {
    const run = ctx.view.run;
    for (const door of ctx.view.doors) {
      const doorOpen =
        run.unlockedDoors.includes(door.id) || ctx.doorOpenIds.has(door.id);
      const gid = doorOpen ? door.usedTileGid : door.unusedTileGid;
      this.createPoiSprite(ctx, "door", door.x, door.y, gid, door.id);
      this.pushPoiInfo("door", door.x, door.y, gid, ctx.slotGridX, ctx.slotGridY);
      this.addPoiBadge(
        ctx.poiCell(door.x, door.y),
        ctx.poiRow(door.x, door.y),
        POI_BADGE_LETTER.door,
      );
    }
  }

  private renderChests(ctx: PoiRenderContext): void {
    for (const chest of ctx.view.chests) {
      const state = ctx.poiStateByKey.get(`chest:${chest.id}`) ?? "unused";
      const gid = state === "used" ? chest.usedTileGid : chest.unusedTileGid;
      this.createPoiSprite(ctx, "chest", chest.x, chest.y, gid, chest.id);
      this.pushPoiInfo("chest", chest.x, chest.y, gid, ctx.slotGridX, ctx.slotGridY);
      this.addPoiBadge(
        ctx.poiCell(chest.x, chest.y),
        ctx.poiRow(chest.x, chest.y),
        POI_BADGE_LETTER.chest,
      );
    }
  }

  private renderTraps(ctx: PoiRenderContext): void {
    for (const trap of ctx.view.traps) {
      const state = ctx.poiStateByKey.get(`trap:${trap.id}`) ?? "unused";
      if (state !== "used") continue;
      const gid = trap.usedTileGid;
      this.createPoiSprite(ctx, "trap", trap.x, trap.y, gid, trap.id);
      this.pushPoiInfo("trap", trap.x, trap.y, gid, ctx.slotGridX, ctx.slotGridY);
      this.addPoiBadge(
        ctx.poiCell(trap.x, trap.y),
        ctx.poiRow(trap.x, trap.y),
        POI_BADGE_LETTER.trap,
      );
    }
  }

  private renderTriggers(ctx: PoiRenderContext): void {
    for (const trigger of ctx.view.triggers) {
      if (!trigger.enabled) continue;
      const used = ctx.firedSet.has(trigger.id);
      const gid = used ? trigger.usedTileGid : trigger.unusedTileGid;
      if (gid === null) {
        // No tile picked for this lever — still surface it on top of the map.
        this.addPoiFallbackMarker(
          ctx.poiCell(trigger.x, trigger.y),
          ctx.poiRow(trigger.x, trigger.y),
          POI_BADGE_LETTER.trigger,
          FALLBACK_MARKER_COLOR.trigger,
        );
        this.pushPoiInfo("trigger", trigger.x, trigger.y, null, ctx.slotGridX, ctx.slotGridY);
        continue;
      }
      this.createPoiSprite(ctx, "trigger", trigger.x, trigger.y, gid, trigger.id);
      this.pushPoiInfo("trigger", trigger.x, trigger.y, gid, ctx.slotGridX, ctx.slotGridY);
      this.addPoiBadge(
        ctx.poiCell(trigger.x, trigger.y),
        ctx.poiRow(trigger.x, trigger.y),
        POI_BADGE_LETTER.trigger,
      );
    }
  }

  private renderBridges(ctx: PoiRenderContext): void {
    for (const bridge of ctx.view.bridges) {
      if (!bridge.enabled) continue;
      const down = ctx.bridgeDownKeys.has(`${bridge.x},${bridge.y}`);
      const gid = down ? bridge.downTileGid : bridge.upTileGid;
      if (gid === null) {
        this.addPoiFallbackMarker(
          ctx.poiCell(bridge.x, bridge.y),
          ctx.poiRow(bridge.x, bridge.y),
          POI_BADGE_LETTER.bridge,
          FALLBACK_MARKER_COLOR.bridge,
        );
        this.pushPoiInfo("bridge", bridge.x, bridge.y, null, ctx.slotGridX, ctx.slotGridY);
        continue;
      }
      this.createPoiSprite(ctx, "bridge", bridge.x, bridge.y, gid, bridge.id);
      this.pushPoiInfo("bridge", bridge.x, bridge.y, gid, ctx.slotGridX, ctx.slotGridY);
    }
  }

  private renderEncounters(ctx: PoiRenderContext): void {
    const run = ctx.view.run;
    for (const encounter of ctx.view.encounters) {
      if (run.defeatedEncounters.includes(encounter.id)) continue;
      if (encounter.difficulty === "boss") {
        const leader = encounter.digimon[0];
        if (leader === undefined) continue;
        const boss = this.spawnDigimonSprite(
          leader.catalogId,
          ctx.poiCell(encounter.x, encounter.y),
          ctx.poiRow(encounter.x, encounter.y),
          BOSS_DEPTH,
          run.currentX < encounter.x,
          "boss",
        );
        if (boss !== null) {
          boss.setData("poiKind", "boss");
          boss.setData("bossCatalogId", leader.catalogId);
        }
        this.pushPoiInfo("boss", encounter.x, encounter.y, leader.catalogId, ctx.slotGridX, ctx.slotGridY);
      } else {
        this.pushPoiInfo("encounter", encounter.x, encounter.y, null, ctx.slotGridX, ctx.slotGridY);
        this.addPoiBadge(
          ctx.poiCell(encounter.x, encounter.y),
          ctx.poiRow(encounter.x, encounter.y),
          POI_BADGE_LETTER.encounter,
        );
      }
    }
  }

  private renderItems(ctx: PoiRenderContext): void {
    const run = ctx.view.run;
    for (const item of ctx.view.items) {
      if (run.collectedItems.includes(item.id)) continue;
      this.pushPoiInfo("item", item.x, item.y, null, ctx.slotGridX, ctx.slotGridY);
      this.addPoiBadge(
        ctx.poiCell(item.x, item.y),
        ctx.poiRow(item.x, item.y),
        POI_BADGE_LETTER.item,
      );
    }
  }

  /**
   * Exit portals — the new (definitive-mode) way out of a dungeon. A warp with
   * `targetDungeonId === null` is the "return to the city" portal; a warp with
   * a target stays as a plain path marker. Drawn as a glowing swirl so players
   * read it as a destination, not a trap/chest. Walk onto it to leave (the
   * route handles the exit + dungeon-only item discard confirm).
   */
  private renderWarps(ctx: PoiRenderContext): void {
    for (const warp of ctx.view.warps) {
      const cx = ctx.poiCell(warp.x, warp.y);
      const cy = ctx.poiRow(warp.x, warp.y);
      const isExit = warp.targetDungeonId === null;
      const color = isExit ? 0xe6001f : 0x8a877f;
      const r = this.tileSize * 0.42;

      const outer = this.add.ellipse(cx, cy, r * 2, r * 2.4, color, 0.16);
      outer.setStrokeStyle(2, color, 0.9);
      outer.setDepth(POI_DEPTH - 1);
      this.renderedSprites.push(outer as unknown as Phaser.GameObjects.Sprite);

      const inner = this.add.ellipse(cx, cy, r * 1.1, r * 1.3, color, 0.45);
      inner.setDepth(POI_DEPTH - 1);
      this.renderedSprites.push(inner as unknown as Phaser.GameObjects.Sprite);

      // Gentle pulse so the portal reads as alive/interactive.
      this.tweens.add({
        targets: [outer, inner],
        scaleX: { from: 0.92, to: 1.08 },
        scaleY: { from: 0.92, to: 1.08 },
        alpha: { from: 0.7, to: 1 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });

      this.pushPoiInfo("warp", warp.x, warp.y, warp.id, ctx.slotGridX, ctx.slotGridY);
      if (isExit) {
        const label = this.add.text(cx, cy - this.tileSize * 0.62, "CIDADE", {
          fontFamily: "monospace",
          fontSize: "9px",
          color: "#f4f1ea",
          backgroundColor: "rgba(230,0,31,0.85)",
          padding: { x: 4, y: 2 },
        });
        label.setOrigin(0.5, 1);
        label.setDepth(MARKER_DEPTH);
        this.renderedTexts.push(label);
      }
    }
  }

  /**
   * Visible, always-on-top fallback marker for a POI whose tile GID is missing
   * (e.g. a lever trigger / bridge the admin placed without picking a tile).
   * Draws a translucent colored tile + letter at POI_DEPTH so the POI is
   * unmistakably on the map surface, above grass/floor/liquid/water.
   */
  private addPoiFallbackMarker(
    x: number,
    y: number,
    letter: string,
    color: number,
  ): void {
    const rect = this.add.rectangle(
      x,
      y,
      this.tileSize * 0.9,
      this.tileSize * 0.9,
      color,
      0.55,
    );
    rect.setStrokeStyle(2, color, 1);
    rect.setDepth(POI_DEPTH);
    rect.setData("poiBadge", letter);
    this.renderedSprites.push(rect as unknown as Phaser.GameObjects.Sprite);
    this.addPoiBadge(x, y, letter);
  }

  private addPoiBadge(x: number, y: number, letter: string): void {
    const text = this.add.text(x, y, letter, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#ffffff",
      backgroundColor: "rgba(28,31,42,0.8)",
      padding: { x: 2, y: 1 },
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(MARKER_DEPTH);
    text.setData("poiBadge", letter);
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
    if (x < 0 || y < 0 || x >= view.dungeon.width || y >= view.dungeon.height)
      return;
    // Remote-player hit test: only players standing on the CURRENT map slot
    // match — neighbor slots share the same x/y cell space, so the grid
    // coords disambiguate (mirrors renderWorld's activeSlotOrigin math).
    const onPlayerClick = props.onPlayerClick;
    if (onPlayerClick !== undefined) {
      const activeGridX = view.dungeon.gridX ?? 0;
      const activeGridY = view.dungeon.gridY ?? 0;
      const remote = props.remotePlayers.find(
        (player) =>
          player.x === x &&
          player.y === y &&
          player.gridX === activeGridX &&
          player.gridY === activeGridY,
      );
      if (remote !== undefined) {
        onPlayerClick(remote.userId, remote.displayName, x, y);
        return;
      }
    }
    const run = view.run;
    if (run.currentX === x && run.currentY === y) return;
    if (Math.abs(x - run.currentX) + Math.abs(y - run.currentY) !== 1) return;
    if (!this.isCellWalkable(view, x, y)) return;
    props.onCellClick(x, y);
  }

  /**
   * Whether the player may step onto a cell: it has at least one walkable
   * terrain tile and no non-walkable (obstacle) tile, OR a bridge currently
   * lowered by a fired lever sits there. Extracted from the inline pointer
   * handler so the same rule can be reused / unit-tested.
   */
  private isCellWalkable(
    view: DungeonRunView,
    x: number,
    y: number,
  ): boolean {
    const cellTiles = view.tiles.filter((tile) => tile.x === x && tile.y === y);
    const hasWalkable = cellTiles.some((tile) =>
      (WALKABLE_LAYER_KINDS as readonly string[]).includes(tile.layerKind),
    );
    const hasObstacle = cellTiles.some(
      (tile) =>
        !(WALKABLE_LAYER_KINDS as readonly string[]).includes(tile.layerKind),
    );
    const bridgeDown = view.bridges.some(
      (bridge) =>
        bridge.enabled &&
        bridge.x === x &&
        bridge.y === y &&
        view.firedTriggerIds.some((tid) =>
          view.triggers.some(
            (trigger) =>
              trigger.id === tid &&
              trigger.targets.some(
                (target) =>
                  target.kind === "bridge" && target.bridgeId === bridge.id,
              ),
          ),
        ),
    );
    return (hasWalkable && !hasObstacle) || bridgeDown;
  }
}
