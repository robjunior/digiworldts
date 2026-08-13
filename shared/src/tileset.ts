/**
 * Tileset library — shared image sprites referenced by dungeons via the
 * Tiled importer. A `Tileset` is a spritesheet PNG stored server-side; each
 * dungeon that uses a tileset joins it via `dungeon_tilesets` at a specific
 * `firstgid` (the base Global Tile ID at which this tileset's tiles start
 * within that dungeon's GID space).
 */

export type Tileset = {
  readonly id: string;
  readonly name: string;
  /** Original filename the admin uploaded (informational). */
  readonly imageFilename: string;
  /** Server-side path the browser fetches the spritesheet from. */
  readonly imageUrl: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly columns: number;
  readonly tileCount: number;
  /** Space in pixels between adjacent tiles in the spritesheet. */
  readonly spacing: number;
  /** Space in pixels around the border of the spritesheet. */
  readonly margin: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DungeonTilesetRef = {
  readonly tilesetId: string;
  readonly firstgid: number;
};

/**
 * Denormalized view — a tileset joined with its `firstgid` for one dungeon.
 * This is what the frontend renderer needs: image URL + geometry + the base
 * GID to translate a per-tile GID into a sub-image.
 */
export type TilesetGrant = Tileset & {
  readonly firstgid: number;
};

export type TilesetListResponse = { readonly tilesets: readonly Tileset[] };
export type TilesetResponse = { readonly tileset: Tileset };

export type TilesetUploadInput = {
  readonly name: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
};

/**
 * Tiled GID flag bits. The highest four bits of a 32-bit Global Tile ID are
 * used for flip/rotation flags; the remaining 28 bits are the actual tile id.
 * Reference: https://doc.mapeditor.org/en/stable/reference/global-tile-ids/
 */
export const TILED_GID_FLAG_MASK = 0x0fffffff;
export const TILED_GID_FLIP_H = 0x80000000;
export const TILED_GID_FLIP_V = 0x40000000;
export const TILED_GID_FLIP_D = 0x20000000;
export const TILED_GID_ROTATED_HEX_120 = 0x10000000;

/** Strip the flip/rotation flag bits from a raw Tiled GID, leaving the bare tile id. */
export function stripTiledGidFlags(gid: number): number {
  return gid & TILED_GID_FLAG_MASK;
}

/**
 * Convert the flip/rotation flags embedded in a raw Tiled GID into a CSS
 * `transform` string. The empty string means no transform.
 *
 * Mirrors Tiled's own `CellRenderer::render` (src/libtiled/maprenderer.cpp):
 * an anti-diagonal flip is rendered as a 90°-clockwise rotation followed by
 * an axis-mirror pair derived from the H/V flags (`H' = V`, `V' = !H`);
 * without it the H/V flags map directly to axis mirrors. CSS transform
 * functions compose left-to-right, so the order below is already in
 * per-function application order.
 */
export function tiledGidTransform(gid: number): string {
  const flipH = (gid & TILED_GID_FLIP_H) !== 0;
  const flipV = (gid & TILED_GID_FLIP_V) !== 0;
  const flipD = (gid & TILED_GID_FLIP_D) !== 0;
  if (!flipD) {
    const parts: string[] = [];
    if (flipH) parts.push('scaleX(-1)');
    if (flipV) parts.push('scaleY(-1)');
    return parts.join(' ');
  }
  const parts: string[] = ['rotate(90deg)'];
  if (flipV) parts.push('scaleX(-1)');
  if (!flipH) parts.push('scaleY(-1)');
  return parts.join(' ');
}

/**
 * Locate the tileset that owns a given Global Tile ID. Tiled stacks
 * tilesets by ascending `firstgid`; the owning tileset is the one whose
 * `firstgid` is the greatest `<= gid` AND that still contains the tile.
 * Empty tile (`gid <= 0` in Tiled) has no owning tileset.
 *
 * `gid` may include Tiled flip/rotation flag bits; they are stripped before
 * resolving the tileset.
 */
export function findTilesetForGid(
  gid: number,
  tilesets: readonly TilesetGrant[],
): TilesetGrant | null {
  if (gid <= 0) return null;
  const bareGid = stripTiledGidFlags(gid);
  if (bareGid <= 0) return null;
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid);
  for (const ts of sorted) {
    if (bareGid >= ts.firstgid && bareGid < ts.firstgid + ts.tileCount) return ts;
  }
  return null;
}

export type SpritePosition = {
  readonly x: number;
  readonly y: number;
};

/**
 * Compute the pixel offset within the tileset spritesheet for the sub-image
 * that renders `gid`. Row-major layout: `localIndex = gid - firstgid`, then
 * `(col, row) = (localIndex % columns, floor(localIndex / columns))`. The
 * final pixel offset accounts for Tiled `spacing` (gap between tiles) and
 * `margin` (gap around the sheet border). Return `null` when the GID is
 * outside the tileset's range — caller should skip drawing.
 */
export function gidToSpritePosition(gid: number, tileset: TilesetGrant): SpritePosition | null {
  if (gid <= 0) return null;
  const bareGid = stripTiledGidFlags(gid);
  if (bareGid <= 0) return null;
  const localIndex = bareGid - tileset.firstgid;
  if (localIndex < 0 || localIndex >= tileset.tileCount) return null;
  const col = localIndex % tileset.columns;
  const row = Math.floor(localIndex / tileset.columns);
  const spacing = tileset.spacing ?? 0;
  const margin = tileset.margin ?? 0;
  return {
    x: margin + col * (tileset.tileWidth + spacing),
    y: margin + row * (tileset.tileHeight + spacing),
  };
}
