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
 * Locate the tileset that owns a given Global Tile ID. Tiled stacks
 * tilesets by ascending `firstgid`; the owning tileset is the one whose
 * `firstgid` is the greatest `<= gid` AND that still contains the tile.
 * Empty tile (`gid <= 0` in Tiled) has no owning tileset.
 */
export function findTilesetForGid(
  gid: number,
  tilesets: readonly TilesetGrant[],
): TilesetGrant | null {
  if (gid <= 0) return null;
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid);
  for (const ts of sorted) {
    if (gid >= ts.firstgid && gid < ts.firstgid + ts.tileCount) return ts;
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
 * `(col, row) = (localIndex % columns, floor(localIndex / columns))`, times
 * (tileWidth, tileHeight). Return `null` when the GID is outside the
 * tileset's range — caller should skip drawing.
 */
export function gidToSpritePosition(gid: number, tileset: TilesetGrant): SpritePosition | null {
  if (gid <= 0) return null;
  const localIndex = gid - tileset.firstgid;
  if (localIndex < 0 || localIndex >= tileset.tileCount) return null;
  const col = localIndex % tileset.columns;
  const row = Math.floor(localIndex / tileset.columns);
  return { x: col * tileset.tileWidth, y: row * tileset.tileHeight };
}
