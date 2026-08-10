---
tags:
  - digiworld/system
  - digiworld/design
aliases:
  - Skill Archetypes
  - Plant Skills
  - Archetype Design System
  - Plant Skill Pool
created: 2026-08-10
updated: 2026-08-10
grounded-in:
  - backend/src/skills/seeds/plant.ts
  - backend/src/skills/seeds/types.ts
  - backend/src/skills/pool.ts
  - backend/src/skills/dsl.ts
  - backend/src/skills/seed-catalog.ts
  - backend/src/db/migrations/069_skills_signature.sql
  - backend/src/db/migrations/070_wipe_plant_skills.sql
  - shared/src/digimon.ts
verified-at-commit: e9d6e01 (uncommitted working tree — the plant rework had not been committed when this note was written)
---

# Skill Archetypes and the Plant Pool

> [!info] Key decision
> **Archetype is a design concept, not a database column.** There is no
> `archetype` field on `SkillSeed`, no column in `skills_catalog`, and no
> query that filters by archetype. It is a framework for authors writing new
> skill pools — nothing more. A future reader looking for an `archetype`
> column will not find one because it was deliberately left out.

## The two orthogonal axes

Every catalog skill sits on two axes that serve completely different purposes.

### Axis 1: `slot_role` — persisted, runtime-facing

Six values, verbatim from
[`seeds/types.ts`](backend/src/skills/seeds/types.ts):

```typescript
export type SlotRole =
  | 'primary_attack'
  | 'sustain_dot'
  | 'control'
  | 'buff_support'
  | 'utility'
  | 'identity_finisher';
```

`slot_role` is stored in `skills_catalog.slot_role` and drives two concrete
runtime behaviors:

1. **Pool ordering** — `SLOT_ROLE_ORDINAL` in
   [`pool.ts:19-26`](backend/src/skills/pool.ts:19) sorts the learned pool
   so `primary_attack` (ordinal 0) always precedes `identity_finisher`
   (ordinal 5).
2. **Default equip slice** — `getDefaultEquippedForStage()` slices the first
   `EQUIPPED_SLOTS_PER_STAGE[stage]` IDs off that sorted list.
   Caps per stage from [`shared/src/digimon.ts`](shared/src/digimon.ts):

   | Stage     | Equipped slots |
   | --------- | -------------- |
   | Rookie    | 4              |
   | Champion  | 6              |
   | Ultimate  | 8              |
   | Mega      | 10             |

   A Rookie therefore auto-equips its first four slot roles:
   `primary_attack`, `sustain_dot`, `control`, `buff_support` — dropping
   `utility` and `identity_finisher` from the default loadout.

### Axis 2: archetype — design-time only, never persisted

Each element has three archetypes. They are labels that exist only in the
author's head (and in this note) to ensure a pool contains a coherent
thematic spread across the three skill flavors. You cannot query by archetype.
You cannot filter by archetype. The concept has no representation in the DB.

The mapping across all 11 elements:

| Element     | DB id       | Archetype 1    | Archetype 2 | Archetype 3    |
| ----------- | ----------- | -------------- | ----------- | -------------- |
| Fire        | `fire`      | Berserker      | Burst       | DoT            |
| Water       | `water`     | Controller     | Displacer   | Sustain        |
| Wind        | `wind`      | Skirmisher     | Speedster   | Evasion        |
| Electric    | `electricity` | Combo        | Chain       | Stun           |
| Plant       | `plant`     | DoT            | Healer      | Zone Control   |
| Earth       | `earth`     | Tank           | Guardian    | Terrain Control |
| Ice         | `ice`       | Controller     | Lockdown    | Debuffer       |
| Dark        | `dark`      | Assassin       | Debuffer    | Drain          |
| Light       | `light`     | Healer         | Buffer      | Purifier       |
| Metal       | `steel`     | Tank           | Counter     | Fortress       |
| Null        | `null`      | Adaptive       | Trickster   | Wildcard       |

> [!warning] Implementation status
> Only **plant** has been re-authored under this archetype framework. The
> other ten elements still use the original 24-skill grid (4 stages × 6
> slot roles, one skill per slot role per stage). Migration 070 explains
> why plant was wiped and re-seeded rather than patched in place.

> [!info] Null has four archetypes
> Null is listed with four archetypes (Adaptive, Trickster, Wildcard,
> Disruptor). Whether this maps to a different grid size (4 × 4 × 3 = 48
> skills?) is a design decision for when null is re-authored.

---

## Why the two axes co-exist

`slot_role` answers "what mechanical job does this skill do in a team
composition?" — and the runtime needs that answer to build a sensible default
loadout. Archetype answers "what thematic identity does this skill cluster
reinforce?" — and the runtime does not care at all.

