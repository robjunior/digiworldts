import Phaser from 'phaser';

import {
  TILED_GID_FLIP_D,
  TILED_GID_FLIP_H,
  TILED_GID_FLIP_V,
  findTilesetForGid,
  stripTiledGidFlags,
} from '@digiworld/shared';
import type { TilesetGrant } from '@digiworld/shared';
import { decodeGifFrames } from './gif';

/**
 * Phaser texture pipeline for Tiled tilesets (Todo 2 of the dungeon-to-phaser
 * plan). This module is the single place that turns a `TilesetGrant` (image
 * URL + tile geometry + firstgid) into Phaser textures and frames, and it
 * LOCKs the API that the tilemap render (Todo 3), party sprites (Todo 5) and
 * POI overlays (Todo 6) consume:
 *
 *   - `tilesetKey(grant)` — stable texture key per grant (`ts-<grant.id>`).
 *   - `preloadTilesets(scene, grants)` — queue `load.image` per unique grant,
 *     never loading the same image twice.
 *   - `registerTilesets(scene, grants)` — after load, register each sprite
 *     sheet (margin/spacing aware) so frames `0..tileCount-1` exist.
 *   - `tileFrame(grant, gid)` / `tileFrameForGid(gid, grants)` — map a Tiled
 *     GID to `{ texture, frame }`, used for the POI/sprite overlay path ONLY
 *     (NOT for tilemap layers — those use bare GIDs + `registerTilesetsOnTilemap`).
 *   - `registerTilesetsOnTilemap(map, grants)` — the tilemap-path contract:
 *     register each grant via `addTilesetImage(..., firstgid)` so layer data
 *     arrays holding BARE GIDs resolve through tileset firstgid spaces.
 *   - `bareGidForTile(rawGid)` / `applyTiledFlips(tile, rawGid)` — strip Tiled
 *     flag bits and re-apply flipX/flipY/rotation per tile AFTER placement.
 *   - `preloadDigimonDot(scene, catalogId)` — shared digimon dot loader
 *     (Todo 5/6 party + boss sprites), deduped by catalogId.
 *   - `markTextureLoadFailed(scene, key)` / `isTextureAbandoned(textures, key)` —
 *     retry budget: each failed load quarantines the key for FAILED_RETRY_MS;
 *     after `MAX_TEXTURE_RETRIES` failures the key is abandoned, no further
 *     loads are queued, and callers fall back to flat rendering.
 *
 * All GID math is imported from `@digiworld/shared` — never duplicated here.
 */

/**
 * Stable Phaser texture key for a tileset grant. Also the key the image is
 * loaded under (`load.image`) and the key registered as the spritesheet, so
 * the tilemap path can reference it via `addTilesetImage` by name.
 */
export function tilesetKey(grant: TilesetGrant): string {
  return `ts-${grant.id}`;
}

/** Stable Phaser texture key for a digimon dot GIF. */
export function digimonDotKey(catalogId: string): string {
  return `dot-${catalogId}`;
}

/** Stable Phaser texture key for a digimon's 2×2 four-frame sprite sheet. */
export function digimonSheetKey(catalogId: string): string {
  return `sheet-${catalogId}`;
}

/** Anim key for the sheet's walk cycle (top row, frames 0→1, looped). */
export function sheetWalkAnimKey(catalogId: string): string {
  return `sheet-walk-${catalogId}`;
}

/** Anim key for the sheet's hit cycle (bottom row, frames 2→3, looped). */
export function sheetHitAnimKey(catalogId: string): string {
  return `sheet-hit-${catalogId}`;
}

/** Anim key for the sheet's take-hit pose (frame 2, single frame). */
export function sheetTakeHitAnimKey(catalogId: string): string {
  return `sheet-takehit-${catalogId}`;
}

/** Anim key for the sheet's attack pose (frame 3, single frame). */
export function sheetAttackAnimKey(catalogId: string): string {
  return `sheet-attack-${catalogId}`;
}

