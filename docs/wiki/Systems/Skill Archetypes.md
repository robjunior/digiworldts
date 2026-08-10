---
tags:
  - digiworld/system
  - digiworld/design
aliases:
  - Skill Archetypes and Plant Pool
  - Plant Skills
  - Archetype Design System
  - Plant Skill Pool
  - Skill Archetypes
created: 2026-08-10
updated: 2026-08-10
grounded-in:
  - backend/src/skills/seeds/plant.ts
  - backend/src/skills/seeds/dark.ts
  - backend/src/skills/seeds/plant-signatures.ts
  - backend/src/skills/seeds/types.ts
  - backend/src/skills/pool.ts
  - backend/src/skills/dsl.ts
  - backend/src/skills/seed-catalog.ts
  - backend/src/skills/resolve.ts
  - backend/src/db/migrations/069_skills_signature.sql
  - backend/src/db/migrations/070_wipe_plant_skills.sql
  - backend/src/db/migrations/071_wipe_dark_skills.sql
  - backend/src/skills/seeds/light.ts
  - backend/src/db/migrations/072_wipe_light_skills.sql
  - backend/src/skills/seeds/electricity.ts
  - backend/src/skills/seeds/electricity-signatures.ts
  - backend/src/db/migrations/073_wipe_electricity_skills.sql
  - backend/src/skills/seeds/water.ts
  - backend/src/skills/seeds/water-signatures.ts
  - backend/src/db/migrations/074_wipe_water_skills.sql
  - backend/test/initiative-sign.mts
  - backend/test/battle-sim.mts
  - backend/src/battle/engine.ts
  - backend/test/pool-smoke.mts
  - shared/src/digimon.ts
verified-at-commit: b039de9
---

# Skill Archetypes

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

| Element     | DB id         | Archetype 1    | Archetype 2 | Archetype 3     |
| ----------- | ------------- | -------------- | ----------- | --------------- |
| Fire        | `fire`        | Berserker      | Burst       | DoT             |
| Water       | `water`       | Controller     | Displacer   | Sustain         |
| Wind        | `wind`        | Skirmisher     | Speedster   | Evasion         |
| Electric    | `electricity` | Combo          | Chain       | Stun            |
| Plant       | `plant`       | DoT            | Healer      | Zone Control    |
| Earth       | `earth`       | Tank           | Guardian    | Terrain Control |
| Ice         | `ice`         | Controller     | Lockdown    | Debuffer        |
| Dark        | `dark`        | Assassin       | Debuffer    | Drain           |
| Light       | `light`       | Healer         | Buffer      | Purifier        |
| Metal       | `steel`       | Tank           | Counter     | Fortress        |
| Null        | `null`        | Adaptive       | Trickster   | Wildcard        |

> [!warning] Implementation status
> **Plant and dark** have been re-authored under this archetype framework (2 of 11).
> The other nine elements still use the original 24-skill grid (4 stages × 6
> slot roles, one skill per slot role per stage). Migrations 070 and 071
> explain why each element is wiped and re-seeded rather than patched in place.

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
default equip. This is why a re-authored pool produces a 3 × 4 × 3 grid
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

### Notable plant skill mechanics

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

## The dark pool: 3 archetypes × 4 stages × 3 skills = 36

Migration [`071_wipe_dark_skills.sql`](backend/src/db/migrations/071_wipe_dark_skills.sql)
mirrors migration 070 exactly — it nulls `upgrade_of` pointers into the old
`sk-dark-*` rows before deleting them, then `seedSkillsCatalogV2()` re-inserts
the new set. The previous pool had 24 skills; the new pool has 36.

ID naming scheme: `sk-dark-{archetype}-{stage_letter}-{index}`.

Dark's three archetypes from [`seeds/dark.ts`](backend/src/skills/seeds/dark.ts):

- **Assassin** — single-target burst damage, execute pressure gated on
  `hp_below_pct` conditionals, crit and initiative manipulation via
  `apply_buff crit_up` and `shift_initiative`.
- **Debuffer** — stat shredding (`modify_stat` on `atk`/`def`/`int`/`spd`),
  curse/corruption/blind/silence application, and `dispel` to strip enemy
  buffs from the field.
- **Drain** — life and energy theft that sustains off the enemy: `drain`
  actions return a `heal_pct` fraction of the damage dealt back to the caster,
  and several skills also call `restore_en` or `apply_buff` to compound the
  self-sustain.

### Full dark skill table

Derived verbatim from [`seeds/dark.ts`](backend/src/skills/seeds/dark.ts).

| id | name | name_pt | stage | archetype | slot_role | energyCost |
| -- | ---- | ------- | ----- | --------- | --------- | ---------- |
| `sk-dark-assassin-r-1` | Night Shank | Estocada Noturna | Rookie | Assassin | `primary_attack` | 7 |
| `sk-dark-assassin-r-2` | Silent Step | Passo Silencioso | Rookie | Assassin | `buff_support` | 8 |
| `sk-dark-assassin-r-3` | Throat Slit | Corte na Garganta | Rookie | Assassin | `identity_finisher` | 10 |
| `sk-dark-debuff-r-1` | Gloom Hex | Feitiço da Penumbra | Rookie | Debuffer | `control` | 8 |
| `sk-dark-debuff-r-2` | Erosive Aura | Aura Erosiva | Rookie | Debuffer | `utility` | 9 |
| `sk-dark-debuff-r-3` | Dimming Light | Luz Ofuscante | Rookie | Debuffer | `primary_attack` | 7 |
| `sk-dark-drain-r-1` | Soul Sip | Gole de Alma | Rookie | Drain | `sustain_dot` | 8 |
| `sk-dark-drain-r-2` | Vampiric Bite | Mordida Vampírica | Rookie | Drain | `primary_attack` | 9 |
| `sk-dark-drain-r-3` | Vitality Theft | Roubo de Vitalidade | Rookie | Drain | `utility` | 10 |
| `sk-dark-assassin-c-1` | Midnight Piercer | Perfurador da Meia-Noite | Champion | Assassin | `primary_attack` | 12 |
| `sk-dark-assassin-c-2` | Shadow Meld | Fusão Sombria | Champion | Assassin | `buff_support` | 13 |
| `sk-dark-assassin-c-3` | Fatal Ambush | Emboscada Fatal | Champion | Assassin | `identity_finisher` | 15 |
| `sk-dark-debuff-c-1` | Abyssal Shackles | Grilhões Abissais | Champion | Debuffer | `control` | 13 |
| `sk-dark-debuff-c-2` | Spell Breaker | Quebrador de Feitiços | Champion | Debuffer | `utility` | 14 |
| `sk-dark-debuff-c-3` | Suffocating Veil | Véu Sufocante | Champion | Debuffer | `utility` | 15 |
| `sk-dark-drain-c-1` | Essence Drain | Dreno de Essência | Champion | Drain | `sustain_dot` | 14 |
| `sk-dark-drain-c-2` | Blood Hex | Feitiço de Sangue | Champion | Drain | `primary_attack` | 13 |
| `sk-dark-drain-c-3` | Parasitic Link | Elo Parasitário | Champion | Drain | `utility` | 15 |
| `sk-dark-assassin-u-1` | Eclipse Dagger | Adaga do Eclipse | Ultimate | Assassin | `primary_attack` | 15 |
| `sk-dark-assassin-u-2` | Unseen Terror | Terror Invisível | Ultimate | Assassin | `utility` | 16 |
| `sk-dark-assassin-u-3` | Guillotine Drop | Queda da Guilhotina | Ultimate | Assassin | `identity_finisher` | 20 |
| `sk-dark-debuff-u-1` | Total Eclipse | Eclipse Total | Ultimate | Debuffer | `control` | 18 |
| `sk-dark-debuff-u-2` | Sensory Deprivation | Privação Sensorial | Ultimate | Debuffer | `utility` | 16 |
| `sk-dark-debuff-u-3` | Purge Hope | Expurgar a Esperança | Ultimate | Debuffer | `utility` | 20 |
| `sk-dark-drain-u-1` | Life Syphon | Sifão de Vida | Ultimate | Drain | `sustain_dot` | 18 |
| `sk-dark-drain-u-2` | Devour Spirit | Devorar Espírito | Ultimate | Drain | `primary_attack` | 19 |
| `sk-dark-drain-u-3` | Crimson Feast | Banquete Carmesim | Ultimate | Drain | `buff_support` | 20 |
| `sk-dark-assassin-m-1` | Void Ripper | Estripador do Vazio | Mega | Assassin | `primary_attack` | 24 |
| `sk-dark-assassin-m-2` | Time Assassination | Assassinato Temporal | Mega | Assassin | `control` | 28 |
| `sk-dark-assassin-m-3` | Reapers Toll | Pedágio do Ceifador | Mega | Assassin | `identity_finisher` | 35 |
| `sk-dark-debuff-m-1` | Event Horizon | Horizonte de Eventos | Mega | Debuffer | `control` | 35 |
| `sk-dark-debuff-m-2` | Absolute Despair | Desespero Absoluto | Mega | Debuffer | `utility` | 28 |
| `sk-dark-debuff-m-3` | Void Stare | Olhar do Vazio | Mega | Debuffer | `sustain_dot` | 26 |
| `sk-dark-drain-m-1` | Soul Devourer | Devorador de Almas | Mega | Drain | `sustain_dot` | 35 |
| `sk-dark-drain-m-2` | Blood Moon | Lua de Sangue | Mega | Drain | `identity_finisher` | 30 |
| `sk-dark-drain-m-3` | Eternal Thirst | Sede Eterna | Mega | Drain | `buff_support` | 32 |

