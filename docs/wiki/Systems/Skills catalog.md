---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Skills
  - Skills Catalog
  - Learned Pool
  - Skill Slots
  - Skill Resolver
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/skills/pool.ts
  - backend/src/skills/resolve.ts
  - backend/src/skills/catalog.ts
  - backend/src/skills/seed.ts
verified-at-commit: 4e70621
---

# Skills catalog

> [!info] TL;DR
> Admin-editable `skills_catalog` table decouples SKILL DEFINITIONS
> from Digimon templates. Each catalog skill is scoped by
> `(element, stage, slot_role)`. Mons learn skills by
> stage-carry-forward (a Rookie knows every Rookie-stage skill of their
> element; an Ultimate knows Ultimate + Champion + Rookie). Equipped
> slots per stage: 4 Rookie / 6 Champion / 8 Ultimate / 10 Mega.
> Combat uses [[#The resolver]] to override XML-embedded skill stats
> with catalog values at battle start.

## The `skills_catalog` table

```
skills_catalog:
  id             TEXT PRIMARY KEY       -- 'sk-xxxxx'
  name           TEXT
  name_pt        TEXT
  description    TEXT NULL
  description_pt TEXT NULL
  element        TEXT                   -- one of 11 elements
  energy_cost    INTEGER
  cooldown       INTEGER                -- turns; 0 = no cooldown
  stage          TEXT NULL              -- Rookie | Champion | Ultimate | Mega (NULL = legacy/other)
  slot_role      TEXT                   -- primary_attack | sustain_dot | control | buff_support | utility | identity_finisher
  tier_2         INTEGER                -- 0 or 1 (higher-tier variant flag)
  upgrade_of     TEXT NULL              -- id of the tier-1 skill this upgrades
  actions_json   TEXT                   -- DSL action list — the runtime executes these
  enabled        INTEGER                -- 0 or 1
```

`id` prefix: `sk-`. Verify with
[`isCatalogSkillId()`](backend/src/skills/pool.ts:30) — `id.startsWith('sk-')`.

## Stage carry-forward

A mon's LEARNED pool includes every catalog row where `stage_ordinal ≤
current_stage_ordinal` for that element. Verbatim ordinals:

```typescript
const STAGE_ORDINAL: Record<Stage, number> = {
  Baby: 0,
  'In-Training': 1,
  Rookie: 2,
  Champion: 3,
  Ultimate: 4,
  Mega: 5,
};
```

With the standard seed pattern (6 slot roles per stage per element × 11
elements), each stage adds 6 skills:

| Stage      | Cumulative skills known (per element) |
| ---------- | ------------------------------------- |
| Rookie     | 6                                     |
| Champion   | 12                                    |
| Ultimate   | 18                                    |
| Mega       | 24                                    |

## Slot roles

Fixed taxonomy of 6, verbatim from
[`pool.ts:19-26`](backend/src/skills/pool.ts:19):

```typescript
const SLOT_ROLE_ORDINAL: Record<string, number> = {
  primary_attack: 0,
  sustain_dot: 1,
  control: 2,
  buff_support: 3,
  utility: 4,
  identity_finisher: 5,
};
```

- **`primary_attack`** — the go-to damage skill for this stage/element
- **`sustain_dot`** — damage-over-time (burn, poison)
- **`control`** — freeze / stun / sleep / etc.
- **`buff_support`** — atk/def/heal for the caster or allies
- **`utility`** — energy manipulation, cleanse, etc.
- **`identity_finisher`** — signature high-cost skill, often unique to
  the species

The **ordinal is deliberate** — [[#Default equipped]] slices the front
of the sorted list, so lower-role-ordinal (offense-first) skills get
priority.

## Learned pool ordering

`getLearnedPoolIds(element, stage)` returns the sorted skill IDs a mon
of that (element, stage) has learned. Sort order:

1. **By stage descending** — Mega skills first, then Ultimate, then
   Champion, then Rookie.
2. **By slot-role ordinal ascending** — `primary_attack` first,
   `identity_finisher` last.

So a Champion Fire mon's learned pool starts with `[Champion Fire
primary_attack, Champion Fire sustain_dot, ..., Champion Fire
identity_finisher, Rookie Fire primary_attack, ..., Rookie Fire
identity_finisher]`.

## Equipped slot caps per stage

```typescript
export const EQUIPPED_SLOTS_PER_STAGE = {
  Rookie:    4,
  Champion:  6,
  Ultimate:  8,
  Mega:     10,
};
```

A Rookie equips 4 skills at a time out of the 6 it has learned. A Mega
equips 10 out of its 24 learned. The equipped set is stored per-mon in
`player_roster.equipped_skill_ids` (JSON array of catalog IDs).

## Default equipped

[`getDefaultEquippedForStage()`](backend/src/skills/pool.ts) slices the
first `EQUIPPED_SLOTS_PER_STAGE[stage]` IDs off the front of the sorted
learned pool. Concrete results
([`pool.ts:60-66`](backend/src/skills/pool.ts:60)):

- **Rookie** (cap 4) — Rookie tier's `primary_attack`, `sustain_dot`,
  `control`, `buff_support`. Drops `utility` + `identity_finisher`.
- **Champion** (cap 6) — all 6 Champion role skills.
- **Ultimate** (cap 8) — all 6 Ultimate + Champion `primary_attack` +
  Champion `sustain_dot`.
- **Mega** (cap 10) — all 6 Mega + Ultimate `primary_attack` /
  `sustain_dot` / `control` / `buff_support`.

Called on:
- **Fresh nursery collect** — Baby's starting equipped skills
- **Evolve** — new stage's default equipped auto-picked
- **Starter roster seed** — each starter's Rookie loadout

The player can then customize via
`PUT /api/roster/:monId/skills`.

## The XML → catalog resolver — [`resolve.ts`](backend/src/skills/resolve.ts)

Digimon templates in `data/catalog/digimons.xml` carry an embedded
`<skills>` block per digimon — 4 skills each, with names + element +
cost + power. These are the LEGACY source of truth. The DB catalog
adds an admin-editable override layer.

### The resolver

```typescript
export async function getSkillsCatalogResolver(): Promise<SkillsCatalogResolver> {
  const now = Date.now();
  if (cache !== null && now - cache.at < TTL_MS) return cache.map;
  const rows = await q<SkillsCatalogRow>(SQL_LOAD);
  const map = new Map<string, ResolvedOverride>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (map.has(key)) continue;
    map.set(key, {
      name: row.name,
      element: row.element as Element,
      energyCost: row.energy_cost,
      power: extractPowerFromActionsJson(row.actions_json),
      description: row.description,
    });
  }
  cache = { at: now, map };
  return map;
}
```

**Match key**: case-insensitive trimmed skill name. A `<skill name="Pepper
Breath"/>` in XML matches a catalog row named `"pepper breath"` or
`"Pepper Breath"`.

**Override rules** (verbatim from
[`resolve.ts:79-92`](backend/src/skills/resolve.ts:79)):

```typescript
export function resolveSkillFromCatalog(xmlSkill: Skill, resolver): Skill {
  const override = resolver.get(normalizeName(xmlSkill.name));
  if (override === undefined) return xmlSkill;   // no override — XML wins
  const resolved: Skill = {
    id: xmlSkill.id,
    name: override.name,
    element: override.element,
    energyCost: override.energyCost,
    power: override.power,
  };
  // description falls through: override → XML
  // effect + actions are preserved from XML (may co-exist with catalog fields)
  return resolved;
}
```

Priority: catalog wins on `name`, `element`, `energyCost`, `power`,
`description`. XML wins on the ID (stable per-mon) + `effect` +
`actions`.

### 30-second TTL cache

`invalidateSkillsCatalogResolver()` is called by admin skill CRUD
routes so the change lands immediately. Otherwise the TTL is 30 s —
verify with the constant `TTL_MS = 30_000`.

## `actions_json` — the DSL

Each catalog row's `actions_json` field is a JSON array of DSL
actions. The runtime parses via
[`skills/dsl.ts::parseActions()`](backend/src/skills/dsl.ts) and executes
them in [[Combat|combat]] via `applyAction`'s hybrid branch (verify).

Example action shape (verify from a real seed):

```json
[
  { "kind": "deal_damage", "amount": { "base": 210, "scaleWith": "atk" } },
  { "kind": "apply_ailment", "target": "target", "ailment": "burn", "chance": 0.3 }
]
```

`power` on the resolved `Skill` object is extracted from the FIRST
`deal_damage` action's `amount.base`
([`resolve.ts:35-51`](backend/src/skills/resolve.ts:35)) — so a
non-damage skill (`buff_support` / `utility`) shows `power: 0`.

## Seeding

- **`seed.ts`** — the initial 264-skill seed (11 elements × 4 stages × 6
  slot roles). Idempotent — `skills.catalog.seed.ok` boot log with
  `insertedRows`.
- **`seed-catalog.ts`** — legacy alias (verify)
- **`resolve.ts`** — read-time resolver (above)
- **`pool.ts`** — learned-pool + default-equipped compute (above)
- **`catalog.ts`** — admin CRUD (verify)

## HTTP surface

Admin CRUD (verify exact paths in
[`backend/src/admin/routes.ts`](backend/src/admin/routes.ts) or a
separate `skills` plugin):

- `GET /api/admin/skills` — list
- `POST /api/admin/skills` — create
- `PUT /api/admin/skills/:id` — update
- `DELETE /api/admin/skills/:id` — remove

Player-side:

- `GET /api/roster/:monId/skills` — learned pool + currently equipped
- `PUT /api/roster/:monId/skills` — set equipped_skill_ids

## What can go wrong

> [!warning] Duplicate skill name in the catalog
> `getSkillsCatalogResolver()` uses `if (map.has(key)) continue;` —
> FIRST loaded row wins. Order isn't deterministic across dialects
> (SQLite may sort differently than Postgres). Best practice: keep
> catalog `name` unique via a UNIQUE index (verify migration).

> [!warning] XML skill name doesn't exist in catalog
> The mon's skill keeps XML values (name, cost, power). Not broken —
> just uncurated. Verify by scanning
> `SELECT DISTINCT name FROM per_xml_skill` vs `SELECT name FROM
> skills_catalog` for coverage.

> [!warning] Equipped skill IDs invalid after admin edit
> If admin deletes a catalog row that some mon has equipped, the
> next `resolveCatalogSkills()` silently drops that ID (verify —
> `.filter(isCatalogSkillId)` + IN query). The mon fights with fewer
> equipped skills until re-equipped.

## Related

- [[Combat]] — the runtime that consumes resolved `Skill`s
- [[Roster and Party]] — where `equipped_skill_ids` and evolution's
  auto-equip live
- [[Nursery and Pen]] — hatch → starting equipped via
  `getDefaultEquippedForStage()`
- [[HTTP Surface]] — grep for `/api/skills` and `/api/admin/skills`