/**
 * Per-TextureManager bookkeeping for the texture pipeline. A key lives in one
 * of three states beyond "not requested":
 *
 *  - `pendingTextures`: queued for load right now, not yet settled by the
 *    loader. Guards against queueing the same image twice while a load is
 *    in flight.
 *  - `failedTextures`: a previous load ERRORED (404, network, ...) and the
 *    image never landed in the texture manager. The key is quarantined for
 *    FAILED_RETRY_MS so a permanently-broken URL cannot re-queue (and re-fail)
 *    in a hot loop, but a transient failure is retried on a later pass
 *    instead of wedging the pipeline forever.
 *  - loaded: no bookkeeping needed — `textures.exists()` covers it.
 *
 * A fresh Phaser.Game has a fresh TextureManager, so neither map leaks stale
 * state across games.
 */
const FAILED_RETRY_MS = 30_000;

/** Max retries (attempts beyond the initial load) per key per scene lifetime before giving up. */
export const MAX_TEXTURE_RETRIES = 2;

type FailedEntry = { readonly failedAt: number; readonly retries: number };

const pendingTextures = new WeakMap<Phaser.Textures.TextureManager, Set<string>>();
const failedTextures = new WeakMap<Phaser.Textures.TextureManager, Map<string, FailedEntry>>();

