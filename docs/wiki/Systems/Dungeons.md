---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Dungeons
  - Dungeon System
  - Tile-based Dungeons
  - Traps
  - Warps
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/dungeons/routes.ts
  - backend/src/dungeons/random.ts
  - backend/src/dungeons/doors.ts
  - backend/src/dungeons/traps.ts
  - backend/src/dungeons/validation.ts
  - backend/src/dungeons/tiled-import.ts
verified-at-commit: 4e70621
---

# Dungeons

> [!warning] Refactor incoming — V1 legacy
> This note describes the **currently-shipped V1** dungeon system. A
> large refactor (kit + stash, extraction, item rarity, Cypher
> evolution keys, per-layer Tiled collision, multi-floor) is planned.
> See [[2026-08-07 — Dungeon crawler + extraction refactor]] for the
> decision and [[Dungeon Extraction]] for the target-state
> architecture. This note remains authoritative for V1 behaviour
> until phase **F3** of the rollout ships.

> [!info] TL;DR
> Tile-based grid dungeons with **five** authoring layers stacked on
> `(x, y)` tiles: encounters (fixed + random), doors (key-item gated),
> warps (teleport pairs), items (pickups), traps (kind + severity). Grid
> data can be imported from Tiled TMJ files. Random encounters roll on
> each move based on per-dungeon rate + level range + stage cap +
> allowed elements. State per user in `user_dungeon_runs` (position,
> unlocked doors, one-shot triggers).

## Data model — [`shared/src/dungeon.ts`](shared/src/dungeon.ts) (verify shape)

Core entity:

```typescript
type Dungeon = {
  id: string;
  name: string;
  width: number;             // grid width in tiles
  height: number;             // grid height in tiles
  tiles: number[][];          // 2D array of tile ids
  entranceX: number;
  entranceY: number;
  parentId?: string;          // hierarchy for multi-floor dungeons
  regionElements?: Element[]; // biome tag
  // Random encounter config:
  randomEncountersEnabled: boolean;
  randomEncounterRate: number;        // 0..1 per-move probability
  randomMinLevel: number;
  randomMaxLevel: number;
  randomMaxStage: Stage;
  randomMinPartySize: number;
  randomMaxPartySize: number;
  randomAllowedElements?: Element[];
  // ...
};
```

Encounters, doors, warps, items, traps live in separate tables — see
each below.

## Random encounters — [`dungeons/random.ts`](backend/src/dungeons/random.ts)

Verbatim algorithm ([`random.ts:29-40`](backend/src/dungeons/random.ts:29)):

```typescript
export function rollRandomEncounter(
  dungeon: Dungeon,
  catalog: Catalog,
): readonly EncounterDigimon[] | null {
  if (!dungeon.randomEncountersEnabled) return null;
  if (Math.random() >= dungeon.randomEncounterRate) return null;
  const pool = randomEncounterPool(dungeon, catalog);
  if (pool.length === 0) return null;
  const partySize = randomInt(dungeon.randomMinPartySize, dungeon.randomMaxPartySize);
  const mons: EncounterDigimon[] = [];
  for (let index = 0; index < partySize; index += 1) {
    const pick = pickOne(pool);
    if (!pick) break;
    mons.push({
      catalogId: pick.id,
      level: randomInt(dungeon.randomMinLevel, dungeon.randomMaxLevel),
    });
  }
  return mons.length > 0 ? mons : null;
}
```

Pool filter ([`random.ts:19-26`](backend/src/dungeons/random.ts:19)):

```typescript
function randomEncounterPool(dungeon, catalog) {
  const maxStageRank = stageRank(dungeon.randomMaxStage);
  const allowedElements = dungeon.randomAllowedElements
    ? new Set(dungeon.randomAllowedElements)
    : null;
  return catalog.digimons.filter((entry) => {
    if (stageRank(entry.stage) > maxStageRank) return false;
    if (allowedElements && !allowedElements.has(entry.element)) return false;
    return true;
  });
}
```

Semantics:

- **Rate** — every move rolls `Math.random() < randomEncounterRate`.
  Set 0 to disable, 1 to force every move.
- **Party size** — uniform in `[randomMinPartySize, randomMaxPartySize]`.
- **Level** — uniform in `[randomMinLevel, randomMaxLevel]` per mon.
- **Stage cap** — only mons whose stage rank ≤ `randomMaxStage` rank are
  eligible. Stage rank comes from
  [`STAGES` in shared/src/digimon.ts](shared/src/digimon.ts).
- **Element filter** — if `randomAllowedElements` is non-empty, restricts
  the pool.

`randomEncounterMatchesDungeonConfig()` in the same file is the
inverse — validates that a client-supplied encounter matches the
dungeon's config (anti-cheat on `POST /api/dungeon/:id/random-encounter/start`).

