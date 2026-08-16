import Phaser from 'phaser';

import {
  TILED_GID_FLIP_D,
  TILED_GID_FLIP_H,
  TILED_GID_FLIP_V,
  findTilesetForGid,
  stripTiledGidFlags,
} from '@digiworld/shared';
import type { TilesetGrant } from '@digiworld/shared';

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
 * returns the texture key to use when creating sprites.
 */
export function preloadDigimonDot(scene: Phaser.Scene, catalogId: string): string {
  const key = digimonDotKey(catalogId);
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  if (isTextureAbandoned(textures, key)) return key;
  if (isQuarantined(textures, key, Date.now())) return key;
  if (!claimPending(textures, key)) return key;
  scene.load.image(key, `/assets/digimon/${encodeURIComponent(catalogId)}/dot.gif`);
  return key;
}