> [!info] Archetype column is editorial
> Derived from the `idSuffix` prefix (`assassin-`, `debuff-`, `drain-`).
> Not stored in the database or code.

### Notable dark skill mechanics

- **Throat Slit** (`assassin-r-3`) and **Guillotine Drop** (`assassin-u-3`) —
  fire a bonus `deal_damage` action when the target is below a `hp_below_pct`
  threshold (40% and 50% respectively). **Void Ripper** (`assassin-m-1`) adds
  `ignore_defense` to the base hit and fires the same conditional at 60%.
- **Fatal Ambush** (`assassin-c-3`) and **Time Assassination** (`assassin-m-2`)
  — call `shift_initiative` with `delta: -1` and `delta: -2` to push the
  target back in turn order; **Unseen Terror** (`assassin-u-2`) pushes the
  whole enemy front line with `delta: -1`.
- **Spell Breaker** (`debuff-c-2`) and **Absolute Despair** (`debuff-m-2`) —
  `dispel` action strips current buffs before dealing damage.
  **Purge Hope** (`debuff-u-3`) `dispel`s the enemy front line then fires a
  conditional `modify_stat def -40` if the target already has `curse`.
- **Devour Spirit** (`drain-u-2`) — drains MORE when the target is healthy
  (`hp_above_pct: 60`), inverting the usual "finish the weak" pattern.
- **Soul Devourer** (`drain-m-1`), **Reapers Toll** (`assassin-m-3`), and
  **Event Horizon** (`debuff-m-1`) carry `tier_2: true` and `cooldown: 2`,
  floating them to the front of the Mega equip slice.

---

## The light pool: 3 archetypes × 4 stages × 3 skills = 36

Committed in `672a1b1`. Wipe migration:
[`072_wipe_light_skills.sql`](backend/src/db/migrations/072_wipe_light_skills.sql),
a direct mirror of 070 and 071 — null every `upgrade_of` pointing into
`sk-light-%`, then delete those rows.

Light's element identity is **buffs / healing / purification**. Its three
archetypes split the kit by how it contributes to a win:

- **Healer** — direct restoration. Single-target triage, party heals,
  regeneration, and emergency saves gated on `hp_below_pct`.
- **Buffer** — force multiplication. `atk_up` / `def_up` / `spd_up` /
  `int_up` / `crit_up` / `accuracy_up`, shields, damage reduction. Wins by
  making allies better rather than by out-healing incoming damage.
- **Purifier** — `cleanse` on allies, `dispel` on enemies, and holy damage
  that punishes the afflicted. This is the archetype that actually closes
  fights.

> [!danger] Light was the highest stall risk of all eleven elements
> All three of light's archetypes are sustain-flavoured. That is precisely the
> failure mode that broke an early plant draft into 92% draws — except light
> can reach it on heals and shields **alone**, with no crowd control involved
> at all. If party restoration per turn outpaces the enemy kit's damage per
> turn, a mirror match simply never resolves.
>
> Four guardrails were designed in from the start rather than tuned in
> afterwards:
> 1. Party-wide (`caster_ally_all`) heals are strictly weaker per cast than
>    single-target ones, and stay well under one enemy skill's damage.
> 2. No skill pairs a full-party heal with `extra_turn`. That combination is
>    a stall engine.
> 3. `invulnerable` is 1 turn and narrow (`self` or `caster_ally_lowest_hp`),
>    never `caster_ally_all` across multiple turns.
> 4. The Purifier archetype carries real offensive scaling, so the element
>    has a win condition instead of only a survival plan.
>
> The result held: 0% draws at every stage on the first authoring pass.

### Full light skill table

