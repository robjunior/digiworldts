import type { Tileset } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';

type TilesetRow = {
  readonly id: string;
  readonly name: string;
  readonly image_filename: string;
  readonly tile_width: number;
  readonly tile_height: number;
  readonly image_width: number;
  readonly image_height: number;
  readonly columns: number;
  readonly tile_count: number;
  readonly spacing: number;
  readonly margin: number;
  readonly created_at: number;
  readonly updated_at: number;
};

export const TILESET_IMAGE_URL = (id: string): string => `/api/tilesets/${encodeURIComponent(id)}/image`;

function rowToTileset(row: TilesetRow): Tileset {
  return {
    id: row.id,
    name: row.name,
    imageFilename: row.image_filename,
    imageUrl: TILESET_IMAGE_URL(row.id),
    tileWidth: row.tile_width,
    tileHeight: row.tile_height,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    columns: row.columns,
    tileCount: row.tile_count,
    spacing: row.spacing,
    margin: row.margin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SQL_LIST = `SELECT * FROM tilesets ORDER BY name`;
const SQL_GET = `SELECT * FROM tilesets WHERE id = ?`;
const SQL_GET_BY_NAME = `SELECT * FROM tilesets WHERE name = ?`;
const SQL_INSERT = `INSERT INTO tilesets (id, name, image_filename, tile_width, tile_height, image_width, image_height, columns, tile_count, spacing, margin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_GEOMETRY = `UPDATE tilesets SET spacing = ?, margin = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE = `DELETE FROM tilesets WHERE id = ?`;
const SQL_COUNT_DUNGEON_REFS = `SELECT COUNT(*) AS n FROM dungeon_tilesets WHERE tileset_id = ?`;

export async function listTilesets(): Promise<Tileset[]> {
  return (await q<TilesetRow>(SQL_LIST)).map(rowToTileset);
}

export async function getTileset(id: string): Promise<Tileset | null> {
  const row = await one<TilesetRow>(SQL_GET, id);
  return row ? rowToTileset(row) : null;
}

export async function findTilesetByName(name: string): Promise<Tileset | null> {
  const row = await one<TilesetRow>(SQL_GET_BY_NAME, name);
  return row ? rowToTileset(row) : null;
}

export type CreateTilesetInput = {
  readonly name: string;
  readonly imageFilename: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly spacing?: number;
  readonly margin?: number;
};

export async function createTileset(input: CreateTilesetInput): Promise<Tileset> {
  const id = newId('tst');
  const now = Date.now();
  const columns = Math.max(1, Math.floor(input.imageWidth / input.tileWidth));
  const rows = Math.max(1, Math.floor(input.imageHeight / input.tileHeight));
  const tileCount = columns * rows;
  const spacing = input.spacing ?? 0;
  const margin = input.margin ?? 0;
  await run(
    SQL_INSERT,
    id, input.name, input.imageFilename,
    input.tileWidth, input.tileHeight,
    input.imageWidth, input.imageHeight,
    columns, tileCount, spacing, margin, now, now,
  );
  const row = await one<TilesetRow>(SQL_GET, id);
  if (!row) throw new Error('createTileset: post-insert lookup failed');
  return rowToTileset(row);
}

export async function updateTilesetGeometry(
  id: string,
  geometry: { readonly spacing: number; readonly margin: number },
): Promise<Tileset | null> {
  const now = Date.now();
  await run(SQL_UPDATE_GEOMETRY, geometry.spacing, geometry.margin, now, id);
  return getTileset(id);
}

export type DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'not-found' }
  | { readonly ok: false; readonly error: 'in-use'; readonly referencedByDungeons: number };

export async function deleteTileset(id: string): Promise<DeleteResult> {
  const existing = await one<TilesetRow>(SQL_GET, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const refCount = await one<{ n: number }>(SQL_COUNT_DUNGEON_REFS, id);
  const n = refCount?.n ?? 0;
  if (n > 0) return { ok: false, error: 'in-use', referencedByDungeons: n };
  await run(SQL_DELETE, id);
  return { ok: true };
}