## Doors — [`dungeons/doors.ts`](backend/src/dungeons/doors.ts)

Key-item gated tiles. Row shape ([`doors.ts:5`](backend/src/dungeons/doors.ts:5)):

```typescript
type DoorRow = {
  id: string;
  dungeon_id: string;
  x: number;
  y: number;
  key_item_id: string;
  label: string | null;
  created_at: number;
  updated_at: number;
};
```

Unique per `(dungeon_id, x, y)` — enforced at CRUD time via
`getDoorAt` conflict check. Unlock endpoint at
`POST /api/dungeons/:id/doors/:doorId/unlock`:

1. Server checks the player has the `key_item_id` in inventory.
2. On success, adds the door's id to
   `UserDungeonRun.unlockedDoors[]` (JSON array in DB) — one-shot.
3. Subsequent moves onto the tile are passable.

## Warps — teleport pairs

Two-tile connections. Player steps onto tile A → transported to tile B
(potentially in another dungeon, potentially the same). Registered under
`POST /api/admin/dungeons/:id/warps`. Bidirectional or one-way — verify
in [`dungeons/repo.ts`](backend/src/dungeons/repo.ts) for the exact shape.

## Traps — [`dungeons/traps.ts`](backend/src/dungeons/traps.ts)

Seven kinds ([`traps.ts:44-51`](backend/src/dungeons/traps.ts:44)):

```typescript
const KIND_LABELS: Record<TrapKind, string> = {
  damage: 'damage',
  poison: 'poison',
  burn: 'burn',
  energy_drain: 'energy-drain',
  mood_loss: 'demoralizing',
  teleport: 'teleport',
  random_encounter: 'ambush',
};
```

### Dodge check

Documented in the file header:

> A trap is a tile at `(dungeon_id, x, y)` with a kind + severity. When
> a player steps onto the tile, the server rolls a dodge check against
> the party's average SPD (`avoidChance = min(0.75, partyAvgSpd / 500)`)
> and, on a landed trap, applies the effect described by `kind`. Traps
> fire once per run — the fired trap id is added to
> `UserDungeonRun.oneshotTriggeredIds` so subsequent steps on the same
> tile are a no-op.

Max avoid chance: **75 %**. Even a maxed-SPD party eats 25 % of traps.

### Effect application status

**MVP shipped**: the roll pipeline + client notification (`effectSummary`
string in the response). **HP/EN/mood/position writes are the follow-up**.
`poison` and `burn` describe the pending ailment for the next battle;
hooking into `pending_buffs` is the follow-up. `random_encounter`
names the intent but doesn't yet spawn the wild battle.

## Items on the floor

Pickups placed on tiles. `POST /api/admin/dungeons/:id/items` creates
one; player collection is auto on move over the tile (verify in
[`dungeons/routes.ts`](backend/src/dungeons/routes.ts) around the move
endpoint). One-shot per run — collected id added to `UserDungeonRun`.

## Move endpoint

`POST /api/dungeon/:id/move { direction }`:

1. Validate the move against the tile grid (walkable + within bounds).
2. Update `UserDungeonRun.x/y`.
3. Roll for door (blocked without key), warp (teleport), trap (dodge
   check → effect), item (pickup).
4. Roll `rollRandomEncounter` on the destination tile.
5. Return updated position + any triggered events.

Client-side hooks the response to render the new position + apply
effects.

## Tiled TMJ import — [`dungeons/tiled-import.ts`](backend/src/dungeons/tiled-import.ts)

Tiled (mapeditor.org) is the intended authoring surface. Its TMJ (JSON
map) format encodes:

- Layer of floor tiles
- Layers of walls
- Object layers for encounters, doors, warps, items, traps

The importer at `POST /api/admin/dungeons/import-tiled` accepts the raw
TMJ payload and creates the dungeon + all its sub-tables in one atomic
tx. `/api/admin/dungeons/:id/import-tiled` REPLACES an existing dungeon's
grid + objects (keeping id + name for save-in-place).

## HTTP surface — [`dungeons/routes.ts`](backend/src/dungeons/routes.ts)

30 endpoints. Grouped by scope:

### Admin CRUD

