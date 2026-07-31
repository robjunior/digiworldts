import type { CSSProperties } from 'react';

import type { TilesetGrant } from '@digiworld/shared';
import { findTilesetForGid, gidToSpritePosition } from '@digiworld/shared';

/**
 * Compute the CSS `background-*` cluster that paints the sprite for a
 * dungeon tile whose Global Tile ID is `gid`, against the joined tileset
 * set for that dungeon. Returns `null` when no tileset owns this GID —
 * caller should keep the fallback walkable CSS style. `imageRendering:
 * pixelated` preserves the crisp pixel look on any zoom level.
 *
 * `scale` maps the sprite's natural pixel size to the actual rendered cell
 * size (e.g. `scale=3` on a 32px tile draws it at 96px, filling a 96×96
 * cell). Everything — spritesheet size AND sub-image offset — scales
 * together, so a GID always lands its sub-tile top-left-aligned to the
 * cell regardless of zoom.
 */
export function gidCellStyle(gid: number, tilesets: readonly TilesetGrant[], scale = 1): CSSProperties | null {
  const tileset = findTilesetForGid(gid, tilesets);
  if (!tileset) return null;
  const pos = gidToSpritePosition(gid, tileset);
  if (!pos) return null;
  return {
    backgroundImage: `url("${tileset.imageUrl}")`,
    backgroundPosition: `-${pos.x * scale}px -${pos.y * scale}px`,
    backgroundSize: `${tileset.imageWidth * scale}px ${tileset.imageHeight * scale}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  };
}

/**
 * Pick the first (lowest-firstgid) tileset in a set — its `tileWidth`
 * defines the canonical native tile size for a dungeon. Used by the
 * DungeonGrid to compute cellSize = tileWidth × zoomFactor. Returns
 * `null` when the dungeon has no tilesets (unimported/legacy dungeons).
 */
export function primaryTileset(tilesets: readonly TilesetGrant[]): TilesetGrant | null {
  if (tilesets.length === 0) return null;
  let best = tilesets[0]!;
  for (const t of tilesets) if (t.firstgid < best.firstgid) best = t;
  return best;
}
