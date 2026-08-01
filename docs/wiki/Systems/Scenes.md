---
tags:
  - digiworld/system
aliases:
  - Scenes
  - Scene Entities
  - Scene Settings
  - Per-arena Defaults
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/scene.ts
  - backend/src/scenes/store.ts
  - backend/src/scenes/routes.ts
  - backend/src/scenes/picker.ts
  - frontend/src/components/admin/SceneSettingsAdmin.tsx
verified-at-commit: ee635a7
---

# Scenes

> [!info] TL;DR
> Scenes are named `SceneEntity` records that carry lighting / fog / camera
> / arena offsets + optional [[Weather System|weather]] + optional
> `TimeOfDayConfig`. A battle picks a scene per-match — either explicitly
> (author picked one for a dungeon boss) or automatically via
> [`pickSceneForElements()`](backend/src/scenes/picker.ts) matched on the
> party's element mix. Persisted to `data/scenes/scenes.json` as a
> versioned envelope.

## Data model — [`shared/src/scene.ts`](shared/src/scene.ts)

`SceneEntity` (verify exact shape in the file):

```typescript
export type SceneEntity = {
  readonly id: string;                   // 'scn_xxxxx'
  readonly name: string;
  readonly elements: readonly Element[]; // e.g. ['fire', 'earth']
  readonly settings: Record<string, unknown>;   // lighting / fog / camera / arena
  readonly useGlbSettings?: boolean;
  readonly weather?: WeatherConfig | null;
  readonly timeOfDay?: TimeOfDayConfig | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};
```

`settings` is a free-form record because the shape is authored on the
frontend `SceneSettingsAdmin` and consumed by `SceneManager`. It carries:

- **Sky / Fill light** — color + intensity
- **Camera** — orthographic vs perspective, elevation°, yaw°, distance,
  look-at Y, frustum
- **Arena position** — scene size, offsets X/Y/Z
- **Effects** — exposure, dust opacity
- **GLB embedded settings** — a toggle to prefer the settings baked into
  the biome GLB over the record's own

## Persistence — [`backend/src/scenes/store.ts`](backend/src/scenes/store.ts)

File-backed at `data/scenes/scenes.json`:

```typescript
type SceneFileEnvelope = {
  readonly version: 2;
  readonly scenes: readonly SceneFileRecord[];
};

type SceneFileRecord = SceneEntity & {
  readonly weather: WeatherConfig | null;    // materialised (never undefined)
  readonly timeOfDay: TimeOfDayConfig | null;
};
```

`version: 2` — v1 was the legacy `scene-defaults.json` shape (see below).
`weather` and `timeOfDay` are `| null`, never `undefined`, so the JSON
round-trip is stable.

### In-memory cache

```typescript
let cache: readonly SceneEntity[] | null = null;
```

