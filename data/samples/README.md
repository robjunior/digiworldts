# Tiled dungeon import — convention reference

Design your dungeon in [Tiled](https://mapeditor.org), export as **JSON**, and upload it via **Admin → Dungeons → Import Tiled JSON** (creates a new dungeon) or the **Re-import Tiled** button inside the dungeon editor (replaces the tiles + POIs of the current dungeon).

The sample [`dungeon-tiled-template.json`](./dungeon-tiled-template.json) in this folder demonstrates every supported POI kind on a 10×8 grid — open it in Tiled or copy it as a starting point.

## What the importer supports

- **Orientation**: `orthogonal` only (rejected otherwise)
- **Tile layers**: uncompressed data arrays only (uncheck "Compress" in Tiled export dialog)
- **Object layers**: all merged; recognized `class` (or legacy `type`) values become POIs
- **Custom properties**: scalar props (`string`, `int`, `float`, `bool`) OR a JSON string for `digimon` / `loots` / `randomAllowedElements`
- **Map dimensions**: up to 200×200 cells
- **Tile pixel size**: any (importer converts pixels → grid cells)

## Tile layer

- Name a tile layer **`walkable`** (or the importer picks the first tile layer)
- Any tile with a non-zero GID is a walkable cell
- Wall tiles = leave empty (GID 0)
- Only walkability matters — visual tileset is ignored

## Object classes

Set each object's **Class** (Tiled 1.9+) or **Type** (older Tiled) to one of the values below. Prefer **Point** objects (no width/height) for unambiguous single-cell placement.

### `spawn` — starting cell (exactly 1 required)

| Property | Type | Required | Notes |
|---|---|---|---|
| *(none)* | — | — | Position defines the spawn (x, y) |

### `encounter` — static battle

| Property | Type | Required | Notes |
|---|---|---|---|
| `digimon` | string (JSON) | ✅ | `[{"catalogId":"skb-317","level":4}]` — array of `{catalogId, level, nickname?}` |
| `difficulty` | string | | `easy` / `normal` (default) / `elite` / `boss` |
| `loots` | string (JSON) | | `[{"itemId":"itm-xxx","qty":1,"chance":0.25}]` |
| `label` | string | | Optional in-game name |

### `item` — pickup

| Property | Type | Required | Notes |
|---|---|---|---|
| `itemId` | string | ✅ | Must match an id in `shop_items` |
| `qty` | int | | Defaults to 1 |

### `door` — locked passage

| Property | Type | Required | Notes |
|---|---|---|---|
| `keyItemId` | string | ✅ | Must match an id in `shop_items`; consumed on unlock |
| `label` | string | | Optional |

### `warp` — teleport / exit

| Property | Type | Required | Notes |
|---|---|---|---|
| `targetDungeonId` | string | | Omit or empty = return to the World map |
| `label` | string | | Optional |

### `trap` — one-shot hazard

| Property | Type | Required | Notes |
|---|---|---|---|
| `kind` | string | ✅ | `damage` / `poison` / `burn` / `energy_drain` / `mood_loss` / `teleport` / `random_encounter` |
| `severity` | int | ✅ | 1–100 |
| `label` | string | | Optional |

## Map-level properties (optional)

Set on the **Map Properties** panel — everything below is optional. Missing keys keep the existing value (re-import) or the schema default (new dungeon).

| Property | Type | Notes |
|---|---|---|
| `biome` | string | One of `desert` / `forest` / `lake` / `storm` / `tundra` / `mountain` / `foundry` / `plateau` / `prairie` / `swamp` / `void` |
| `randomEncountersEnabled` | bool | |
| `randomEncounterRate` | float | 0–1 |
| `randomMinLevel` / `randomMaxLevel` | int | |
| `randomMaxStage` | string | `Baby` / `In-Training` / `Rookie` / `Champion` / `Ultimate` / `Mega` |
| `randomMinPartySize` / `randomMaxPartySize` | int | 1–3 |
| `randomAllowedElements` | string (JSON) | `["fire","plant","water"]` — omit for "all elements" |

## Import behaviour

- **New dungeon** (`Import Tiled JSON` in the dungeon list) — creates a fresh dungeon. Caller-side `name` + `biome` fields are the fallback used only when the map has no `biome` property.
- **Re-import** (button inside the dungeon editor) — **wipes all tiles + POIs of the open dungeon** and re-inserts from the file. `name`, `description`, `worldObjectId`, `questId`, `parentId`, `biomeRegion`, and `unlockRequiresItems` are preserved.
- All writes run inside a single transaction — a mid-import failure rolls back to the pre-import state.
- Unknown object classes are **skipped with a warning**. Out-of-grid coordinates or missing required props **abort the import** with an error listing every offending object.

## Common gotchas

- **Tiles anchored bottom-left**: If you use *Tile objects* (with a GID) instead of Point objects, Tiled anchors them at bottom-left in pixels. The importer compensates by subtracting one tile height on the Y axis. Prefer Point objects to avoid confusion.
- **Compressed tile data**: If your export shows `"data": "..."` (a base64 string), untick *Compress Tile Layer Data* in the Tiled export dialog and re-export.
- **`class` vs `type`**: Tiled 1.9+ renamed *Type* to *Class* in the object panel. The importer reads both — you can use either.
- **Custom property types (Tiled 1.8+)**: If you define an *EncounterProps* class type with a nested `digimon` field, the value will come as a nested object — the importer accepts both the object shape and a JSON string. When in doubt, stick to a plain `string` property whose value is a JSON string.