⭐ marks the `tier_2: true` skill of each archetype at Mega.

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-light-buff-r-1` | Radiant Wall | Parede Radiante | Rookie | Buffer | `buff_support` | 8 |
| `sk-light-buff-r-2` | Luminous Strike | Golpe Luminoso | Rookie | Buffer | `primary_attack` | 8 |
| `sk-light-buff-r-3` | Dazzling Flash | Clarão Ofuscante | Rookie | Buffer | `control` | 9 |
| `sk-light-heal-r-1` | Mending Light | Luz Reparadora | Rookie | Healer | `sustain_dot` | 6 |
| `sk-light-heal-r-2` | Soft Glow | Brilho Suave | Rookie | Healer | `buff_support` | 8 |
| `sk-light-heal-r-3` | Rescue Beacon | Farol de Resgate | Rookie | Healer | `utility` | 7 |
| `sk-light-purify-r-1` | Cleansing Beam | Feixe Purificador | Rookie | Purifier | `primary_attack` | 9 |
| `sk-light-purify-r-2` | Holy Wash | Banho Sagrado | Rookie | Purifier | `utility` | 8 |
| `sk-light-purify-r-3` | Sun Smite | Golpe do Sol | Rookie | Purifier | `identity_finisher` | 10 |
| `sk-light-buff-c-1` | Shining Barrier | Barreira Brilhante | Champion | Buffer | `buff_support` | 14 |
| `sk-light-buff-c-2` | Brilliant Strike | Golpe Brilhante | Champion | Buffer | `primary_attack` | 14 |
| `sk-light-buff-c-3` | Blinding Flash | Clarão Cegante | Champion | Buffer | `control` | 15 |
| `sk-light-heal-c-1` | Restoring Light | Luz Restauradora | Champion | Healer | `sustain_dot` | 12 |
| `sk-light-heal-c-2` | Warm Radiance | Radiância Quente | Champion | Healer | `buff_support` | 14 |
| `sk-light-heal-c-3` | Savior's Beacon | Farol do Salvador | Champion | Healer | `utility` | 13 |
| `sk-light-purify-c-1` | Expelling Beam | Feixe Expulsor | Champion | Purifier | `primary_attack` | 15 |
| `sk-light-purify-c-2` | Sacred Wash | Banho Divino | Champion | Purifier | `utility` | 13 |
| `sk-light-purify-c-3` | Solar Smite | Golpe Solar | Champion | Purifier | `identity_finisher` | 16 |
| `sk-light-buff-u-1` | Aegis of Light | Égide de Luz | Ultimate | Buffer | `buff_support` | 22 |
| `sk-light-buff-u-2` | Glorious Strike | Golpe Glorioso | Ultimate | Buffer | `primary_attack` | 22 |
| `sk-light-buff-u-3` | Searing Flash | Clarão Cauterizante | Ultimate | Buffer | `control` | 20 |
| `sk-light-heal-u-1` | Renewing Light | Luz Renovadora | Ultimate | Healer | `sustain_dot` | 18 |
| `sk-light-heal-u-2` | Heavenly Radiance | Radiância Celestial | Ultimate | Healer | `buff_support` | 20 |
| `sk-light-heal-u-3` | Guardian's Beacon | Farol do Guardião | Ultimate | Healer | `utility` | 18 |
| `sk-light-purify-u-1` | Banishing Beam | Feixe Banidor | Ultimate | Purifier | `primary_attack` | 24 |
| `sk-light-purify-u-2` | Divine Wash | Banho Celestial | Ultimate | Purifier | `utility` | 20 |
| `sk-light-purify-u-3` | Astral Smite | Golpe Astral | Ultimate | Purifier | `identity_finisher` | 24 |
| `sk-light-buff-m-1` | Bastion of Light ⭐ | Bastião de Luz | Mega | Buffer | `buff_support` | 34 |
| `sk-light-buff-m-2` | Transcendent Strike | Golpe Transcendente | Mega | Buffer | `primary_attack` | 32 |
| `sk-light-buff-m-3` | Supernova Flash | Clarão de Supernova | Mega | Buffer | `control` | 28 |
| `sk-light-heal-m-1` | Eternal Light | Luz Eterna | Mega | Healer | `sustain_dot` | 28 |
| `sk-light-heal-m-2` | Sovereign Radiance | Radiância Soberana | Mega | Healer | `buff_support` | 30 |
| `sk-light-heal-m-3` | Seraph's Beacon ⭐ | Farol do Serafim | Mega | Healer | `utility` | 32 |
| `sk-light-purify-m-1` | Eradicating Beam | Feixe Erradicador | Mega | Purifier | `primary_attack` | 36 |
| `sk-light-purify-m-2` | Ultimate Wash | Banho Definitivo | Mega | Purifier | `utility` | 30 |
| `sk-light-purify-m-3` | Genesis Smite ⭐ | Golpe da Gênese | Mega | Purifier | `identity_finisher` | 40 |

### Notable light skill mechanics

- `conditional` in 6 skills, `cleanse` in 6, `dispel` in 5 — the highest
  cleanse/dispel density of any element so far, which is the Purifier
  archetype expressed mechanically.
- Every stage covers all six `slot_role` values. This matters more for light
  than for any other element: because the default equip slices by slot-role
  order, a stage stacked with `buff_support` would hand the mon a kit with no
  damage and guarantee the stall described above.
- Each archetype runs an `upgrade_of` chain from Rookie to Mega.

---

## The electricity pool: 3 archetypes × 4 stages × 3 skills = 36

Committed in `9161f04`. Wipe migration:
[`073_wipe_electricity_skills.sql`](backend/src/db/migrations/073_wipe_electricity_skills.sql).

> [!caution] The id prefix is `sk-elec-`, not `sk-electricity-`
> The factory is `makeSkillFactory('electricity', 'elec')`, so every id comes
> out as `sk-elec-*`. A wipe migration written against the element name would
> have matched zero rows and silently left all 24 stale skills in place to
> shadow the new pool — the seeder upserts `ON CONFLICT (name) DO NOTHING`, so
> the survivors would have won. Check the factory's second argument before
> writing the migration for any element.

Electricity's element identity is **combos / chained attacks**:

- **Combo** — multi-step sequences. `shift_initiative` on self to act sooner,
  `conditional` follow-ups that pay off when a setup already landed, and the
  file's only two `extra_turn` uses, both behind cooldowns.
- **Chain** — damage that jumps across the enemy team via `enemy_all`,
  `enemy_first_two` and `enemy_random`, with `restore_en` so chaining pays
  for itself.
- **Stun** — action denial via `stun`, `spd` shredding, and positive
  `shift_initiative` on enemies to push them down the turn queue.

This element carries stall risk in **both** directions. The Stun archetype can
reproduce the plant Mega lock — mass `stun` on `enemy_all` at high chance
across three Mega skills is a hard lock. But electricity's Mega baseline was
only 5t, so over-scaled chain damage collapses matches into an initiative coin
flip, which is its own failure. Both were watched; it lands at 7t.

### Full electricity skill table

⭐ marks the `tier_2: true` skill of each archetype at Mega.

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-elec-chain-r-1` | Arcing Zap | Zap em Arco | Rookie | Chain | `primary_attack` | 8 |
| `sk-elec-chain-r-2` | Chain Volt | Volt em Cadeia | Rookie | Chain | `identity_finisher` | 10 |
| `sk-elec-chain-r-3` | Static Cling | Aderência Estática | Rookie | Chain | `sustain_dot` | 7 |
| `sk-elec-combo-r-1` | Flash Strike | Golpe Relâmpago | Rookie | Combo | `primary_attack` | 9 |
| `sk-elec-combo-r-2` | Spark Step | Passo de Faísca | Rookie | Combo | `utility` | 8 |
| `sk-elec-combo-r-3` | Volt Charge | Carga de Volts | Rookie | Combo | `buff_support` | 8 |
| `sk-elec-stun-r-1` | Taser Grip | Agarre de Taser | Rookie | Stun | `control` | 8 |
| `sk-elec-stun-r-2` | Static Guard | Guarda Estática | Rookie | Stun | `buff_support` | 7 |
| `sk-elec-stun-r-3` | Stun Gun | Arma de Choque | Rookie | Stun | `utility` | 8 |
| `sk-elec-chain-c-1` | Branching Spark | Faísca Ramificada | Champion | Chain | `primary_attack` | 13 |
| `sk-elec-chain-c-2` | Energy Relay | Revezamento de Energia | Champion | Chain | `buff_support` | 12 |
| `sk-elec-chain-c-3` | Tesla Field | Campo de Tesla | Champion | Chain | `sustain_dot` | 12 |
| `sk-elec-combo-c-1` | Lightning Dash | Investida Relâmpago | Champion | Combo | `primary_attack` | 14 |
| `sk-elec-combo-c-2` | Volt Switch | Troca de Voltagem | Champion | Combo | `utility` | 12 |
| `sk-elec-combo-c-3` | Kinetic Finish | Finalizador Cinético | Champion | Combo | `identity_finisher` | 15 |
| `sk-elec-stun-c-1` | Volt Clamp | Grampo de Volts | Champion | Stun | `control` | 13 |
| `sk-elec-stun-c-2` | Paralyzing Wire | Fio Paralisante | Champion | Stun | `sustain_dot` | 12 |
| `sk-elec-stun-c-3` | Nerve Shock | Choque Nervoso | Champion | Stun | `utility` | 12 |
| `sk-elec-chain-u-1` | Grid Surge | Surto na Rede | Ultimate | Chain | `primary_attack` | 20 |
| `sk-elec-chain-u-2` | Conductive Web | Teia Condutora | Ultimate | Chain | `sustain_dot` | 18 |
| `sk-elec-chain-u-3` | Chain Stagger | Retardo em Cadeia | Ultimate | Chain | `control` | 18 |
| `sk-elec-combo-u-1` | Plasma Assault | Assalto de Plasma | Ultimate | Combo | `identity_finisher` | 22 |
| `sk-elec-combo-u-2` | Speed Force | Força de Velocidade | Ultimate | Combo | `utility` | 18 |
| `sk-elec-combo-u-3` | Circuit Overclock | Sobrecarga de Circuito | Ultimate | Combo | `buff_support` | 18 |
| `sk-elec-stun-u-1` | Voltage Prison | Prisão de Voltagem | Ultimate | Stun | `control` | 20 |
| `sk-elec-stun-u-2` | Electrocution | Eletrocussão | Ultimate | Stun | `primary_attack` | 20 |
| `sk-elec-stun-u-3` | Faraday Cage | Gaiola de Faraday | Ultimate | Stun | `buff_support` | 18 |
| `sk-elec-chain-m-1` | Neural Network ⭐ | Rede Neural | Mega | Chain | `primary_attack` | 36 |
| `sk-elec-chain-m-2` | Infinite Conductivity | Condutividade Infinita | Mega | Chain | `sustain_dot` | 28 |
| `sk-elec-chain-m-3` | Energy Harvest | Colheita de Energia | Mega | Chain | `utility` | 30 |
| `sk-elec-combo-m-1` | Tachyon Execution ⭐ | Execução de Táquions | Mega | Combo | `identity_finisher` | 35 |
| `sk-elec-combo-m-2` | Quantum Leap | Salto Quântico | Mega | Combo | `utility` | 38 |
| `sk-elec-combo-m-3` | Lightning Reflexes | Reflexos de Relâmpago | Mega | Combo | `buff_support` | 25 |
| `sk-elec-stun-m-1` | Synapse Lock ⭐ | Bloqueio de Sinapse | Mega | Stun | `control` | 35 |
| `sk-elec-stun-m-2` | Ampere Bastion | Bastião de Ampère | Mega | Stun | `buff_support` | 28 |
| `sk-elec-stun-m-3` | System Blackout | Apagão do Sistema | Mega | Stun | `sustain_dot` | 32 |

