/**
 * Tiled Map Editor JSON format — subset consumed by the dungeon importer.
 *
 * Reference: https://doc.mapeditor.org/en/stable/reference/json-map-format/
 *
 * We accept only orthogonal, uncompressed tile layers. Object layers are
 * merged across the whole map. Recognized object classes (a.k.a. Tiled 1.9+
 * `class`, or the pre-1.9 `type` field) become our POI kinds.
 */

export const TILED_POI_CLASSES = ['spawn', 'encounter', 'item', 'door', 'warp', 'trap', 'zone', 'chest'] as const;
export type TiledPoiClass = typeof TILED_POI_CLASSES[number];

export type TiledPropertyType = 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class';

export type TiledProperty = {
  readonly name: string;
  readonly type?: TiledPropertyType;
  readonly propertytype?: string;
  readonly value: string | number | boolean | null | Record<string, unknown>;
};

export type TiledObject = {
  readonly id: number;
  readonly name?: string;
  /** Pre-Tiled-1.9 object type field. Read `class ?? type` for portability. */
  readonly type?: string;
  /** Tiled 1.9+ renamed `type` to `class`. Newer exports write this. */
  readonly class?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly point?: boolean;
  readonly ellipse?: boolean;
  readonly visible?: boolean;
  readonly properties?: readonly TiledProperty[];
  readonly gid?: number;
};

export type TiledTileLayer = {
  readonly type: 'tilelayer';
  readonly id?: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Uncompressed only — array of tile GIDs, row-major. 0 = empty. */
  readonly data: readonly number[];
  readonly visible?: boolean;
  readonly properties?: readonly TiledProperty[];
};

export type TiledObjectGroup = {
  readonly type: 'objectgroup';
  readonly id?: number;
  readonly name: string;
  readonly objects: readonly TiledObject[];
  readonly visible?: boolean;
  readonly properties?: readonly TiledProperty[];
};

export type TiledUnknownLayer = {
  readonly type: string;
  readonly name?: string;
};

export type TiledLayer = TiledTileLayer | TiledObjectGroup | TiledUnknownLayer;

/**
 * Reference to a tileset used by a map. Tiled emits one entry per tileset
 * stacked in the map, each carrying a `firstgid` (the Global Tile ID at
 * which this tileset's tiles begin in the map's GID space). Embedded
 * tilesets include `name` + `tilewidth`/`tileheight` + `image` + column
 * geometry. External tilesets carry only `firstgid` + `source` (a path to
 * a `.tsx`/`.tsj`) — the importer derives a name from the filename.
 */
export type TiledTileset = {
  readonly firstgid: number;
  readonly name?: string;
  readonly source?: string;
  readonly tilewidth?: number;
  readonly tileheight?: number;
  readonly columns?: number;
  readonly tilecount?: number;
  readonly image?: string;
  readonly imagewidth?: number;
  readonly imageheight?: number;
};

export type TiledMap = {
  readonly type?: 'map';
  readonly version?: string;
  readonly tiledversion?: string;
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly orientation?: string;
  readonly layers: readonly TiledLayer[];
  readonly tilesets?: readonly TiledTileset[];
  readonly properties?: readonly TiledProperty[];
};

export function isTileLayer(layer: TiledLayer): layer is TiledTileLayer {
  return layer.type === 'tilelayer';
}

export function isObjectGroup(layer: TiledLayer): layer is TiledObjectGroup {
  return layer.type === 'objectgroup';
}

export function getObjectClass(obj: TiledObject): string {
  return (obj.class ?? obj.type ?? '').trim();
}

export function getProperty(properties: readonly TiledProperty[] | undefined, name: string): TiledProperty['value'] | undefined {
  if (!properties) return undefined;
  const found = properties.find((p) => p.name === name);
  return found?.value;
}

/**
 * Derive the tileset library name for a Tiled map's tileset reference.
 * Embedded tilesets carry `name`; external tilesets only carry `source`, so
 * we strip the path + `.tsx`/`.tsj`/`.xml`/`.json` extension. The result is
 * matched against the shared tileset library's `tilesets.name` column.
 */
export function tiledTilesetKey(ts: TiledTileset): string {
  if (ts.name && ts.name.trim().length > 0) return ts.name.trim();
  if (ts.source) {
    const base = ts.source.replace(/^.*[\\/]/, '');
    return base.replace(/\.(tsx|tsj|json|xml)$/i, '');
  }
  return `unnamed-${ts.firstgid}`;
}