Every read goes through the cache; `invalidateSceneCache()` clears it on
cluster events (see [[#Live invalidation]]).

### Legacy migration

`data/scenes/scene-defaults.json` was the old per-arena format
(hard-coded arena keys — `fire`, `water`, etc.).
[`seedFromLegacyDefaults()`](backend/src/scenes/store.ts) triggers on
first boot with an empty `scenes.json` — it walks the legacy record,
promotes each non-empty arena into a fresh `SceneEntity` with `id: newId('scn')`
and `elements` mapped from `ARENA_KEY_TO_ELEMENTS`. Old file stays put
(read-only fallback); new file takes over as the source of truth.

### Zod-lite coercion

`coerceScene()` doesn't Zod-validate — it accepts the object, picks known
keys, drops junk. Unknown or malformed rows return `null` and are dropped
silently (logged via `log.warn` on the outer read). Rationale: the file
is user-editable by admins; a hand-typo in one scene shouldn't kill the
whole boot.

## Picker — [`backend/src/scenes/picker.ts`](backend/src/scenes/picker.ts)

Auto-picks a scene for a battle from the party's element mix:

```typescript
export async function pickSceneForElements(
  elements: readonly Element[],
): Promise<SceneEntity | null> {
  if (elements.length === 0) return null;
  const scenes = await listScenes();
  if (scenes.length === 0) return null;
  const set = new Set<Element>(elements);
  const matches = scenes.filter((s) => s.elements.some((el) => set.has(el)));
  if (matches.length === 0) return null;
  const idx = Math.floor(Math.random() * matches.length);
  return matches[idx] ?? null;
}
```

Semantics:

- **Empty elements** → no scene (uses default background)
- **No scenes match** → no scene (same)
- **Multiple scenes match** → picked uniformly at random

Explicit picks (a dungeon boss with a specific `sceneId`) bypass the
picker; battles carry `Battle.sceneId` end-to-end so the client can
resolve it via `GET /api/scene/defaults?id=…` (verify — the surface may
be a single `/api/scene/defaults` list).

## HTTP surface — [`backend/src/scenes/routes.ts`](backend/src/scenes/routes.ts)

| Method | Path                                | Auth  | Purpose                                                          |
| ------ | ----------------------------------- | ----- | ---------------------------------------------------------------- |
| GET    | `/api/scene/defaults`               | user  | Full scene list — the client caches with a 30 s TTL              |
| POST   | `/api/admin/scenes`                 | admin | Create a scene (Zod-validated body)                              |
| PUT    | `/api/admin/scenes/:id`             | admin | Update a scene (partial)                                          |
| POST   | `/api/admin/scenes/:id/copy`        | admin | Duplicate — appends "(copy)" to the name                          |
| DELETE | `/api/admin/scenes/:id`             | admin | Delete                                                            |
| POST   | `/api/admin/weather/trigger`        | admin | Broadcast a runtime override; fans out `weather-triggered` WS msg |

Weather + time-of-day fields go through the same Zod schemas as the
standalone particle preset editor — see [[Weather System]].

## Live invalidation

Admin writes publish on the cluster `scene:defaults:updated` channel; every
node's WS lobby subscribes and fans out to its local sockets:

```json
{ "type": "scene-defaults-updated", "at": <ms> }
```

Client-side handler ([`wsStore.ts`](frontend/src/state/wsStore.ts))
nulls the module cache in
[`lib/scene-defaults.ts`](frontend/src/lib/scene-defaults.ts); the next
`getSceneDefaults()` call refetches. A 30 s TTL is the safety net for
freshly-loaded tabs that missed the WS message.

The pattern is also used for individual scene updates (`scene-updated`
message, when a specific `SceneEntity` mutates) so open combat scenes
can refresh mid-match if the admin tweaks live.

## Editor UI — `SceneSettingsAdmin`

Rich per-scene editor. Sections:

- **Identity** — name, elements (multi-select), GLB toggle
- **Model file** — pick from bundled biomes (`forest_biome.glb`,
  `factory_biome.glb`, `frost_biome.glb`, `lava_river_biome.glb`,
  `rock_biome.glb`, `dark_biome.glb`, `dark_lodge.glb`, `toytown.glb`)
- **Sky (key light)** — color + intensity + position X/Y/Z
- **Fill light** — color + intensity
- **Shadows** — enabled, softness, bias, normal bias
- **Camera** — type, elevation°, yaw°, distance, look-at Y, frustum
- **Arena position** — scene size, offset X/Y/Z
- **Effects** — exposure, dust opacity
- **Weather** — preset + lighting override + thunder (see [[Weather
  System]])
- **Time of day** — mode + fixed phase + cycle duration
- **Trigger event** widget pinned at the top

## Element-to-scene mapping

Bundled biomes ship with intended elements. Verify the exact mapping in
`shared/src/scene.ts::ARENA_KEY_TO_ELEMENTS` — abridged:

| Biome              | Elements                    |
| ------------------ | --------------------------- |
| `forest_biome`     | `nature`, `plant`           |
| `factory_biome`    | `steel`, `electricity`      |
| `frost_biome`      | `ice`, `water`              |
| `lava_river_biome` | `fire`                      |
| `rock_biome`       | `earth`                     |
| `dark_biome`       | `dark`                      |
| `toytown`          | (no elements — utility biome) |

Legacy keys (`fire`, `water`, `nature`, `electric`, `steel`, `dark`) live
in `LEGACY_ARENA_KEYS` so old `scene-defaults.json` files migrate cleanly.

## Related

- [[Weather System]] — the `weather` field of a scene
- [[Combat]] — battles carry `sceneId`; `pickSceneForElements` runs at
  `initBattle`
- [[HTTP Surface#Scenes + Particle presets + Weather]]
- [[WebSocket Protocol#scene-defaults-updated]] + `scene-updated`
- [[Cluster Coordination Layer]] — `scene:defaults:updated` channel