/** Claim a texture key as queued (in-flight). False when it is already pending. */
function claimPending(textures: Phaser.Textures.TextureManager, key: string): boolean {
  let set = pendingTextures.get(textures);
  if (!set) {
    set = new Set();
    pendingTextures.set(textures, set);
  }
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** True while `key` is quarantined after a failed load (still within the retry window). */
function isQuarantined(textures: Phaser.Textures.TextureManager, key: string, now: number): boolean {
  const entry = failedTextures.get(textures)?.get(key);
  if (entry === undefined) return false;
  return now - entry.failedAt < FAILED_RETRY_MS;
}

/**
 * True once a key has exhausted its retry budget: the pipeline gives up, stops
 * queueing further loads, and callers fall back to flat rendering.
 */
export function isTextureAbandoned(textures: Phaser.Textures.TextureManager, key: string): boolean {
  const entry = failedTextures.get(textures)?.get(key);
  return entry !== undefined && entry.retries > MAX_TEXTURE_RETRIES;
}

/**
 * Report a queued texture load that failed — the key's image never landed in
 * the texture manager (404, network error, ...). Releases the in-flight claim
 * and quarantines the key for FAILED_RETRY_MS. Call from the loader's COMPLETE
 * handler for every key that was queued but is still missing afterwards —
 * never from the queueing path itself.
 */
export function markTextureLoadFailed(scene: Phaser.Scene, key: string): void {
  const textures = scene.textures;
  pendingTextures.get(textures)?.delete(key);
  let failed = failedTextures.get(textures);
  if (!failed) {
    failed = new Map();
    failedTextures.set(textures, failed);
  }
  const prev = failed.get(key);
  failed.set(key, { failedAt: Date.now(), retries: (prev?.retries ?? 0) + 1 });
}

/**
 * Queue the tileset images for a scene's loader. Dedupes by grant id (same
 * grant listed twice is queued once), skips grants whose texture is already
 * in the manager (previous scene of the same game), skips keys still pending
 * (in-flight from an earlier queue), and skips keys quarantined after a
 * failed load — so the same image is never loaded twice, and a broken URL is
 * retried only after FAILED_RETRY_MS.
 *
 * Returns the texture keys actually queued by this call — empty when every
 * grant is already loaded, pending, or quarantined (so a caller can tell a
 * real in-flight load apart from a re-queue that would spin forever).
 */
export function preloadTilesets(scene: Phaser.Scene, grants: readonly TilesetGrant[]): readonly string[] {
  const textures = scene.textures;
  const now = Date.now();
  const seen = new Set<string>();
  const queued: string[] = [];
  for (const grant of grants) {
    if (seen.has(grant.id)) continue;
    seen.add(grant.id);
    const key = tilesetKey(grant);
    if (textures.exists(key)) continue;
    if (isTextureAbandoned(textures, key)) continue;
    if (isQuarantined(textures, key, now)) continue;
    if (!claimPending(textures, key)) continue;
    scene.load.image(key, grant.imageUrl);
    queued.push(key);
  }
  return queued;
}

/**
 * Register one grant's spritesheet frames on the loaded image texture.
 * Idempotent: once frames exist (`0..tileCount-1`) a second call is a no-op.
 * The Phaser `addSpriteSheet` source is the Texture instance itself (the key
 * stays `tilesetKey(grant)`), and margin/spacing are honoured by the parser.
 */
export function registerTilesetSpriteSheet(scene: Phaser.Scene, grant: TilesetGrant): void {
  const key = tilesetKey(grant);
  const texture = scene.textures.get(key);
  if (!texture || !texture.source.length) return;
  if (texture.has('0')) return;
  scene.textures.addSpriteSheet(key, texture, {
    frameWidth: grant.tileWidth,
    frameHeight: grant.tileHeight,
    margin: grant.margin,
    spacing: grant.spacing,
    startFrame: 0,
    endFrame: grant.tileCount - 1,
  });
}

/**
 * Register every grant's spritesheet. Call AFTER the scene's loader finished
 * (load COMPLETE event), so each loaded image has its frames parsed.
 */
export function registerTilesets(scene: Phaser.Scene, grants: readonly TilesetGrant[]): void {
  for (const grant of grants) registerTilesetSpriteSheet(scene, grant);
}

/**
 * Map a Tiled GID to a Phaser texture + frame index, for a grant that owns
 * the GID. Returns `null` (never throws) when the GID is empty, carries no
 * bare id, or falls outside the grant's range. Frame index = bare gid minus
 * the grant's `firstgid` (frames are registered 0..tileCount-1).
 *
 * Used for the POI/sprite overlay path ONLY. For tilemap layers the data
 * array holds bare GIDs and `registerTilesetsOnTilemap` handles resolution.
 */
export function tileFrame(grant: TilesetGrant, gid: number): { readonly texture: string; readonly frame: number } | null {
  if (gid <= 0) return null;
  const bareGid = stripTiledGidFlags(gid);
  if (bareGid <= 0) return null;
  if (bareGid < grant.firstgid || bareGid >= grant.firstgid + grant.tileCount) return null;
  return { texture: tilesetKey(grant), frame: bareGid - grant.firstgid };
}

/**
 * Resolve the owning grant via `findTilesetForGid`, then map the GID to a
 * texture + frame. Returns `null` (never throws) when no tileset in the set
 * owns the GID — e.g. a GID outside every tileset's range.
 */
export function tileFrameForGid(
  gid: number,
  grants: readonly TilesetGrant[],
): { readonly texture: string; readonly frame: number } | null {
  if (gid <= 0) return null;
  const grant = findTilesetForGid(gid, grants);
  if (grant === null) return null;
  return tileFrame(grant, gid);
}

/**
 * Tilemap-path contract (locked here for Todo 3): register every grant on the
 * tilemap so layer data arrays holding BARE GIDs resolve through the tileset's
 * firstgid space. `addTilesetImage` takes the texture key as both tileset name
 * and source key; width/height/margin/spacing/firstgid come from the grant.
 */
export function registerTilesetsOnTilemap(
  map: Phaser.Tilemaps.Tilemap,
  grants: readonly TilesetGrant[],
): void {
  for (const grant of grants) {
    map.addTilesetImage(
      tilesetKey(grant),
      tilesetKey(grant),
      grant.tileWidth,
      grant.tileHeight,
      grant.margin,
      grant.spacing,
      grant.firstgid,
    );
  }
}

/** Strip the Tiled flip/rotation flag bits from a raw GID, leaving the bare tile id. */
export function bareGidForTile(rawGid: number): number {
  return stripTiledGidFlags(rawGid);
}

export type TiledFlipState = {
  /** Rotation in radians (Phaser convention — clockwise in screen space). */
  readonly rotation: number;
  /** Horizontal mirror (Phaser flipX). Phaser never derives flipY from GID flags. */
  readonly flipped: boolean;
};

/**
 * Decode the Tiled flip/rotation flags from a raw GID using Phaser's
 * canonical ParseGID 8-case table (`phaser/src/tilemaps/parsers/tiled/ParseGID.js`):
 * the H/V/D bits are NOT independent — each combination collapses into a
 * single rotation (radians, clockwise-positive in screen space) plus one
 * horizontal-mirror flag. This is visually identical to Tiled's own
 * `CellRenderer::render` (and thus the shared `tiledGidTransform` the DOM
 * grid used), but expressed the way Phaser's tile + sprite renderers apply it.
 */
export function tiledFlipBits(rawGid: number): TiledFlipState {
  const flipH = (rawGid & TILED_GID_FLIP_H) !== 0;
  const flipV = (rawGid & TILED_GID_FLIP_V) !== 0;
  const flipD = (rawGid & TILED_GID_FLIP_D) !== 0;
  const HALF_PI = Math.PI / 2;
  // ParseGID case order (H, V, D):
  if (flipH && flipV && flipD) return { rotation: HALF_PI, flipped: true };
  if (flipH && flipV) return { rotation: Math.PI, flipped: false };
  if (flipH && flipD) return { rotation: HALF_PI, flipped: false };
  if (flipH) return { rotation: 0, flipped: true };
  if (flipV && flipD) return { rotation: 3 * HALF_PI, flipped: false };
  if (flipV) return { rotation: Math.PI, flipped: true };
  if (flipD) return { rotation: 3 * HALF_PI, flipped: true };
  return { rotation: 0, flipped: false };
}

/**
 * Re-apply Tiled flip flags to an already-placed tile. Call AFTER
 * `putTileAt`/layer creation with the tile's BARE gid — the data array must
 * never hold flagged gids, the flags are applied here on the Phaser Tile.
 * `Tile.rotation` is in RADIANS (same as `ParseTileLayers`), so the ParseGID
 * rotation is written directly; flipY is always false per Phaser semantics.
 */
export function applyTiledFlips(tile: Phaser.Tilemaps.Tile, rawGid: number): void {
  const flip = tiledFlipBits(rawGid);
  tile.rotation = flip.rotation;
  tile.flipX = flip.flipped;
  tile.flipY = false;
}

/**
 * Load a digimon dot GIF as a texture (`dot-<catalogId>`, URL
 * `/assets/digimon/:catalogId/dot.gif`) — shared by the party + boss sprite
 * paths (Todo 5/6). Deduped by catalogId (loaded, pending, or quarantined);
 * returns the texture key to use when creating sprites. The gif is loaded
 * as binary so `buildDotTexture` can decode its walk frames — Phaser only
 * renders the first frame of an animated gif on its own.
 */
export function preloadDigimonDot(scene: Phaser.Scene, catalogId: string): string {
  const key = digimonDotKey(catalogId);
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  if (isTextureAbandoned(textures, key)) return key;
  if (isQuarantined(textures, key, Date.now())) return key;
  if (!claimPending(textures, key)) return key;
  scene.load.binary(key, `/assets/digimon/${encodeURIComponent(catalogId)}/dot.gif`, Uint8Array);
  return key;
}

/** Anim key for a dot walk cycle (2 frames, looped). */
export function dotAnimKey(catalogId: string): string {
  return `dot-anim-${catalogId}`;
}

/**
 * Build the dot texture from the binary gif cache: decode the frames, stack
 * them side by side as a spritesheet texture, and register the looped walk
 * anim. Returns false when the binary is missing or the gif is not
 * decodable (caller falls back to the static first-frame path).
 */
export function buildDotTexture(scene: Phaser.Scene, catalogId: string): boolean {
  const key = digimonDotKey(catalogId);
  if (scene.textures.exists(key)) return true;
  const raw = scene.cache.binary.get(key);
  if (!(raw instanceof Uint8Array)) return false;
  const decoded = decodeGifFrames(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  if (decoded === null || decoded.frames.length === 0) return false;
  const canvas = document.createElement('canvas');
  canvas.width = decoded.width * decoded.frames.length;
  canvas.height = decoded.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return false;
  decoded.frames.forEach((frame, i) => ctx.putImageData(frame, i * decoded.width, 0));
  const texture = scene.textures.addCanvas(key, canvas);
  if (texture === null) return false;
  decoded.frames.forEach((_, i) => texture.add(i, 0, i * decoded.width, 0, decoded.width, decoded.height));
  if (!scene.anims.exists(dotAnimKey(catalogId))) {
    scene.anims.create({
      key: dotAnimKey(catalogId),
      frames: decoded.frames.map((_, i) => ({ key, frame: i })),
      frameRate: Math.max(1, Math.round(1000 / Math.max(40, decoded.delayMs))),
      repeat: -1,
    });
  }
  return true;
}

/**
 * Static fallback for undecodable gifs: load the image through the DOM
 * (browser renders the first frame) and register it as a plain texture.
 * `onLoaded` fires once the texture exists.
 */
export function fallbackStaticDot(scene: Phaser.Scene, catalogId: string, onLoaded: () => void): void {
  const key = digimonDotKey(catalogId);
  if (scene.textures.exists(key)) {
    onLoaded();
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
    onLoaded();
  };
  img.src = `/assets/digimon/${encodeURIComponent(catalogId)}/dot.gif`;
}

/**
 * Load a digimon's 2×2 four-frame sprite sheet (`/assets/sprites/<id>.png`) and
 * register its walk (top row, looped) + hit (bottom row, looped) anims. This is
 * the dungeon's preferred digimon display: it uses the same generated sheet as
 * the 3D combat/pen rig. Falls back to the legacy GIF dot when the sheet is
 * missing.
 */
export function preloadDigimonSheet(scene: Phaser.Scene, catalogId: string): string {
  const key = digimonSheetKey(catalogId);
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  if (isTextureAbandoned(textures, key)) return key;
  if (isQuarantined(textures, key, Date.now())) return key;
  if (!claimPending(textures, key)) return key;
  const numeric = catalogId.replace(/^skb-/, '');
  scene.load.image(key, `/assets/sprites/${encodeURIComponent(numeric)}.png`);
  return key;
}

/**
 * Build the sheet's walk + hit anims from the loaded image. Returns false when
 * the texture never landed (caller falls back to the GIF dot path).
 *
 * Generated sheets are a 2x2 grid of 32x32 px frames (a 64x64 image). Each
 * cell is one full digimon frame; slice the cells apart so the digimon renders
 * as ONE sprite, not a 2x2 block of four. Frame semantics (documented in
 * scene3d sprite-rig): 0,1 = walk cycle (top row, bob A / bob B); 2 = take-hit
 * (bottom-left); 3 = attack (bottom-right).
 */
export function buildDigimonSheet(scene: Phaser.Scene, catalogId: string): boolean {
  const key = digimonSheetKey(catalogId);
  if (scene.textures.exists(key)) {
    const texture = scene.textures.get(key);
    const src = texture.getSourceImage() as { width?: number; height?: number };
    const w = src?.width ?? 64;
    const h = src?.height ?? 64;
    const FRAME = 16;
    const cols = Math.max(1, Math.floor(w / FRAME));
    const rows = Math.max(1, Math.floor(h / FRAME));
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = String(row * cols + col);
        const frameY = row * cellH;
        if (!texture.has(idx)) texture.add(idx, 0, col * cellW, frameY, cellW, cellH);
      }
    }
    if (!scene.anims.exists(sheetWalkAnimKey(catalogId))) {
      scene.anims.create({
        key: sheetWalkAnimKey(catalogId),
        frames: [
          { key, frame: '0' },
          { key, frame: '1' },
        ],
        frameRate: 3,
        repeat: -1,
      });
    }
    // Frame 2 (row 1, col 0) = taking hit (defender recoil). Single frame, no loop.
    if (!scene.anims.exists(sheetTakeHitAnimKey(catalogId))) {
      scene.anims.create({
        key: sheetTakeHitAnimKey(catalogId),
        frames: [{ key, frame: '2' }],
        frameRate: 1,
        repeat: 0,
      });
    }
    // Frame 3 (row 1, col 1) = giving hit / attacking (attacker strike). Single frame, no loop.
    if (!scene.anims.exists(sheetAttackAnimKey(catalogId))) {
      scene.anims.create({
        key: sheetAttackAnimKey(catalogId),
        frames: [{ key, frame: '3' }],
        frameRate: 1,
        repeat: 0,
      });
    }
    return true;
  }
  return false;
}