Separating them lets a single `slot_role` value (say, `identity_finisher`)
appear in all three archetypes at the same stage. Each archetype's finisher
feels different flavor-wise while still landing in the same slot in the
default equip. This is why the plant re-author produces a 3 × 4 × 3 grid
rather than a 4 × 6 one.

---

## The plant pool: 3 archetypes × 4 stages × 3 skills = 36

Migration [`070_wipe_plant_skills.sql`](backend/src/db/migrations/070_wipe_plant_skills.sql)
dropped all `sk-plant-*` rows and re-seeded via `seedSkillsCatalogV2()`. The
previous pool had 24 skills (4 stages × 6 slot roles). The new pool has 36.

ID naming scheme: `sk-plant-{archetype}-{stage_letter}-{index}` where stage
letters are `r` (Rookie), `c` (Champion), `u` (Ultimate), `m` (Mega).

### Full skill table

Derived verbatim from [`seeds/plant.ts`](backend/src/skills/seeds/plant.ts).

| id | name | name_pt | stage | archetype | slot_role | energyCost |
| -- | ---- | ------- | ----- | --------- | --------- | ---------- |
| `sk-plant-dot-r-1` | Toxic Seed | Semente Tóxica | Rookie | DoT | `sustain_dot` | 7 |
| `sk-plant-dot-r-2` | Thorny Whip | Chicote Espinhoso | Rookie | DoT | `primary_attack` | 9 |
| `sk-plant-dot-r-3` | Creeping Mold | Mofo Rastejante | Rookie | DoT | `utility` | 10 |
| `sk-plant-heal-r-1` | Healing Nectar | Néctar Curativo | Rookie | Healer | `buff_support` | 8 |
| `sk-plant-heal-r-2` | Leaf Shield | Escudo de Folhas | Rookie | Healer | `utility` | 9 |
| `sk-plant-heal-r-3` | Purifying Dew | Orvalho Purificador | Rookie | Healer | `identity_finisher` | 7 |
| `sk-plant-zone-r-1` | Tangleweed | Erva-Emaranhada | Rookie | Zone Control | `control` | 8 |
| `sk-plant-zone-r-2` | Spore Cloud | Nuvem de Esporos | Rookie | Zone Control | `control` | 7 |
| `sk-plant-zone-r-3` | Snapping Trap | Armadilha Mordedora | Rookie | Zone Control | `primary_attack` | 9 |
| `sk-plant-dot-c-1` | Venomous Bloom | Floração Venenosa | Champion | DoT | `sustain_dot` | 12 |
| `sk-plant-dot-c-2` | Acid Sap | Seiva Ácida | Champion | DoT | `primary_attack` | 12 |
| `sk-plant-dot-c-3` | Fungal Spores | Esporos Fúngicos | Champion | DoT | `utility` | 11 |
| `sk-plant-heal-c-1` | Rejuvenating Pollen | Pólen Rejuvenescedor | Champion | Healer | `buff_support` | 12 |
| `sk-plant-heal-c-2` | Photosynthesis | Fotossíntese | Champion | Healer | `utility` | 12 |
| `sk-plant-heal-c-3` | Bark Armor | Armadura de Casca | Champion | Healer | `identity_finisher` | 13 |
| `sk-plant-zone-c-1` | Restricting Vines | Vinhas Restritivas | Champion | Zone Control | `utility` | 12 |
| `sk-plant-zone-c-2` | Paralyzing Stench | Odor Paralisante | Champion | Zone Control | `control` | 12 |
| `sk-plant-zone-c-3` | Flytrap Jaws | Mandíbulas de Dioneia | Champion | Zone Control | `control` | 13 |
| `sk-plant-dot-u-1` | Lethal Blossom | Pétala Letal | Ultimate | DoT | `identity_finisher` | 12 |
| `sk-plant-dot-u-2` | Corrosive Vine | Vinha Corrosiva | Ultimate | DoT | `sustain_dot` | 12 |
| `sk-plant-dot-u-3` | Rotting Roots | Raízes Apodrecidas | Ultimate | DoT | `primary_attack` | 13 |
| `sk-plant-heal-u-1` | Tree of Life | Árvore da Vida | Ultimate | Healer | `buff_support` | 13 |
| `sk-plant-heal-u-2` | Nature's Blessing | Bênção da Natureza | Ultimate | Healer | `utility` | 12 |
| `sk-plant-heal-u-3` | Sylvan Ward | Guarda Silvestre | Ultimate | Healer | `identity_finisher` | 17 |
| `sk-plant-zone-u-1` | Forest Prison | Prisão Florestal | Ultimate | Zone Control | `utility` | 13 |
| `sk-plant-zone-u-2` | Petrifying Gaze | Olhar Petrificante | Ultimate | Zone Control | `control` | 12 |
| `sk-plant-zone-u-3` | Bramble Maze | Labirinto de Sarças | Ultimate | Zone Control | `control` | 17 |
| `sk-plant-dot-m-1` | World Eater's Flower | Flor Devoradora de Mundos | Mega | DoT | `identity_finisher` | 35 |
| `sk-plant-dot-m-2` | Bio-Toxin Drain | Dreno Biotóxico | Mega | DoT | `sustain_dot` | 28 |
| `sk-plant-dot-m-3` | Nature's Decay | Decadência da Natureza | Mega | DoT | `primary_attack` | 38 |
| `sk-plant-heal-m-1` | Yggdrasil's Embrace | Abraço de Yggdrasil | Mega | Healer | `buff_support` | 35 |
| `sk-plant-heal-m-2` | Forest Sanctuary | Santuário Florestal | Mega | Healer | `utility` | 25 |
| `sk-plant-heal-m-3` | Miracle Harvest | Colheita Milagrosa | Mega | Healer | `identity_finisher` | 40 |
| `sk-plant-zone-m-1` | Jungle's Grasp | Aperto da Selva | Mega | Zone Control | `control` | 32 |
| `sk-plant-zone-m-2` | Eternal Slumber | Sono Eterno | Mega | Zone Control | `control` | 28 |
| `sk-plant-zone-m-3` | Ecosystem Lockdown | Bloqueio do Ecossistema | Mega | Zone Control | `control` | 38 |

