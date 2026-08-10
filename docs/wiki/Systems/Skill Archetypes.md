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
  - backend/test/pool-smoke.mts
  - shared/src/digimon.ts
verified-at-commit: a6d0c74
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

---

## Progress tracker

| Element     | Re-authored | Signatures seeded |
| ----------- | ----------- | ----------------- |
| Plant       | yes (P1)    | yes — 72 skills   |
| Dark        | yes (P2)    | no                |
| Fire        | no          | no                |
| Water       | no          | no                |
| Wind        | no          | no                |
| Electric    | no          | no                |
| Earth       | no          | no                |
| Ice         | no          | no                |
| Light       | no          | no                |
| Metal       | no          | no                |
| Null        | no          | no                |

The nine pending elements still run the original 24-skill grid: 4 stages × 6
slot roles, one skill per slot role per stage. Their IDs follow the legacy
`sk-{element}-{slot_role_abbrev}-{stage_letter}` scheme — no archetype prefix.

---

## Recipe for the next element

To re-author any of the remaining nine elements:

### 1. Define your three archetypes

Pick three thematic identities from the archetype table above. Give each
archetype a short word prefix you'll use in the `idSuffix` (plant uses `dot`,
`heal`, `zone`; dark uses `assassin`, `debuff`, `drain`).

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

---

## Related

- [[Skills catalog]] — `skills_catalog` schema, pool queries, slot-role
  ordinal, default equip logic, the XML resolver
- [[Combat]] — the battle engine that consumes resolved skills at runtime