| Method | Path                                                                | Purpose                            |
| ------ | ------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/admin/dungeons`                                               | List                                |
| POST   | `/api/admin/dungeons`                                               | Create                              |
| GET    | `/api/admin/dungeons/:id`                                           | Fetch                               |
| PUT    | `/api/admin/dungeons/:id`                                           | Update                              |
| DELETE | `/api/admin/dungeons/:id`                                           | Remove                              |
| PUT    | `/api/admin/dungeons/:id/tiles`                                     | Replace tile grid                   |
| POST   | `/api/admin/dungeons/import-tiled`                                  | Fresh import from TMJ               |
| POST   | `/api/admin/dungeons/:id/import-tiled`                              | Replace existing from TMJ           |

### Admin sub-entities

| Method | Path                                                                | Purpose                             |
| ------ | ------------------------------------------------------------------- | ----------------------------------- |
| POST   | `/api/admin/dungeons/:id/encounters`                                | Add fixed encounter                  |
| PUT    | `/api/admin/dungeons/:id/encounters/:encId`                         | Update                              |
| DELETE | `/api/admin/dungeons/:id/encounters/:encId`                         | Remove                              |
| POST   | `/api/admin/dungeons/:id/items`                                     | Add floor item                      |
| DELETE | `/api/admin/dungeons/:id/items/:itemId`                             | Remove                              |
| POST   | `/api/admin/dungeons/:id/warps`                                     | Add warp                            |
| PUT    | `/api/admin/dungeons/:id/warps/:warpId`                             | Update                              |
| DELETE | `/api/admin/dungeons/:id/warps/:warpId`                             | Remove                              |
| POST   | `/api/admin/dungeons/:id/doors`                                     | Add door                            |
| PUT    | `/api/admin/dungeons/:id/doors/:doorId`                             | Update                              |
| DELETE | `/api/admin/dungeons/:id/doors/:doorId`                             | Remove                              |
| GET    | `/api/admin/dungeons/:id/traps`                                     | List                                |
| POST   | `/api/admin/dungeons/:id/traps`                                     | Add trap                            |
| PUT    | `/api/admin/dungeons/:id/traps/:trapId`                             | Update                              |
| DELETE | `/api/admin/dungeons/:id/traps/:trapId`                             | Remove                              |

### Player runtime

| Method | Path                                                                | Purpose                             |
| ------ | ------------------------------------------------------------------- | ----------------------------------- |
| GET    | `/api/dungeon/:id`                                                  | Full dungeon state (tiles + run)     |
| POST   | `/api/dungeon/:id/move`                                             | One step in a direction              |
| POST   | `/api/dungeons/:id/doors/:doorId/unlock`                            | Consume key item, mark door unlocked |
| POST   | `/api/dungeon/:id/encounter/:encId/start`                           | Start a fixed encounter              |
| POST   | `/api/dungeon/:id/random-encounter/start`                           | Start a rolled random encounter      |
| POST   | `/api/dungeon/:id/complete`                                         | Mark run as completed                |
| POST   | `/api/dungeon/:id/reset`                                            | Reset run state                      |

## Per-user run state

`user_dungeon_runs` table (verify shape in
[`db/schema.sql`](backend/src/db/schema.sql)):

```
user_id           TEXT
dungeon_id        TEXT
x                 INTEGER
y                 INTEGER
unlocked_doors    TEXT    (JSON array of door ids)
started_at        INTEGER
completed_at      INTEGER (nullable)
PRIMARY KEY (user_id, dungeon_id)
```

One run per user per dungeon at a time — `reset` clears it, `complete`
marks it done (verify how re-entry after completion works — the reset
endpoint suggests they cycle).

## Hierarchy

`Dungeon.parentId` supports multi-floor / nested dungeons — a boss room
can be a child dungeon with the parent's warp leading to it. Traversal
is the client's responsibility (open the child via `GET /api/dungeon/:childId`).

## What can go wrong

> [!warning] Encounter-spec drift with world objects
> A world object's `elements + minLevel/maxLevel` propagates to the
> linked dungeon's random-encounter config on admin write
> ([[Quests#Encounter-spec propagation]]). But direct admin edits to
> the dungeon can drift from the world object. Prefer editing the world
> object; the propagation keeps things in sync.

> [!warning] `randomEncounterRate = 1.0`
> Every move triggers an encounter. Playable if you want a wave-defense
> feel; punishing otherwise. Use sparingly.

> [!warning] Trap effect follow-ups
> HP/EN writes, ailment insertion into `pending_buffs`, and random-
> encounter spawn from `random_encounter` traps are **not yet wired**.
> The response's `effectSummary` describes what SHOULD happen but the
> DB writes are stubs. See [`traps.ts` file header](backend/src/dungeons/traps.ts).

## What's NOT here (yet)

- **Multi-player dungeons** — one user, one run. Two players in the same
  dungeon are two independent runs.
- **Persistence between sessions** — completed dungeons don't unlock
  auto-completion / fast-travel. Every run is a fresh walk.
- **Enemy respawn** — a fixed encounter defeated stays defeated for the
  run. `reset` re-enables.

## Related

- [[Combat]] — the battles triggered by encounters + traps
- [[Quests]] — world objects link into dungeons via `dungeonId`
- [[HTTP Surface]] — full endpoint listing
- [[Weather System]] — dungeon scenes carry `weather` + `timeOfDay`
- Adventure and PvE — [[Adventure]] for idle expeditions,
  [`world/pve-battle.ts`](backend/src/world/pve-battle.ts) for wild PvE