> [!info] Archetype column is editorial
> The "archetype" column above is derived from the `idSuffix` prefix in
> `plant.ts` (`dot-`, `heal-`, `zone-`). It is not stored anywhere in the
> database or code.

### Notable skill mechanics

Several skills use the `conditional` action kind from
[`dsl.ts`](backend/src/skills/dsl.ts), branching on target state at cast time:

- **Acid Sap** (`dot-c-2`) — fires a bonus `deal_damage` action if the target
  already has the `poison` ailment.
- **Rotting Roots** (`dot-u-3`) — hits harder on a `curse`-afflicted target.
- **Nature's Decay** (`dot-m-3`) — deals full `ignore_defense` damage only if
  target has `poison`; otherwise hits for a tiny fallback amount.
- **Ecosystem Lockdown** (`zone-m-3`) — branches on `silence`: silenced
  targets take a large `ignore_defense` hit, others get a standard hit plus a
  `silence` application.

Three Mega skills carry `tier_2: true`
(`dot-m-1`, `heal-m-1`, `zone-m-1`), making them float to the front of the
equip slice for epic/legendary evolutions — see `getDefaultEquippedForStage()`
in [`pool.ts`](backend/src/skills/pool.ts).

---

## Signature skills — schema exists, data does not

Migration [`069_skills_signature.sql`](backend/src/db/migrations/069_skills_signature.sql)
added two columns to `skills_catalog`:

```sql
ALTER TABLE skills_catalog ADD COLUMN signature INTEGER NOT NULL DEFAULT 0
  CHECK (signature IN (0, 1));
ALTER TABLE skills_catalog ADD COLUMN owner_template_id TEXT;
```

The intent (from the migration comment): a signature is a Digimon's own famous
attack, gated to one `owner_template_id`, surfaced in a dedicated frontend
field separate from the generic element pool.

The pool query in [`pool.ts:28`](backend/src/skills/pool.ts:28) enforces the
separation:

```sql
SELECT * FROM skills_catalog
  WHERE element = ? AND stage IS NOT NULL AND enabled = 1 AND signature = 0
```

`signature = 0` means a signature skill is **invisible to the element pool**
for every mon that doesn't own it. A dedicated function,
`getSignatureSkillsForTemplate(templateId)`, queries the other side:

```sql
SELECT * FROM skills_catalog
  WHERE owner_template_id = ? AND signature = 1 AND enabled = 1
  ORDER BY stage, slot_role
```

`SkillSeed` carries optional `signature` and `owner_template_id` fields
(verbatim from [`seeds/types.ts`](backend/src/skills/seeds/types.ts)) and
`SQL_UPSERT_V2` in `seed-catalog.ts` persists them — so the seeding pipeline
is ready.

> [!warning] No signature skills authored yet
> As of commit `e9d6e01`, no seed file sets `signature: true`. The columns,
> indexes, pool filter, and `getSignatureSkillsForTemplate()` function all
> exist. The data does not. A future author seeds a signature by adding
> `signature: true` and `owner_template_id: 'skb-NNN'` to a `SkillSeed`.

