---
tags:
  - digiworld/system
aliases:
  - Farm
  - Farming
  - Resource Generators
  - Factories
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/farm/engine.ts
  - backend/src/farm/routes.ts
verified-at-commit: 97f72ba
---

# Farm

> [!info] TL;DR
> Passive resource production for **Meat**, **Bits**, and **Data** via
> per-user "resource generator" buildings. Production is **computed on
> read** from `last_touch` + `ratePerHour`, capped at `capacity`.
> Collecting banks the accrued value into `resources` and resets the
> checkpoint. Upgrading a building costs **Bits**, and multiplies rate
> ×1.25, capacity ×1.2, next upgrade cost ×1.6.
>
> On top of the passive layer, **factories** run explicit crafting jobs
> that consume `Meat`/`Bits`/`Data` and produce shop items.

## Resource kinds

Verbatim from [`farm/engine.ts:50`](backend/src/farm/engine.ts:50):

```typescript
export type ResourceKind = 'Meat' | 'Bits' | 'Data';
```

- **Meat** — biological consumable
- **Bits** — the upgrade currency for both buildings and factories
- **Data** — advanced crafting resource

## Production math (computed on read)

The formula ([`farm/engine.ts:9`](backend/src/farm/engine.ts) header
comment + [line 128](backend/src/farm/engine.ts:128)):

```typescript
const MS_PER_HOUR = 3_600_000;

// accrued = min(capacity, produced + (now - last_touch) * ratePerHour / MS_PER_HOUR)
function computeProduced(row: FarmBuildingRow, now: number): number {
  const elapsed = now - row.last_touch;
  const accrued = row.produced + (elapsed / MS_PER_HOUR) * row.rate_per_hour;
  return Math.min(row.capacity, accrued);
}
```

Key properties:

- **No background ticker.** The DB doesn't store the "current" produced
  value — only the checkpoint (`produced`, `last_touch`). Every read
  computes on the fly. Cheap, no side effects, no drift.
- **Capacity clamp.** Once `accrued >= capacity` the building stops
  earning until you `collect` — the player has to check in.
- **Race-free checkpoint** ([`farm/engine.ts:75`](backend/src/farm/engine.ts:75)):
  ```sql
  UPDATE farm_buildings
     SET produced = ?, last_touch = ?
   WHERE id = ? AND last_touch = ?
  ```
  The `last_touch = ?` guard makes concurrent collects idempotent —
  whoever writes second sees `changes = 0` and retries the read cycle.

## Buildings

Table: `farm_buildings(user_id, kind, building_type='resource_generator',
resource, level, rate_per_hour, capacity, produced, last_touch,
upgrade_cost, created_at)`.

Every user starts with 4 buildings seeded from
`starterBlueprintsFor('resource_generator')`:

- **Meat Farm** — produces Meat
- **Bit Foundry** — produces Bits
- **Data Spire** — produces Data
- **Bio Lab** — produces Meat (secondary source)

Verify blueprint values in
[`backend/src/admin/blueprints.ts`](backend/src/admin/blueprints.ts) —
the note documents the pattern, not the specific starter numbers, because
blueprints are admin-editable.

## Collect

```typescript
POST /api/farm/collect          // bank every building
POST /api/farm/collect/:id      // bank one building
```

`collectAll` walks all resource_generator buildings, computes each
building's accrued value, upserts into `resources(user_id, resource,
amount, updated_at)`, and resets each checkpoint to `(produced=0,
last_touch=now)`. Amounts round down to integers.

## Upgrade math

Verbatim from [`farm/engine.ts:898-900`](backend/src/farm/engine.ts:898):

```typescript
const newRate = Math.round(row.rate_per_hour * 1.25);   // +25 %
const newCap  = Math.round(row.capacity      * 1.20);   // +20 %
const newCost = Math.round(row.upgrade_cost  * 1.60);   // +60 %
```

Cost is in **Bits**, deducted with the same guarded UPDATE pattern that
kills concurrent double-spends
([`farm/engine.ts:903`](backend/src/farm/engine.ts:903)):

```sql
UPDATE resources
   SET amount = amount - ?, updated_at = ?
 WHERE user_id = ? AND resource = 'Bits' AND amount >= ?
