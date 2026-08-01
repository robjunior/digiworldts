---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Roster
  - Party
  - Roster and Party
  - Evolution
  - Digimon Roster
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/roster/routes.ts
  - backend/src/roster/evolve.ts
  - backend/src/digimon/types.ts
verified-at-commit: 4e70621
---

# Roster and Party

> [!info] TL;DR
> **Roster** = every Digimon a player owns, one row per mon in
> `player_roster`. **Party** = the 3-slot lineup that goes into PvP
> matches, picked from the roster. Rosters grow via [[#Starter seed]] +
> [[Nursery and Pen|nursery]] hatches + PvE captures. Evolution swaps
> the `catalog_id` in place — same row, different template — with
> stage-pool freezing and skill-loadout auto-picking.

## Data model

`player_roster` (verify exact schema in
[`backend/src/db/schema.sql`](backend/src/db/schema.sql)):

```
id                  TEXT PRIMARY KEY     -- 'mon_...'
user_id             TEXT
catalog_id          TEXT                 -- current template (evolves swap this)
nickname            TEXT
level               INTEGER
xp                  INTEGER
hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus  INTEGER  -- training gains
mood                INTEGER              -- 0..100
status              TEXT                 -- 'resting'|'nursery'|'adventure'|'listed'
slot_index          INTEGER              -- party slot 0..2 or NULL
equipped_skill_ids  TEXT (JSON array)
stage_pools         TEXT (JSON StagePools)  -- frozen pools at prior stages
evolution_history   TEXT (JSON array of catalog_ids)
nursery_stage       TEXT NULL            -- 'Baby'|'In-Training'|'Rookie' while in the pen
nursery_evolve_at   INTEGER NULL
nursery_chain       TEXT (JSON) NULL
revive_at           INTEGER NULL         -- KO'd if in the future
pets_today, pets_day  -- daily petting counter (nursery)
listed_at           INTEGER NULL         -- listed on the digimon market
created_at, updated_at
```

## Party (3 slots) — `slot_index`

`slot_index` is `NULL` for non-party mons, `0`/`1`/`2` for the 3 party
slots. `POST /api/roster/party { slot, monId }` sets it; the endpoint
handles slot conflicts (moves the previous occupant to `NULL`).

### `partyTrainedness()`

Used by [[Matchmaking and MMR]] as the trainedness bracket input. Sums
each party mon's stat bonuses and averages across the party. See
[`roster/routes.ts:320`](backend/src/roster/routes.ts:320) for exact
math (~10 200 max for a fully-trained Mega party under current stage
pools).

### `partyAverageLevel()`

The matchmaking level bracket input — mean of party mons' levels.

## Evolution — [`roster/evolve.ts`](backend/src/roster/evolve.ts)

### The gate

`getEvolutionOptions()` returns a full picture:

```typescript
export type EvolutionGate = {
  eligible: boolean;
  reason?: EvolveReason;
  currentStage: Stage;
  currentLevel: number;
  currentMood: number;
  nextStage: Stage | null;
  requiredLevel: number;
  requiredMood: number;
  options: EvolutionOption[];   // every possible target
};
```

Each `EvolutionOption` reports:

```typescript
type EvolutionOption = {
  catalogId: string;
  name: string;
  stage: Stage;
  portrait: string;
  met: boolean;                  // has the player ever seen this species?
  eligible: boolean;             // requirements satisfied?
  reason?: EvolveReason;
  requiredLevel: number;
  requiredMood: number;
  requiredAttribute: Attribute | null;
};
```

Reasons:

```typescript
type EvolveReason =
  | 'no-paths'              // current template has no evolvesInto edges
  | 'level-too-low'
  | 'stage-cap'             // already at Mega
  | 'no-mood'               // mood < required
  | 'attribute-mismatch';   // current attribute != required
```

### The evolve endpoint

`POST /api/roster/:monId/evolve { targetCatalogId }`:

1. Fetch the gate. Reject if `!option.eligible`.
2. Freeze the **current** stage's stat-bonus pool into `stage_pools`
   (per-stage cap, no more room to train on this stage after the swap).
3. Append the current `catalog_id` to `evolution_history`.
4. Auto-pick the default equipped-skills loadout for the new
   `(element, stage)` via
   [`getDefaultEquippedForStage()`](backend/src/skills/pool.ts).
5. Atomic swap:

```sql
UPDATE player_roster
   SET catalog_id = ?, nickname = ?, xp = 0,
       evolution_history = ?, equipped_skill_ids = ?, stage_pools = ?,
       updated_at = ?
 WHERE id = ? AND user_id = ? AND catalog_id = ?   -- race guard
```

The `AND catalog_id = ?` guard is race-safe — two concurrent evolves
against the same mon: one wins, the other gets `changes = 0` and
`race-conflict`.

### `freezeCurrentStagePool()`

When a mon evolves, its **CURRENT** stage's training pool becomes
locked in. Verbatim:

```typescript
function freezeCurrentStagePool(row, currentStage): StagePools {
  const priorPools = row.stage_pools ? JSON.parse(row.stage_pools) : defaultMaxedPools(currentStage);
  let priorCombat = 0, priorHpen = 0;
  for (const s of STAGES) {
    if (s === currentStage) break;
    priorCombat += priorPools[s]?.combat ?? 0;
    priorHpen += priorPools[s]?.hpen ?? 0;
  }
  const bonusCombat = row.atk_bonus + row.def_bonus + row.int_bonus + row.spd_bonus;
  const bonusHpen = row.hp_bonus + row.en_bonus;
  const currentAlloc: StageAlloc = {
    combat: Math.max(0, Math.min(STAGE_COMBAT_POOL[currentStage], bonusCombat - priorCombat)),
    hpen: Math.max(0, Math.min(STAGE_HPEN_POOL[currentStage], bonusHpen - priorHpen)),
  };
  return { ...priorPools, [currentStage]: currentAlloc };
}
```

Each stage has a fixed pool of combat stats (`STAGE_COMBAT_POOL`) and
HP/EN (`STAGE_HPEN_POOL`) the mon can accumulate WHILE at that stage.
On evolve, the pool is frozen — you keep what you earned, you can't
add more to that stage's pool later, but the NEXT stage's pool opens
up for training.

## Starter seed

`POST /api/roster/seed` — retries starter roster seeding if the
catalog was empty at register time. Grants 3 random Rookies (verify
selection logic).

Reason for the retry endpoint: [[First admin bootstrap]] can leave a
user registered before the catalog is populated. They get 0 mons on
seed; this endpoint fixes them once the admin fills the catalog.

## HTTP surface — [`roster/routes.ts`](backend/src/roster/routes.ts)

| Method | Path                                          | Auth | Purpose                                       |
| ------ | --------------------------------------------- | ---- | --------------------------------------------- |
| GET    | `/api/roster`                                 | user | Owned mons + template views                   |
| POST   | `/api/roster/seed`                            | user | Retry starter seed                            |
| POST   | `/api/roster/party`                           | user | `{ slot: 0-2, monId }` — assign to party slot |
| POST   | `/api/roster/party/remove`                    | user | `{ slot }` — clear a slot                     |
| POST   | `/api/roster/rename/:id`                      | user | `{ nickname }`                                |
| POST   | `/api/roster/revive/:monId`                   | user | Clear `revive_at` (may cost resources)        |
| GET    | `/api/roster/:monId/evolutions`               | user | Returns `EvolutionGate`                        |
| POST   | `/api/roster/:monId/evolve`                   | user | `{ targetCatalogId }` — evolve                |
| GET    | `/api/roster/:monId/skills`                   | user | Available skills for equip                    |
| PUT    | `/api/roster/:monId/skills`                   | user | Set equipped skill IDs                        |

## KOs and revives

- **KO** happens when `hp = 0` at match end (any match — PvP, PvE,
  adventure). Row gets `revive_at = now + duration`. See
  [[Adventure#Constants]] (30-min revive) and
  [[Combat]] for PvP semantics.
- **Revive** — either wait until `revive_at <= now`, or pay to
  short-circuit via `POST /api/roster/revive/:monId` (verify — may
  cost a `revive-scroll` item or NetCore).

A KO'd mon can NOT be selected for a party slot / adventure — the
enqueue endpoint returns `mon-downed`.

## Loadout resolver

`loadPartyLoadout(userId)`
([`routes.ts:234`](backend/src/roster/routes.ts:234)) — turns the
current party's mon rows into `BattleUnit`s ready for combat init.
Resolves:

- Template stats from the XML catalog
- Level + XP + training bonuses
- Equipped skills via
  [`resolveCatalogSkills()`](backend/src/skills/pool.ts)
- Any pending buffs from [[HTTP Surface#Shop, Daily, Friends|the shop
  apply flow]] (`hp_pct` / `en_pct` bonuses consumed at battle start)

Return type is either the loadout OR `{ error, missing: [slot indices] }`
if the party has holes.

## Learned skills history

`learnedSkillsFor()`
([`routes.ts:77`](backend/src/roster/routes.ts:77)) — given the current
template + `evolution_history`, computes every skill the mon has ever
been eligible to learn (prior stages carry forward). Used by
`GET /api/roster/:monId/skills` for the equip UI.

## Related

- [[Combat]] — party loadout feeds `initBattle()`
- [[Matchmaking and MMR]] — `partyTrainedness` + `partyAverageLevel`
  inputs
- [[Nursery and Pen]] — where hatched Babies land (`status='nursery'`
  until graduate)
- [[Adventure]] — party subset of the roster for idle expeditions
- [[Skills catalog]] — the source of learned-pool + resolved skills
- [[HTTP Surface]] — full endpoint listing
