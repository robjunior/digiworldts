import type { TilesetGrant } from '@digiworld/shared';

/**
 * Pick the first (lowest-firstgid) tileset in a set — its `tileWidth`
 * defines the canonical native tile size for a dungeon. Used by the
 * DungeonPhaserScene to compute the active tile size and the sprite
 * scale for entity sprites. Returns `null` when the dungeon has no
 * tilesets (unimported/legacy dungeons).
 */
export function primaryTileset(tilesets: readonly TilesetGrant[]): TilesetGrant | null {
  if (tilesets.length === 0) return null;
  let best = tilesets[0]!;
  for (const t of tilesets) if (t.firstgid < best.firstgid) best = t;
  return best;
}