```

`changes = 0` → `insufficient-bits` error with a `needed` field so the
UI can display "you need X more Bits". Guarded UPDATE + explicit rollback
means the building state never mutates when the wallet check fails.

### Exponential curve

Building level `N` — after `N-1` upgrades:

| Metric        | Multiplier from level 1        |
| ------------- | ------------------------------ |
| rate_per_hour | `1.25^(N-1)` — level 5 ≈ 2.44× |
| capacity      | `1.20^(N-1)` — level 5 ≈ 2.07× |
| upgrade_cost  | `1.60^(N-1)` — level 5 ≈ 6.55× |

Cost outruns rate — upgrades get more expensive faster than they pay
themselves back. The curve is intentional; late upgrades are a long-term
investment.

## Factories (crafting layer)

Separate table: `player_factories(user_id, factory_type, level,
upgrade_cost, craft_time_multiplier, ...)`.

- Each factory type has a category (`consumables`, `equipment`, etc.)
- Level bumps reduce `craft_time_multiplier` (faster crafting) at
  increasing Bit cost — see
  [`farm/engine.ts::upgradeFactory`](backend/src/farm/engine.ts) for the
  exact math and `FACTORY_MAX_LEVEL` cap
- Factories run explicit **crafting jobs** — you pick a recipe, pay the
  Meat/Bits/Data cost, wait `craft_time_ms * craft_time_multiplier`, then
  collect

### Crafting job lifecycle

Table: `crafting_jobs(user_id, recipe_id, item_id, factory_id, started_at,
duration_ms, is_auto, collected_at, created_at)`.

```
POST /api/farm/craft
  → recipe check, resource deduct (atomic tx)
  → INSERT crafting_jobs (started_at = now)
  → (client polls; UI shows progress via started_at + duration_ms)

POST /api/farm/craft/collect  (or auto-collect on GET /api/farm)
  → SET collected_at = now on the job
  → INSERT / bump player_inventory.qty
  → Q: is there a queued follow-up? START it.

POST /api/farm/craft/cancel/:jobId  (uncollected jobs only)
  → DELETE the job, refund resources (via same tx)
```

Queued jobs — set via `is_auto=1` on POST — auto-start when the previous
one finishes. Check
[`farm/engine.ts::SQL_START_QUEUED_JOB`](backend/src/farm/engine.ts:118)
for the guarded transition:

```sql
UPDATE crafting_jobs
   SET started_at = ?
 WHERE id = ? AND started_at IS NULL AND collected_at IS NULL
```

The dual `started_at IS NULL AND collected_at IS NULL` guard makes
"start next queued" idempotent — two concurrent collect calls can't
double-start the same follow-up.

## Recipes

Table: `farm_recipes(id, item_id, meat_cost, bits_cost, data_cost,
craft_time_ms, category, enabled, created_at)`.

Seeded from `seedDefaultFarmRecipes()` — 8 recipes at last count (see
`farm.recipes.seed.ok` log line).

`GET /api/farm/recipes` returns the enabled ones joined with `shop_items`
so the UI has names + descriptions.

## HTTP surface (verified against [`farm/routes.ts`](backend/src/farm/routes.ts))

| Method | Path                                    | Purpose                                                  |
| ------ | --------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/farm`                             | Balances + credits + buildings + active/queued jobs      |
| GET    | `/api/farm/recipes`                     | Enabled recipes joined with shop_items                   |
| POST   | `/api/farm/collect`                     | Bank every building                                      |
| POST   | `/api/farm/collect/:id`                 | Bank one building                                        |
| POST   | `/api/farm/upgrade/:id`                 | Upgrade a building (+25 % rate, +20 % cap, +60 % cost)   |
| POST   | `/api/farm/factories/buy`               | Buy a new factory                                        |
| POST   | `/api/farm/factory/upgrade/:id`         | Upgrade a factory (reduce craft_time_multiplier)         |
| POST   | `/api/farm/craft`                       | Start (or queue) a crafting job                          |
| POST   | `/api/farm/craft/cancel/:jobId`         | Cancel an uncollected job, refund resources              |

All routes auth-gated on cookie.

## Player wallet vs resources

Two adjacent tables serve slightly different purposes:

- **`resources`** — the F2P grind currency (Meat / Bits / Data). Bought
  from farm output; spent on upgrades and crafting.
- **`player_wallet`** — the dual-currency wallet (NetCore + Credits) —
  see [[Currency]]. Kept separate so the coin market can't be poisoned by
  a farm exploit.

Deliberate isolation — a bug in the farm engine can NEVER mint NetCore
or Credits. The blast radius stops at Meat/Bits/Data.

## Design notes

> [!info] Why compute-on-read instead of a ticker?
> A ticker would need to touch every player's row every N seconds — O(users)
> writes per tick. The compute-on-read pattern is O(1) writes per collect
> and never touches the DB when the player isn't playing. Free scaling.

> [!info] Why guarded UPDATE + `WHERE amount >= ?`?
> Concurrent request pairs (two tabs, retry storms, matchmaking's
> optimistic tries) can otherwise let a player spend the same 500 Bits
> twice on two different upgrades. The `amount >= ?` clause is the
> concurrency floor; whichever tx commits first wins, the other sees
> `changes = 0` and rolls back everything.

> [!warning] `pnpm dev` on a stale DB
> The migration ledger seeds new default recipes on boot. If you edit
> `seedDefaultFarmRecipes` and want the change to hit an existing DB,
> you may need to `DELETE FROM farm_recipes WHERE id = ?` and let the seed
> re-run — new IDs won't overwrite in-place. See
> [`farm.recipes.seed.ok`](backend/src/farm/engine.ts).

## Related

- [[Architecture Overview]] — where this sits
- [[Currency]] — the OTHER wallet (NTC + Credits, distinct from farm
  resources)
- [[Combat]] — post-match NetCore hits `player_wallet`, not `resources`
- [[HTTP Surface#Farm]]
