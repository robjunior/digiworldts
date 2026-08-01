---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Quests
  - Quest System
  - World Objects
  - Quest Objectives
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/quest.ts
  - backend/src/quests/schema.ts
  - backend/src/quests/routes.ts
  - backend/src/quests/validation.ts
  - backend/src/quests/repo.ts
  - backend/src/quests/seed.ts
verified-at-commit: 4e70621
---

# Quests

> [!info] TL;DR
> Data-driven quest system with **4 step types** (`dialogue`, `battle`,
> `boss`, `loot`) and **5 objective kinds** (`travel`, `defeat`, `talk`,
> `collect`, `capture`). Quests gate on `requiredLevel` + `requiredFlags`,
> unlock others on claim via `completesFlag`/`unlocksQuestIds`, and
> reward `LootPool` (weighted items + guaranteed NetCore). World objects
> are physical placeholders on the map that can carry a `questId` +
> encounter spec.

`talk`, `collect`, and `capture` objective kinds landed in commit
[`4e70621 feat(quests): add talk, collect, and capture objective kinds`](https://github.com/…/commit/4e70621) —
`travel` and `defeat` were the initial two.

## Data model — `shared/src/quest.ts`

### Quest

```typescript
export type Quest = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly introDialogueId: string | null;
  readonly steps: readonly QuestStep[];
  readonly finalReward: LootPool;
  readonly unlocksQuestIds: readonly string[];
  readonly objectives?: readonly QuestObjective[];
  readonly giver?: string;
  readonly rewardText?: string;
  readonly lockHint?: string;
  /** AND-gated: every flag must be set for the quest to appear + accept. */
  readonly requiredFlags?: readonly string[];
  /** Set on the user automatically when this quest is claimed. */
  readonly completesFlag?: string;
  readonly createdAt: number;
};
```

### Step types

```typescript
export type QuestStep =
  | { readonly type: 'dialogue'; readonly dialogueId: string }
  | { readonly type: 'battle';   readonly enemies: readonly EnemyConfig[]; readonly flavor?: string }
  | { readonly type: 'boss';     readonly enemies: readonly EnemyConfig[]; readonly bossName: string; readonly flavor: string }
  | { readonly type: 'loot';     readonly pool: LootPool };
```

- **`dialogue`** — plays the dialogue tree at `dialogueId` and advances
  on close. See [`backend/src/dialogues/`](backend/src/dialogues/).
- **`battle`** — spawns a PvE fight with 1–6 enemies. Loss = quest halts
  (retry the same step).
- **`boss`** — same as `battle` but flagged as a boss + carries flavor
  strings the UI can present differently (bigger portraits, tension music).
- **`loot`** — awards a `LootPool` mid-quest without a battle.

Steps are sequential. Progress via `user_quest_progress.current_step_index`.

### Objective kinds (5 types — verbatim from [`shared/src/quest.ts:31-63`](shared/src/quest.ts:31))

```typescript
export type QuestObjective =
  | {
      readonly kind: 'travel';
      readonly biome: Biome;
      readonly text: string;
    }
  | {
      readonly kind: 'defeat';
      readonly biome: Biome;
      readonly element?: Element;
      readonly count: number;
      readonly text: string;
    }
  | {
      readonly kind: 'talk';
      readonly npcId: string;
      readonly text: string;
    }
  | {
      readonly kind: 'collect';
      readonly itemId: string;
      readonly qty: number;
      readonly text: string;
    }
  | {
      readonly kind: 'capture';
      readonly catalogId?: string;
      readonly stage?: Stage;
      readonly count: number;
      readonly text: string;
    };
```

| Kind      | Condition                                                                | Progress key                        |
| --------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `travel`  | Player entered `biome` at least once                                     | 1 hit = done                        |
| `defeat`  | Player defeated `count` mons of `biome` (optionally filtered by `element`) | count incremented per victory       |
| `talk`    | Player finished a dialogue with `npcId`                                  | 1 hit = done                        |
| `collect` | Player inventory has ≥ `qty` of `itemId`                                 | inventory scan on every progress read |
| `capture` | Player captured `count` mons matching `catalogId` OR `stage`             | count incremented per capture       |

`text` is the user-facing description (localized copy — the store is
locale-aware).

### LootPool

```typescript
export type LootItem = {
  readonly itemId: string;
  readonly weight: number;
  readonly minQty: number;
  readonly maxQty: number;
};

export type LootPool = {
  readonly items: readonly LootItem[];
  readonly pickCount: number;
  readonly guaranteedNetcore?: number;
};
```

Weighted random pick: `pickCount` draws WITH replacement from `items`,
each item's chance ∝ `weight / sum(weights)`. Each draw rolls a
`randInt(minQty, maxQty)` amount. `guaranteedNetcore` is granted flat on
top.

> [!warning] Legacy `guaranteedCredits` alias
> The Zod schema in `validation.ts` accepts `guaranteedCredits` as a
> deprecated alias for `guaranteedNetcore` — the transform sets
> `guaranteedNetcore = guaranteedCredits` when only the legacy field is
> present. New quest JSON should use `guaranteedNetcore` directly. See
> [[Currency]] for why the split matters.

### Quest state per user

```typescript
export type UserQuestState = 'available' | 'active' | 'completed' | 'claimed' | 'locked';
```

- **`locked`** — required flags not set yet
- **`available`** — visible + can accept
- **`active`** — accepted, in progress
- **`completed`** — all steps done, reward not yet claimed
- **`claimed`** — reward taken, entry archived

`current_step_index >= steps.length` ⇒ `completed`. `claim` moves to
`claimed` AND sets `completesFlag` on the user (if defined) AND unlocks
`unlocksQuestIds`.

## Persistence — `quests/schema.ts`

Three tables:

```sql
CREATE TABLE quests (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  required_level INTEGER NOT NULL DEFAULT 1,
  data           TEXT NOT NULL,   -- JSON blob for the full Quest
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE world_objects (
  id          TEXT PRIMARY KEY,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  lat         REAL NOT NULL DEFAULT 0,
  lon         REAL NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL,          -- mountain|tower|city|ruin|shrine|obelisk|crystal|grove|spring|archway
  scale       REAL NOT NULL DEFAULT 1.0,
  tint        TEXT,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  passable    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE user_quest_progress (
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id                 TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  current_step_index       INTEGER NOT NULL,
  current_dialogue_node_id TEXT,
  choices_made             TEXT NOT NULL DEFAULT '{}',
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,
  PRIMARY KEY (user_id, quest_id)
);
```

The `data` column stores the FULL `Quest` JSON blob — cheap read, no
join. Migrations add richer fields as `data` schema evolves; existing
rows keep working as long as new fields are optional.

## World objects

Physical props scattered around the world grid, keyed by `(x, y)`:

```typescript
export type WorldObjectKind =
  | 'mountain' | 'tower' | 'city' | 'ruin' | 'shrine' | 'obelisk'
  | 'crystal'  | 'grove' | 'spring' | 'archway';
```

Can carry:

- `questId` — starting a quest from this landmark
- `dungeonId` — entering a dungeon
- `elements[]` + `minLevel/maxLevel` — random-encounter spec that
  propagates to the linked dungeon on write (see
  [[#Encounter-spec propagation]])
- `hiddenUntilFlag` — invisible on the map until a specific flag is set
- `passable` — walkable vs blocking

Seeded from [`quests/seed.ts::DEFAULT_SEEDS`](backend/src/quests/seed.ts) —
~19 hand-authored landmarks across biomes.

### Encounter-spec propagation

When admin edits a world object with an encounter spec AND `dungeonId`,
[`quests/routes.ts::propagateEncounterSpecToDungeon`](backend/src/quests/routes.ts:20)
patches the dungeon's random-encounter config to match. Keeps world
map and dungeon config in sync — a user zoning into a "level 20 fire
mons" landmark gets a dungeon actually configured for those.

## HTTP surface — [`quests/routes.ts`](backend/src/quests/routes.ts)

### Admin (auth: admin)

| Method | Path                                          | Purpose                                            |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/admin/quests`                           | List all quests                                    |
| GET    | `/api/admin/quests/:id`                       | Fetch one                                          |
| POST   | `/api/admin/quests`                           | Create (Zod-validated body)                        |
| PUT    | `/api/admin/quests/:id`                       | Replace (Zod-validated)                            |
| DELETE | `/api/admin/quests/:id`                       | Remove                                             |
| GET    | `/api/admin/quests/:id/export`                | Full JSON export                                   |
| POST   | `/api/admin/quests/import`                    | Import JSON (accepts pre-assigned `id`)            |
| GET    | `/api/admin/world-objects/:id`                | Fetch one world object                             |
| POST   | `/api/admin/world-objects`                    | Create + propagate encounter spec                  |
| PUT    | `/api/admin/world-objects/:id`                | Update + propagate encounter spec                  |
| DELETE | `/api/admin/world-objects/:id`                | Delete                                             |

### Player (auth: user)

| Method | Path                                          | Purpose                                                                 |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/quests/available`                       | Quests the player can accept RIGHT NOW (level + flags OK)               |
| GET    | `/api/quests`                                 | Every quest with per-user state (available/active/completed/claimed/locked) |
| POST   | `/api/quests/:id/start`                       | Same as accept, alt endpoint (verify use)                               |
| POST   | `/api/quests/:id/accept`                      | Accept — creates `user_quest_progress` row                              |
| POST   | `/api/quests/:id/claim`                       | Claim reward — grants LootPool, sets `completesFlag`, unlocks           |
| GET    | `/api/world/objects`                          | World objects visible to this user (respects `hiddenUntilFlag`)         |

## Flag-based unlock chains

`requiredFlags` + `completesFlag` together form a directed acyclic
progression graph:

```
Quest A completesFlag = 'a-done'
Quest B requiredFlags = ['a-done']
        completesFlag = 'b-done'
Quest C requiredFlags = ['a-done', 'b-done']
```

C only appears after both A and B are claimed. `unlocksQuestIds` is an
explicit alternate — same effect but by quest id rather than named flag.

## Telemetry

`accept` and `claim` fire `quest.accept` / `quest.claim` events via
[`telemetry/emit.js`](backend/src/telemetry/emit.js) with props for
analytics (quest name, level gap, netcore granted, item count). See the
platform's telemetry surface for how those land downstream.

## What can go wrong

> [!warning] `completesFlag` collision
> Two quests sharing the same `completesFlag` value both set that flag
> on claim. If Quest C then requires it, claiming EITHER unlocks C —
> may not be the intent. Convention: prefix flags with the quest id.

> [!warning] Zod schema max sizes
> `steps` max 200, `objectives` max 20, `unlocksQuestIds` max 200.
> Silent 400 if you exceed. Verify in
> [`validation.ts::QuestInputSchema`](backend/src/quests/validation.ts)
> before designing an epic questline.

> [!warning] `defeat` objective progress
> The `count` field increments per victory of the right BIOME/ELEMENT
> combination. A player who avoids the region entirely stays at 0
> forever — no auto-completion timer. UX should hint at where to fight.

## What's NOT here (yet)

- **Choice-driven branches** — `choices_made` column is populated but
  the UI doesn't yet consume it to fork the quest tree. Coming with the
  dialogue system's next pass.
- **Time-limited quests** — no `expiresAt` column. Every quest lives
  until claimed or the admin deletes it.
- **Quest chains as a first-class type** — chains are implicit through
  flag gating.

## Related

- [[HTTP Surface]] — grep for `/api/quests` and `/api/admin/quests` +
  `/api/world/objects`
- [[Dungeons]] — quests can reference `dungeonId`; encounter spec propagates
- [[Currency]] — `guaranteedNetcore` on `LootPool`
- [[Combat]] — battle/boss steps feed the combat engine
- Dialogues — [`backend/src/dialogues/`](backend/src/dialogues/) (out of
  scope here — TODO write its own note)