### Notable electricity skill mechanics

- 5 `conditional`, 14 `shift_initiative`, 2 `restore_en`, 2 `extra_turn`.
- Every stage covers all six `slot_role` values.
- Each archetype runs an `upgrade_of` chain from Rookie to Mega.

---

## Electricity signatures — 62 seeded

Committed in `f3d8f94`. Two per each of the 31 electricity Digimon, same
mechanism as the plant set: `signature: true` + `owner_template_id`, excluded
from the generic pool by the `signature = 0` filter.

Four names needed the collision suffix — the source material genuinely reuses
attack names across Digimon. `Lightning Javelin` is shared by MegaSeadramon
and SkullSeadramon; `Golden Triangle` by Rapidmon and its Armor form. The
English `name` carries the owner in parentheses; `name_pt` stays clean.

No electricity Digimon has an all-filler moveset — unlike plant, which had
four — but **seventeen** had tiered move-pool filler (`Nanomachine Break II`,
`Thunder Fall III`) as their second-best candidate. Those slots were authored
originally instead: Vespa Voltage, Railgun Overrun, Hive Capacitor, Abyssal
Thunder Coil, Chrome Capacitor, Reactor Jaw, Chaos Grid Barrage, Hi-Tension
Barrier, Corrosion Spark, Royal Volt Guard, Stormwing Cry, Spark Anchor, Bone
Current, Storm Hoof, Pilot Spark Net, Gold Radar Lock, Miracle Circuit.

`slot_role` distribution: 19 `identity_finisher`, 16 `control`, 14
`primary_attack`, 7 `sustain_dot`, 3 `buff_support`, 3 `utility`. Compare the
plant set, which initially shipped 65 of 72 as `primary_attack` and had to be
redone.

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Betamon | `skb-389` | Rookie | Electric Shock | Water Tower |
| Elecmon | `skb-564` | Rookie | Sparkling Thunder | Thunder Knife |
| Kokuwamon | `skb-609` | Rookie | Mini Scissor Claw | Elect-Elect |
| Lighdramon | `skb-139` | Rookie | Lightning Blade | Thunderbolt |
| Rapidmon (Armor) | `skb-751` | Rookie | Golden Triangle (Rapidmon Armor) | Miracle Circuit |
| Tentomon | `skb-303` | Rookie | Super Shocker | Katai Tsume |
| Aegiomon | `skb-183` | Champion | Stun Beat Blow | Storm Hoof |
| Centarumon | `skb-372` | Champion | Hunting Cannon | Energy Ray |
| Kabuterimon | `skb-304` | Champion | Electro Shocker | Danger Sting |
| Mekanorimon | `skb-615` | Champion | Twinkle Beam | Pilot Spark Net |
| Waspmon | `skb-454` | Champion | Turbo Stinger | Vespa Voltage |
| Wizardmon | `skb-377` | Champion | Thunder Cloud | Terror Illusion |
| Aegiochusmon | `skb-184` | Ultimate | Bolt Break Knockdown | Lightning Pile |
| Andromon | `skb-342` | Ultimate | Spiral Sword | Gatling Missile Rensha Mode |
| CannonBeemon | `skb-727` | Ultimate | Nitro Stinger | Hive Capacitor |
| MegaSeadramon | `skb-132` | Ultimate | Lightning Javelin (MegaSeadramon) | Abyssal Thunder Coil |
| MetalMamemon | `skb-413` | Ultimate | Energy Bomb | Chrome Capacitor |
| MetalTyrannomon | `skb-364` | Ultimate | Nuclear Laser | Reactor Jaw |
| Parrotmon | `skb-414` | Ultimate | Mjölnir Thunder | Stormwing Cry |
| Rapidmon | `skb-722` | Ultimate | Golden Triangle (Rapidmon) | Gold Radar Lock |
| SkullSeadramon | `skb-908` | Ultimate | Lightning Javelin (SkullSeadramon) | Bone Current |
| Zudomon | `skb-345` | Ultimate | None | Spark Anchor |
| Chaosdramon | `skb-422` | Mega | Hyper Infinity Cannon | Chaos Grid Barrage |
| GroundLocomon | `skb-704` | Mega | Destruction Crush | Railgun Overrun |
| HerculesKabuterimon | `skb-306` | Mega | Giga Blaster | Kyodai Hasami |
| HiAndromon | `skb-426` | Mega | Atomic Ray | Hi-Tension Barrier |
| Machinedramon | `skb-385` | Mega | Infinity Cannon | Mugen Hand |
| Ouryumon | `skb-193` | Mega | Eiseiryuojin | Golden Armor |
| Ravemon | `skb-740` | Mega | Ame no Ohabari | Spiral Raven Claw |
| RustTyrannomon | `skb-383` | Mega | Terrors Cluster | Corrosion Spark |
| TigerVespamon | `skb-745` | Mega | Mach Stinger V | Royal Volt Guard |

---

## The water pool: 3 archetypes × 4 stages × 3 skills = 36

Committed in `dd81a79`. Wipe migration:
[`074_wipe_water_skills.sql`](backend/src/db/migrations/074_wipe_water_skills.sql).