---

## Balance evidence: plant mirror-match results

Test suite: `pnpm --filter @digiworld/backend test:battle-sim`
(requires `DATABASE=sqlite DATABASE_URL=` env prefix — the repo `.env` points at Postgres).

### Post-rework (current, commit `e9d6e01`)

| Stage     | Win  | Loss | Draw | Avg turns |
| --------- | ---- | ---- | ---- | --------- |
| Rookie    | 49   | 48   | 2%   | 41t       |
| Champion  | 50   | 50   | 0%   | 31t       |
| Ultimate  | 50   | 50   | 0%   | 28t       |
| Mega      | 46   | 49   | 5%   | 17t       |

### Pre-rework baseline (original 24-skill grid)

| Stage     | Win  | Loss | Draw | Avg turns |
| --------- | ---- | ---- | ---- | --------- |
| Rookie    | 48   | 52   | 0%   | 47t       |
| Champion  | 54   | 46   | 0%   | 19t       |
| Ultimate  | 51   | 49   | 0%   | 18t       |
| Mega      | 50   | 50   | 0%   | 33t       |

Both Rookie turn counts dropped (47t → 41t), indicating faster battles.
Champion/Ultimate balance is solid. Mega has a 5% draw rate and lower
average turns than any other stage — acceptable given the high-cost finishers
available there.

> [!bug] Intermediate Mega failure — mass-CC + mass-heal stacking
> During authoring, an intermediate version of the Mega pool hit 92% draw
> rate. The cause: stacking zone-control skills with full-party roots/sleep
> alongside full-party heals created a lock where neither side could deal
> meaningful damage. The fix was to reduce multi-target CC to probabilistic
> chances and single-target heal targets (`caster_ally_lowest_hp` rather than
> `caster_ally_all`). **Run the battle sim before calling a pool done.** A
> 92% draw rate is obvious in the numbers and invisible in a playtesting
> session.

---

## Recipe for the next element

To re-author any of the remaining ten elements:

### 1. Define your three archetypes

Pick three thematic identities from the archetype table above. Give each
archetype a short word prefix you'll use in the `idSuffix` (plant uses `dot`,
`heal`, `zone`).

### 2. Fill the grid: 3 archetypes × 4 stages × 3 skills

Each archetype needs exactly 3 skills per stage — one per slot role. You
choose which three slot roles each archetype uses. Across the three
archetypes, every slot role should appear at least once per stage so the pool
has no obvious gaps. The full grid is 36 skills.

### 3. ID naming scheme

```
sk-{element}-{archetype_prefix}-{stage_letter}-{index}
```

Stage letters: `r` = Rookie, `c` = Champion, `u` = Ultimate, `m` = Mega.
Index is `1`, `2`, or `3` within the stage × archetype cell.

Examples from plant: `sk-plant-dot-r-1`, `sk-plant-zone-m-3`.

### 4. Hard schema bounds from `dsl.ts`

All values are enforced by Zod at seed time:

- **`energyCost`**: 0–`MAX_ENERGY` (verify `MAX_ENERGY` in
  `backend/src/digimon/types.ts`; plant Mega skills range 25–40)
- **`cooldown`**: 0–10 turns
- **`apply_status` `chance`**: 0.0–1.0; `turns`: 1–20
- **`modify_stat` `delta`**: -999–999; `turns`: 1–20
- **`shift_initiative` `delta`**: -10–10, non-zero
- **`amount.factor`**: -10.0–10.0 (the stat scaling multiplier)
- **`name`**: 2–48 characters, **UNIQUE constraint across ALL seed files** —
  two skills anywhere in the catalog cannot share a name. This constraint is
  enforced by `ON CONFLICT (name) DO NOTHING` in `SQL_UPSERT_V2`; a duplicate
  silently skips insertion.

### 5. Write the migration to wipe the old element pool

Copy `070_wipe_plant_skills.sql` — substitute the element name. The `NULL`ing
of `upgrade_of` references before the delete prevents FK violations.

### 6. Run both test suites before merging

```bash
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:pool
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:battle-sim
```

`test:pool` checks that pool ordering, carry-forward, and equip slices are
correct. `test:battle-sim` catches balance pathologies — aim for win/loss near
50/50 and draw rate under ~10% at all stages.

---

## Related

- [[Skills catalog]] — `skills_catalog` schema, pool queries, slot-role
  ordinal, default equip logic, the XML resolver
- [[Combat]] — the battle engine that consumes resolved skills at runtime