/**
 * Ensure a digimon's sheet texture + anims exist, trying the sheet first and
 * falling back to the legacy GIF dot when the sheet 404s. `onSettled` reports
 * which path resolved so callers know which key/anim to play.
 */
export type DigimonSpriteLoad =
  | { readonly kind: 'sheet'; readonly key: string; readonly walkAnim: string; readonly hitAnim: string; readonly takeHitAnim: string; readonly attackAnim: string }
  | { readonly kind: 'dot'; readonly key: string; readonly walkAnim: string }
  | { readonly kind: 'none' };

export function ensureDigimonSpriteLoaded(
  scene: Phaser.Scene,
  catalogId: string,
  onSettled: (result: DigimonSpriteLoad) => void,
): void {
  const sheetKey = digimonSheetKey(catalogId);
  if (scene.textures.exists(sheetKey)) {
    if (!scene.anims.exists(sheetWalkAnimKey(catalogId))) buildDigimonSheet(scene, catalogId);
    onSettled({
      kind: 'sheet',
      key: sheetKey,
      walkAnim: sheetWalkAnimKey(catalogId),
      hitAnim: sheetHitAnimKey(catalogId),
      takeHitAnim: sheetTakeHitAnimKey(catalogId),
      attackAnim: sheetAttackAnimKey(catalogId),
    });
    return;
  }
  if (scene.textures.exists(digimonDotKey(catalogId))) {
    onSettled({ kind: 'dot', key: digimonDotKey(catalogId), walkAnim: dotAnimKey(catalogId) });
    return;
  }

  let sheetTried = false;
  let dotTried = false;

  const tryDot = (): void => {
    if (dotTried) return;
    dotTried = true;
    const dotKey = preloadDigimonDot(scene, catalogId);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (scene.textures.exists(dotKey) && buildDotTexture(scene, catalogId)) {
        onSettled({ kind: 'dot', key: dotKey, walkAnim: dotAnimKey(catalogId) });
      } else {
        fallbackStaticDot(scene, catalogId, () => {
          if (scene.textures.exists(dotKey)) buildDotTexture(scene, catalogId);
          onSettled({ kind: 'dot', key: dotKey, walkAnim: dotAnimKey(catalogId) });
        });
        markTextureLoadFailed(scene, dotKey);
      }
    });
    scene.load.start();
  };

  const trySheet = (): void => {
    if (sheetTried) return;
    sheetTried = true;
    const key = preloadDigimonSheet(scene, catalogId);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (scene.textures.exists(key) && buildDigimonSheet(scene, catalogId)) {
        onSettled({
          kind: 'sheet',
          key,
          walkAnim: sheetWalkAnimKey(catalogId),
          hitAnim: sheetHitAnimKey(catalogId),
          takeHitAnim: sheetTakeHitAnimKey(catalogId),
          attackAnim: sheetAttackAnimKey(catalogId),
        });
      } else {
        markTextureLoadFailed(scene, key);
        tryDot();
      }
    });
    scene.load.start();
  };

  trySheet();
}