This rework did double duty — it also retired the worst row in the entire
balance matrix. See [the Champion stall](#the-water-champion-stall-31-draws-over-339-turns)
below.

Water's element identity is **control / displacement**:

- **Controller** — shaping what the enemy can do: `freeze`, `root`,
  `confusion`, `blind`, accuracy and speed denial.
- **Displacer** — turn-order and positioning manipulation. `shift_initiative`
  on enemies to push them down the queue, plus `dispel`. Water's "wash them
  away" fantasy.
- **Sustain** — healing and cleansing, **deliberately budgeted**. This is the
  archetype that broke the old pool, so it runs on the shortest leash:
  single-target and `caster_ally_lowest_hp` heals over party-wide ones, and
  the archetype carries real damage of its own.

### Full water skill table

⭐ marks the `tier_2: true` skill of each archetype at Mega.

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-water-control-r-1` | Rime Bubble | Bolha de Geada | Rookie | Controller | `control` | 8 |
| `sk-water-control-r-2` | Silt Snare | Laço de Lodo | Rookie | Controller | `utility` | 9 |
| `sk-water-control-r-3` | Mirror Spray | Borrifo Espelhado | Rookie | Controller | `identity_finisher` | 10 |
| `sk-water-displace-r-1` | Undertow Jab | Estocada de Ressaca | Rookie | Displacer | `primary_attack` | 8 |
| `sk-water-displace-r-2` | Foam Break | Quebra-Espuma | Rookie | Displacer | `control` | 7 |
| `sk-water-displace-r-3` | Backwash Feint | Finta de Refluxo | Rookie | Displacer | `utility` | 9 |
| `sk-water-sustain-r-1` | Tidepatch | Remendo da Maré | Rookie | Sustain | `sustain_dot` | 6 |
| `sk-water-sustain-r-2` | Clearwater Guard | Guarda de Água Clara | Rookie | Sustain | `buff_support` | 8 |
| `sk-water-sustain-r-3` | Brackish Counter | Contra-Ataque Salobro | Rookie | Sustain | `primary_attack` | 9 |
| `sk-water-control-c-1` | Glacial Bubble | Bolha Glacial | Champion | Controller | `control` | 13 |
| `sk-water-control-c-2` | Quagmire Snare | Laço de Brejo | Champion | Controller | `utility` | 14 |
| `sk-water-control-c-3` | Hall of Ripples | Salão de Ondulações | Champion | Controller | `identity_finisher` | 16 |
| `sk-water-displace-c-1` | Riptide Spear | Lança de Correnteza | Champion | Displacer | `primary_attack` | 14 |
| `sk-water-displace-c-2` | Breaker Foam | Espuma Rompente | Champion | Displacer | `control` | 12 |
| `sk-water-displace-c-3` | Eddy Step | Passo do Remanso | Champion | Displacer | `utility` | 15 |
| `sk-water-sustain-c-1` | Surgeon Tide | Maré Cirurgiã | Champion | Sustain | `sustain_dot` | 12 |
| `sk-water-sustain-c-2` | Blueglass Ward | Proteção de Vidro Azul | Champion | Sustain | `buff_support` | 13 |
| `sk-water-sustain-c-3` | Saltline Reprisal | Revide da Linha Salgada | Champion | Sustain | `primary_attack` | 15 |
| `sk-water-control-u-1` | Cryo Sphere | Esfera Crio | Ultimate | Controller | `control` | 17 |
| `sk-water-control-u-2` | Boglock Snare | Laço Trava-Brejo | Ultimate | Controller | `utility` | 19 |
| `sk-water-control-u-3` | Labyrinth Current | Corrente Labiríntica | Ultimate | Controller | `identity_finisher` | 23 |
| `sk-water-displace-u-1` | Riptide Lance | Lança da Maré Viva | Ultimate | Displacer | `primary_attack` | 18 |
| `sk-water-displace-u-2` | Reefbreaker Foam | Espuma Quebra-Recife | Ultimate | Displacer | `control` | 16 |
| `sk-water-displace-u-3` | Gyre Stride | Passada do Giro | Ultimate | Displacer | `utility` | 22 |
| `sk-water-sustain-u-1` | Lifeboat Tide | Maré Bote-Salva-Vidas | Ultimate | Sustain | `sustain_dot` | 16 |
| `sk-water-sustain-u-2` | Seaglass Bastion | Bastião de Vidro-Marinho | Ultimate | Sustain | `buff_support` | 18 |
| `sk-water-sustain-u-3` | Brineblade Reprisal | Revide da Lâmina Salina | Ultimate | Sustain | `primary_attack` | 20 |
| `sk-water-control-m-1` | Absolute Zero Sphere | Esfera de Zero Absoluto | Mega | Controller | `control` | 24 |
| `sk-water-control-m-2` | Abyssal Quagmire | Brejo Abissal | Mega | Controller | `utility` | 28 |
| `sk-water-control-m-3` | Leviathan Maze ⭐ | Labirinto do Leviatã | Mega | Controller | `identity_finisher` | 34 |
| `sk-water-displace-m-1` | Maelstrom Harpoon | Arpão do Maelström | Mega | Displacer | `primary_attack` | 26 |
| `sk-water-displace-m-2` | Tidebreaker Verdict | Veredito Quebra-Maré | Mega | Displacer | `control` | 24 |
| `sk-water-displace-m-3` | Worldcurrent Overrun ⭐ | Atropelo da Corrente-Mundo | Mega | Displacer | `utility` | 36 |
| `sk-water-sustain-m-1` | Mercy Tide | Maré da Misericórdia | Mega | Sustain | `sustain_dot` | 22 |
| `sk-water-sustain-m-2` | Pearl Bastion | Bastião de Pérola | Mega | Sustain | `buff_support` | 25 |
| `sk-water-sustain-m-3` | Abyssal Reprisal ⭐ | Revide Abissal | Mega | Sustain | `primary_attack` | 32 |

### Notable water skill mechanics

- 8 `conditional`, 11 `shift_initiative`, 4 `dispel`, 4 `cleanse`.
- Every stage covers all six `slot_role` values.
- Each archetype runs an `upgrade_of` chain from Rookie to Mega.

---

## The water Champion stall: 31% draws over 339 turns

Fixed by the rework in `dd81a79`. Unlike the `silence` and `shift_initiative`
findings, this one was neither a harness bug nor a sign error — the content
was simply unwinnable.

Water Champion resolved at **31% draws over ~339 turns**, against every other
element's Champion finishing in 15-38. The Champion tier had exactly six
skills and the default equip takes exactly six slots
(`EQUIPPED_SLOTS_PER_STAGE.Champion === 6`), so **both mirrored sides equipped
all of them** — and three of the six were heals:

| Old Champion skill | What it did |
| ------------------ | ----------- |
| Torrential Wave | `enemy_all` 25 + 1.2×int — the only real AoE damage |
| Healing Rain | `caster_ally_all` heal 50 + 0.6×int + `cleanse` |
| Vital Current | `caster_ally_lowest_hp` heal 90 + 1.2×int + `def_up` |
| Aquatic Blessing | `caster_ally_all` heal 110 + 1.4×int, plus 20 + 0.7×int damage |
| Thick Fog | `blind` on `enemy_all` at 60% for 3 turns + `evasion_up` |
| Whirlpool | 3 × (20 + 0.8×int) `enemy_random` + `weaken` |

`Aquatic Blessing` alone restored 110 + 1.4×int to the entire party while the
largest AoE dealt 25 + 1.2×int — roughly **four points of healing per point of
damage** — and `Thick Fog` blinded every enemy at 60%, so the attacks that did
happen frequently missed. Neither side could kill the other.

**The lesson, now in the recipe:** budget sustain across the whole stage
against that stage's damage output, not skill by skill. Three individually
reasonable heals in one tier stack into an unkillable team, and the default
equip guarantees a mon gets all of them.

| Stage | Before | After |
| ----- | ------ | ----- |
| Rookie | 48/52/0% — 47t | 52/48/0% — 47t |
| Champion | 31/38/**31%** — **339t** | 51/49/**0%** — **38t** |
| Ultimate | 50/50/0% — 13t | 49/51/0% — 23t |
| Mega | 51/49/0% — 67t | 49/51/0% — 18t |

Mega's 67t coming down to 18t was a bonus of the same rebalance.

---

## Water signatures — 58 seeded

Committed in `b039de9`. Two per each of the 29 water Digimon.

Six names needed the collision suffix: `Rain Stream` and `Titanic Charge`
(Lanamon), `Acid Bubbles` and `Tackle` (Tsunomon), `Water Jet` (Otamamon),
`Water Shot` (Syakomon).

Thirteen slots were authored originally rather than shipping tiered filler
(`Overdrive`, `Ocean Wave I`, `Aqua Pressure II`) as a signature: Lunar Foam
Snare, Kappa Deck Splash, Lagoon Tail Sweep, Abyssal Tithe, Reef Venom Barb,
Sanzou River Seal, Whale Song Current, Volcano Bass Drop, Boiling Reef
Breaker, Bubble Claw Trap, Siren Undertow Aria, Petal Foam Drift, Hangover
Undertow.

> [!note] First signatures below Rookie
> This set includes four **In-Training** owners — Koromon, Motimon, Tsunomon
> and Yokomon — costing 5-6 EN to match the stage. Nothing in the pool query
> changes: signatures are excluded from it regardless of stage.

`slot_role` distribution: 17 `identity_finisher`, 14 `primary_attack`, 13
`control`, 8 `sustain_dot`, 4 `utility`, 2 `buff_support`.

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Koromon | `skb-322` | In-Training | Bubbles | Poyoyon Tackle |
| Motimon | `skb-388` | In-Training | Elastic Bubbles | Shinshukusei no Awa |
| Tsunomon | `skb-438` | In-Training | Acid Bubbles (Tsunomon) | Tackle (Tsunomon) |
| Yokomon | `skb-510` | In-Training | Soap Flower | Petal Foam Drift |
| Crabmon | `skb-103` | Rookie | Scissors Execution | Bubble Claw Trap |
| Gomamon | `skb-343` | Rookie | Marching Fishes | Sharp Edge |
| Kamemon | `skb-52` | Rookie | Pointer Arrow | Koura Guard |
| Lanamon | `skb-162` | Rookie | Rain Stream (Lanamon) | Titanic Charge (Lanamon) |
| Lunamon | `skb-2` | Rookie | Tearing Shot | Lop-ear Ripple |
| Otamamon | `skb-582` | Rookie | Lullaby Bubble | Water Jet (Otamamon) |
| Submarimon | `skb-145` | Rookie | Oxygen Homing | Aqua Vulcan |
| Syakomon | `skb-709` | Rookie | Black Pearl Blast | Water Shot (Syakomon) |
| Coelamon | `skb-130` | Champion | Fossil Bite | Destructive Spear |
| Gawappamon | `skb-51` | Champion | DJ Shooter | Kappa Deck Splash |
| Gekomon | `skb-399` | Champion | Symphony Crusher | Noisy Echo |
| Lekismon | `skb-3` | Champion | Moon Night Bomb | Lunar Foam Snare |
| Shellmon | `skb-368` | Champion | Hydro Blaster | Spin Shelter |
| Brachiomon | `skb-724` | Ultimate | Brachio Bubble | Lagoon Tail Sweep |
| Dragomon | `skb-129` | Ultimate | Forbidden Trident | Abyssal Tithe |
| Scorpiomon | `skb-605` | Ultimate | Stinger Surprise | Reef Venom Barb |
| Shaujinmon | `skb-76` | Ultimate | Kouyoujou: Hydro Descent | Sanzou River Seal |
| Sirenmon | `skb-232` | Ultimate | Symphony No. 3 | Siren Undertow Aria |
| Volcanomon | `skb-59` | Ultimate | Volcano Bass Drop | Boiling Reef Breaker |
| Whamon | `skb-21` | Ultimate | Tidal Wave | Whale Song Current |
| Bacchusmon DM | `skb-767` | Mega | Reversal of the Dead | Hangover Undertow |
| Dianamon | `skb-733` | Mega | Goodnight Moon | Arrow of Artemis |
| JumboGamemon | `skb-98` | Mega | Megaton Hydro Laser | Jumbo Crater |
| Leviamon | `skb-37` | Mega | Biting Crush | Tail Strike |
| Neptunemon | `skb-75` | Mega | Vortex Penetration | Wave of Depth |

---

## Signature skills — 72 seeded for plant

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

### The 36 plant Digimon and their signatures

[`seeds/plant-signatures.ts`](backend/src/skills/seeds/plant-signatures.ts)
seeds 72 entries (two per Digimon, `signature: true`, `owner_template_id` set
to the `skb-*` catalog template id). Every ID follows the scheme
`sk-plant-sig-skb{N}-{1|2}`.

| Digimon | template id | stage | sig 1 | sig 2 |
| ------- | ----------- | ----- | ----- | ----- |
| ExTyrannomon | `skb-1` | Ultimate | Stuffed Crush | Zipper Snag |
| Palmon | `skb-348` | Rookie | Root Stretch | Poison Ivy (Palmon) |
| Kuwagamon | `skb-367` | Champion | Scissor Claw | Trap Scissors |
| Sunflowmon | `skb-58` | Champion | Sunshine Beam | Sunshine Gun |
| Togemon | `skb-349` | Champion | Needle Spray (Togemon) | Coconuts Punch |
| Woodmon | `skb-393` | Champion | Branch Drain | Drain Buster |
| Arukenimon | `skb-199` | Ultimate | Spider Thread | Widow Web |
| Cherrymon | `skb-379` | Ultimate | Cherry Bomb | Energy Absorption (Cherrymon) |
| Deramon | `skb-378` | Ultimate | Royal Nuts | Bird Song |
| Dinobeemon | `skb-23` | Ultimate | Hell Masquerade | Savage Dance |
| JewelBeemon | `skb-484` | Ultimate | Spike Buster | Emerald Spear |
| Lilamon | `skb-73` | Ultimate | Lila Shower | Lovely Cologne |
| Lillymon | `skb-359` | Ultimate | Flower Cannon | Fairy Vine |
| MegaKabuterimon | `skb-305` | Ultimate | Horn Buster | Horn Cannon |
| Ceresmon | `skb-176` | Mega | Island Freefall (Ceresmon) | Famis (Ceresmon) |
| GranKuwagamon | `skb-423` | Mega | Dimension Scissor | Kuáng Zhǎn Zhìcái |
| Rosemon | `skb-57` | Mega | Thorn Whip | Forbidden Temptation |
| Monzaemon | `skb-61` | Ultimate | Silence Hug | Love Song |
| Okuwamon | `skb-401` | Ultimate | Double Scissor Claw | Scissor Storm |
| Pumpkinmon | `skb-596` | Ultimate | Trick or Treat | Surprise |
| MarineAngemon | `skb-24` | Mega | Extra Smile | Ocean Love |
| Venusmon | `skb-172` | Mega | Peace Fantasia | LOVE YOU |
| Kudamon | `skb-53` | Rookie | Holy Cartridge | Scroll Wrap |
| Lalamon | `skb-56` | Rookie | Seed Blast | Nuts Gun |
| Stingmon | `skb-91` | Champion | Spiking Strike | Moon Shooter |
| Jupitermon | `skb-168` | Mega | Wide Plasment | Thunder Verdict |
| Aegiochusmon: Green | `skb-188` | Ultimate | Bramble Bite | Plant Zone Cradle |
| Ceresmon Medium | `skb-189` | Mega | Famis (Ceresmon Medium) | Island Freefall (Ceresmon Medium) |
| Dobermon | `skb-222` | Champion | Grau Lärm | Schwarz Strahl |
| Grizzlymon | `skb-235` | Champion | Crescent Dawn | Maul Attack |
| Renamon | `skb-391` | Rookie | Diamond Storm | Tōhakken |
| Wormmon | `skb-392` | Rookie | Sticky Net | Silk Thread Attack |
| Flymon | `skb-586` | Champion | Brown Stingers | Toxic Needle |
| Dokugumon | `skb-592` | Champion | Venom Blast | Poison Sting |
| Mushroomon | `skb-607` | Rookie | Fungus Crusher | Hakai no Kinoko Bakudan |
| Floramon | `skb-611` | Rookie | Rain of Pollen | Poison Ivy (Floramon) |

### Two source-data problems and how they were resolved

**Problem 1 — `skills_catalog.name` is UNIQUE globally, but some attack names
repeat across Digimon.**

The constraint is not accidental. [`resolve.ts`](backend/src/skills/resolve.ts)
builds a `SkillsCatalogResolver` by iterating every `enabled = 1` row and
calling `map.set(normalizeName(row.name), override)`. The key is the
case-insensitive trimmed name. When the resolver maps an XML skill to a catalog
row, it looks up by normalized name:

```typescript
// resolve.ts:39-41, 68-78
function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}
// ...
const key = normalizeName(row.name);
if (map.has(key)) continue;   // first row wins; duplicate is silently skipped
```

If two catalog rows shared the same normalized name, one would silently shadow
the other. Every XML Digimon whose skill matched the shadowed name would resolve
to the wrong catalog entry — broken stats, wrong element, wrong description,
with no error raised.

The constraint was therefore **deliberately kept**: a duplicate `name` is a
seeder error that must fail loud (`ON CONFLICT (name) DO NOTHING` in
`SQL_UPSERT_V2` already makes it a silent skip — having the UNIQUE constraint
as well means an explicit `INSERT` on the admin path fails immediately rather
than quietly skipping). Weakening it would let a future seed author introduce
a collision that corrupts all XML resolution for the affected mon.

Some collisions are legitimate across Digimon (Palmon and Floramon both have
Poison Ivy; Ceresmon and Ceresmon Medium share both Famis and Island Freefall).
The resolution: **suffix the English `name` with the owner in parentheses only
on collision**. The `name_pt` is kept clean because `name_pt` is what the UI
renders. So the catalog has:

- `Poison Ivy (Palmon)` / `Hera Venenosa` — `skb-348`
- `Poison Ivy (Floramon)` / `Hera Venenosa` — `skb-611`
- `Island Freefall (Ceresmon)` / `Queda Livre da Ilha` — `skb-176`
- `Island Freefall (Ceresmon Medium)` / `Queda Livre da Ilha` — `skb-189`
- `Famis (Ceresmon)` / `Famis` — `skb-176`
- `Famis (Ceresmon Medium)` / `Famis` — `skb-189`
- `Energy Absorption (Cherrymon)` / `Absorção de Energia` — `skb-379`
- `Needle Spray (Togemon)` / `Chuva de Agulhas` — `skb-349`

**Problem 2 — Four Digimon had movesets of pure generic filler.**

ExTyrannomon (`skb-1`), Kudamon (`skb-53`), Dobermon (`skb-222`), and
Grizzlymon (`skb-235`) all carried only generic attacks (Overdrive, Rampage,
Heavy Attack) in their wikimon-scraped moveset — nothing species-specific.
Nine additional Digimon had filler in their second slot only. All affected
slots were replaced with original attacks written to fit the species' theme and
lore, rather than shipping "Overdrive" as a named signature.

> [!warning] Signature coverage
> As of commit `a6d0c74`, signatures exist for **plant only** (72 skills
> across 36 Digimon). The other ten elements have no signature seeds. A future
> author seeds an element's signatures by creating a `{element}-signatures.ts`
> file and registering it in `seed-catalog.ts`.

---

## The simulator was under-reporting: silenced units aborted battles

Fixed in `e5d0451`. **Any balance figure recorded before that commit, for an
element that uses `silence`, should be treated as suspect.**

`pickAction` in [`battle-sim.mts`](backend/test/battle-sim.mts) never checked
for `silence` before choosing a skill. The engine rejects a skill used under
silence outright — [`engine.ts:515`](backend/src/battle/engine.ts:515) returns
`{ ok: false, error: 'silenced', code: 'silenced' }` — and the sim's run loop
breaks on *any* rejection:

```ts
const r = applyAction(battle, active.side, action);
if (!r.ok) break;
```

So the battle aborted mid-fight and was tallied as a draw. Balance was never
the problem; the harness was. The two worst rows in the whole matrix turned
out to be the two elements that lean hardest on `silence`:

| Element | `silence` uses | Mega before | Mega after |
| ------- | -------------- | ----------- | ---------- |
| Null    | 11             | 0/0/**100%** — 1t | 51/49/**0%** — 10t |
| Steel   | 3              | 23/27/**51%** — 30t | 53/48/**0%** — 38t |

Null's Mega had been sitting at a 100% draw rate resolving in a *single* turn:
the silence lands on the first action, the next skill attempt is rejected, the
fight aborts. That row had been read as a broken pool for a long time.

The fix mirrors what a real player does — a silenced unit can still throw a
basic attack, so the AI does that instead of attempting a skill it is not
allowed to use. No skill, engine rule, or test expectation was changed.

> [!warning] Related engine sharp edge — NOT fixed
> The rejection at `engine.ts:515` returns *before* `tickActorAilments` and
> `advanceTurnQueue`. A client that keeps retrying skills while silenced
> therefore never advances the turn, and the silence never expires. Real
> players escape by choosing `fight`, so this is not player-facing today —
> but it is why the ailment never decayed in the sim either. Only the test
> harness was fixed in `e5d0451`; the engine path is untouched.

> [!note] Still open — water Champion
> Water Champion remains at roughly 33% draws across ~348 turns. That is a
> genuine stall, unrelated to `silence`, and is not addressed here.

---

## `shift_initiative` had its sign backwards in 19 of 33 uses

Fixed in `4f4188d`. This one was in the **content**, not the engine.

[`engine.ts::shiftInitiative`](backend/src/battle/engine.ts) adds `delta` to
the unit's index in `battle.turnQueue`:

```ts
const target = Math.max(startIdx, Math.min(battle.turnQueue.length - 1, entryIdx + delta));
```

A **lower index acts sooner**. So a negative delta is a boon and a positive
delta is a penalty. The JSDoc says exactly that and always did — engine and
documentation agreed with each other the whole time.

The trap is that the intuitive reading is the opposite: *"negative pushes them
back"*. An audit of all 33 uses across the seed files found **19 with the sign
inverted**, in seven elements:

| Element | Skills | What it actually did |
| ------- | ------ | -------------------- |
| dark    | Fatal Ambush, Unseen Terror, Time Assassination | gave the enemy an earlier turn |
| plant   | Bramble Maze | gave the enemy an earlier turn |
| steel   | 6 skills | gave the enemy an earlier turn |
| water   | Maelstrom | gave the enemy an earlier turn |
| ice     | Arctic Ring | gave the enemy an earlier turn |
| wind    | Swift Flight, Winged Spirit | delayed its OWN caster and party |
| null    | Void Engine, Nothing Reactor | delayed its own side |

Every one did the exact opposite of what its own description promised. An
"ambush that delays the target" was a free tempo gift to the opponent.

**The invariant, now enforced:** enemy-facing targets (`enemy_*`,
`primary_target`) take a **positive** delta; self and ally targets take a
**negative** one.

[`test:initiative-sign`](backend/test/initiative-sign.mts) parses the seed
files and fails on any violation, so the next authoring pass cannot
reintroduce it. It carries an `ALLOWED_EXCEPTIONS` set — empty today — for a
skill that deliberately delays its own caster as a drawback.

Balance impact across all 11 elements after the 19 flips: nothing moved
outside 45/55 and no draw rate changed.

---

## Balance evidence: mirror-match results

Test suite: `pnpm --filter @digiworld/backend test:battle-sim`
(requires `DATABASE=sqlite DATABASE_URL=` env prefix — the repo `.env` points
at Postgres).

### Plant — post-rework final state

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 49  | 50   | 1%   | 41t       |
| Champion  | 48  | 52   | 0%   | 31t       |
| Ultimate  | 50  | 50   | 0%   | 28t       |
| Mega      | 48  | 48   | 5%   | 17t       |

### Plant — pre-rework baseline (original 24-skill grid)

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 48  | 52   | 0%   | 47t       |
| Champion  | 54  | 46   | 0%   | 19t       |
| Ultimate  | 51  | 49   | 0%   | 18t       |
| Mega      | 50  | 50   | 0%   | 33t       |

### Dark — post-rework

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 51  | 49   | 0%   | 40t       |
| Champion  | 51  | 49   | 0%   | 32t       |
| Ultimate  | 52  | 48   | 0%   | 28t       |
| Mega      | 48  | 49   | 3%   | 9t        |

### Dark — pre-rework baseline

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 50  | 50   | 0%   | 47t       |
| Champion  | 48  | 50   | 3%   | 23t       |
| Ultimate  | 49  | 47   | 4%   | 10t       |
| Mega      | 48  | 49   | 3%   | 7t        |

### Light — post-rework

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 51  | 49   | 0%   | 39t       |
| Champion  | 49  | 51   | 0%   | 17t       |
| Ultimate  | 51  | 49   | 0%   | 14t       |
| Mega      | 49  | 51   | 0%   | 16t       |

### Light — pre-rework baseline

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 50  | 50   | 0%   | 47t       |
| Champion  | 49  | 51   | 0%   | 24t       |
| Ultimate  | 50  | 50   | 0%   | 19t       |
| Mega      | 49  | 51   | 0%   | 15t       |

### Electricity — post-rework

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 50  | 50   | 0%   | 45t       |
| Champion  | 52  | 48   | 0%   | 35t       |
| Ultimate  | 49  | 51   | 0%   | 16t       |
| Mega      | 50  | 50   | 0%   | 7t        |

### Electricity — pre-rework baseline

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 51  | 49   | 0%   | 45t       |
| Champion  | 51  | 49   | 0%   | 17t       |
| Ultimate  | 53  | 47   | 0%   | 26t       |
| Mega      | 51  | 49   | 0%   | 5t        |

> [!warning] Electricity Champion turn count
> 35t against a 17t baseline is 2.06×, right at the edge of the 2× stall
> heuristic. Flagged rather than force-tuned: it resolves at 0% draws and sits
> beside plant Champion (31t) and steel Champion (38t). Same disposition as the
> dark Ultimate note above.

### Water — post-rework

| Stage     | Win | Loss | Draw | Avg turns |
| --------- | --- | ---- | ---- | --------- |
| Rookie    | 52  | 48   | 0%   | 47t       |
| Champion  | 51  | 49   | 0%   | 38t       |
| Ultimate  | 49  | 51   | 0%   | 23t       |
| Mega      | 49  | 51   | 0%   | 18t       |

### Water — pre-rework baseline (the stall)

| Stage     | Win | Loss | Draw    | Avg turns |
| --------- | --- | ---- | ------- | --------- |
| Rookie    | 48  | 52   | 0%      | 47t       |
| Champion  | 31  | 38   | **31%** | **339t**  |
| Ultimate  | 50  | 50   | 0%      | 13t       |
| Mega      | 51  | 49   | 0%      | 67t       |

### Reading the numbers

Plant's Rookie turn count dropped substantially (47t to 41t), indicating
faster, more decisive battles. Champion/Ultimate balance is solid at or near
50/50. Mega's 5% draw rate is acceptable given the high-cost finishers.

Dark cleaned up its pre-existing draw rates at Champion and Ultimate completely.
Win/loss is tight across all four stages. Dark Mega's 9t average is genuinely
low compared with other elements — but it was already only 7t before the rework,
so the pool didn't regress; the very short matches are a property of the
Assassin single-target burst pattern. For context: ice Ultimate sits at 81t,
steel Ultimate at 35t, so the spread across elements is wide by design.

> [!warning] Dark Ultimate turn count
> Dark's post-rework Ultimate averages 28t, up from 10t pre-rework. That is a
> 2.8× increase in battle length, above the informal 2× heuristic used as a
> stall guard. The stage was flagged during authoring. It was not force-tuned
> because: (a) it resolves at 0% draws, (b) 28t sits inside the spread already
> shipped by other elements (ice Ultimate is 81t), and (c) further tuning would
> have meant reducing Debuffer's stat-shredding throughput, which is the
> archetype's entire identity. Revisit if playtesting reports that dark Ultimate
> matches feel grindy.

> [!bug] Intermediate plant Mega failure — mass-CC + mass-heal stacking
> During authoring, an intermediate version of the Mega pool hit 92% draw
> rate. The cause: stacking zone-control skills with full-party roots/sleep
> alongside full-party heals created a lock where neither side could deal
> meaningful damage. The fix was to reduce multi-target CC to probabilistic
> chances and single-target heal targets (`caster_ally_lowest_hp` rather than
> `caster_ally_all`). **Run the battle sim before calling a pool done.** A
> 92% draw rate is obvious in the numbers and invisible in a playtesting
> session.

Light came in at 0% draws across all four stages on the first authoring pass,
with turn counts at or below its own baseline. Given that all three of its
archetypes are sustain-flavoured, that outcome is the payoff of designing the
guardrails in up front rather than tuning a stall out afterwards.

The plant, dark and light rows above were all re-measured **after** the
simulator fix in `e5d0451`, so they are directly comparable to each other.

---

## Progress tracker

| Element     | Re-authored | Signatures seeded |
| ----------- | ----------- | ----------------- |
| Plant       | yes (P1)    | yes — 72 skills   |
| Dark        | yes (P2)    | no                |
| Light       | yes (P4)    | no                |
| Electric    | yes (P5)    | yes — 62 skills   |
| Water       | yes (P7)    | yes — 58 skills   |
| Fire        | no          | no                |
| Wind        | no          | no                |
| Earth       | no          | no                |
| Ice         | no          | no                |
| Metal       | no          | no                |
| Null        | no          | no                |

The six pending elements still run the original 24-skill grid: 4 stages × 6
slot roles, one skill per slot role per stage. Their IDs follow the legacy
`sk-{element}-{slot_role_abbrev}-{stage_letter}` scheme — no archetype prefix.

---

## Recipe for the next element

To re-author any of the remaining nine elements:

### 1. Define your three archetypes

Pick three thematic identities from the archetype table above. Give each
archetype a short word prefix you'll use in the `idSuffix` (plant uses `dot`,
`heal`, `zone`; dark uses `assassin`, `debuff`, `drain`; light uses `heal`,
`buff`, `purify`).

> [!important] If all three archetypes are sustain, design the win condition first
> Light was the first element where every archetype — Healer, Buffer,
> Purifier — contributes by keeping allies alive rather than by killing.
> An element shaped that way can stall on heals and shields alone, with no
> crowd control anywhere in the kit, because a mirror match never resolves
> once party restoration per turn exceeds the enemy kit's damage per turn.
>
> Two rules that came out of that run:
> - Budget party-wide restoration against the **enemy kit's damage per turn**,
>   not per skill in isolation. Three individually reasonable heals and a
>   shield stack into an unkillable team.
> - Deliberately assign one archetype the job of closing fights, and give it
>   real offensive scaling. Light's Purifier plays that role.

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
Examples from dark: `sk-dark-assassin-u-1`, `sk-dark-drain-m-2`.

### 4. Hard schema bounds from `dsl.ts`

All values are enforced by Zod at seed time:

- **`energyCost`**: 0–`MAX_ENERGY` (plant Mega skills range 25–40; dark Mega
  skills range 24–35)
- **`cooldown`**: 0–10 turns
- **`apply_status` `chance`**: 0.0–1.0; `turns`: 1–20
- **`modify_stat` `delta`**: -999–999; `turns`: 1–20
- **`shift_initiative` `delta`**: -10–10, non-zero
- **`amount.factor`**: -10.0–10.0 (the stat scaling multiplier)
- **`name`**: 2–48 characters, **UNIQUE constraint across ALL seed files** —
  two skills anywhere in the catalog cannot share a name (see the Poison Ivy
  / Famis / Island Freefall resolution above for the collision pattern).

### 5. Write the migration to wipe the old element pool

Copy `071_wipe_dark_skills.sql` — substitute the element name. The `NULL`ing
of `upgrade_of` references before the delete prevents FK violations because
`upgrade_of` is a self-referencing FK on `skills_catalog.id`.

### 6. Update `MEGA_POOL_SIZE` in the pool smoke test

[`backend/test/pool-smoke.mts`](backend/test/pool-smoke.mts) has a hardcoded
`MEGA_POOL_SIZE` map:

```typescript
const MEGA_POOL_SIZE: Record<string, number> = { plant: 36, dark: 36 };
const DEFAULT_MEGA_POOL_SIZE = 24;
```

Add your element to this map when it moves from 24 to 36, or the pool smoke
test will assert the wrong expected count and fail.

### 7. Run the battle sim and read your element's row before declaring done

```bash
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:pool
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:battle-sim
```

The `DATABASE=sqlite DATABASE_URL=` prefix is mandatory — the repo `.env`
points at Postgres, and without the override both tests connect to the wrong
adapter. The db file must be deleted between runs or the seed will not
re-apply (the migrator's `schema_versions` ledger prevents duplicate
migration runs).

`test:pool` checks pool ordering, carry-forward, and equip slices.
`test:battle-sim` catches balance pathologies — aim for win/loss near 50/50
and draw rate under ~10% at all stages. The failure mode to watch for is mass
CC on `enemy_all` at near-certain chance stacked with party-wide healing:
mirrored sides lock and heal each other into a draw. The 92% plant Mega
intermediate was exactly this pattern.

Two traps this pipeline has already sprung, both cheap to avoid:

1. **Check the factory's second argument before writing the wipe migration.**
   `makeSkillFactory('electricity', 'elec')` produces `sk-elec-*` ids, not
   `sk-electricity-*`. A migration written against the element name deletes
   nothing, and the stale rows then shadow your new pool because the seeder
   upserts `ON CONFLICT (name) DO NOTHING`.
2. **Budget sustain across the whole stage, not per skill.** The default equip
   takes 4/6/8/10 slots by stage, and a stage has 9 skills — so a mon gets most
   of the tier at once. Three individually reasonable heals in one tier stack
   into a team that cannot be killed. Water Champion shipped that way and sat
   at 31% draws over 339 turns until it was rewritten. Compare the tier's total
   healing throughput against its total damage throughput before you run
   anything.
3. **`shift_initiative` deltas are counter-intuitive.** Negative makes a unit
   act SOONER, positive makes it act LATER. Delaying an enemy takes a POSITIVE
   delta. 19 of 33 uses had this backwards before it was caught;
   `test:initiative-sign` now enforces it, so just run that test.

If your element uses `silence`, note that the sim only reads it correctly from
`e5d0451` onward — see [the simulator section](#the-simulator-was-under-reporting-silenced-units-aborted-battles).
Before that commit a silenced unit aborted the battle and inflated the draw
rate to the point of hiding real results.

---

## Related

- [[Skills catalog]] — `skills_catalog` schema, pool queries, slot-role
  ordinal, default equip logic, the XML resolver
- [[Combat]] — the battle engine that consumes resolved skills at runtime
