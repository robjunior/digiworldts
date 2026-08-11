---
tags:
  - digiworld/system
  - digiworld/design
aliases:
  - Skill Archetypes and Plant Pool
  - Archetype Design System
  - Skill Rework
created: 2026-08-10
updated: 2026-08-11
grounded-in:
  - backend/src/skills/seeds/
  - backend/src/skills/pool.ts
  - backend/src/skills/dsl.ts
  - backend/src/battle/dsl-runtime.ts
  - backend/src/battle/engine.ts
  - backend/src/db/migrations/069_skills_signature.sql
  - backend/test/pool-smoke.mts
  - backend/test/initiative-sign.mts
  - backend/test/battle-sim.mts
  - shared/src/battle.ts
  - shared/src/digimon.ts
verified-at-commit: db9d97c
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
| Null        | `null`        | Adaptive       | Trickster   | Wildcard + Disruptor |

> [!success] Implementation status — complete
> All eleven elements have been re-authored under this framework, and every
> Digimon in the catalog has two signatures. Migrations 070-080 wipe each
> element's old pool before re-seeding, because `seedSkillsCatalogV2` upserts
> `ON CONFLICT (name) DO NOTHING` and stale rows would otherwise shadow the new
> ones.

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

## The eleven elements and their archetypes

Full tables live in [[Skill Catalog Reference]]. This is the design shape.

| Element | Archetypes | Wipe migration | Notes |
| ------- | ---------- | -------------- | ----- |
| fire | Berserker / Burst / DoT | 078 | Fixed the last draw outlier — 9-10% at Ultimate and Mega |
| water | Controller / Displacer / Sustain | 074 | Fixed the 339-turn Champion stall |
| plant | DoT / Healer / Zone Control | 070 | First element through the pipeline |
| ice | Controller / Lockdown / Debuffer | 075 | Fixed the 81-turn Ultimate grind |
| electricity | Combo / Chain / Stun | 073 | Ids are `sk-elec-*`, not `sk-electricity-*` |
| earth | Tank / Guardian / Terrain Control | 076 | No defect to fix — a pure archetype rework |
| steel | Tank / Counter / Fortress | 077 | Fixed mitigation stacking and eight dead `schedule` uses |
| wind | Skirmisher / Speedster / Evasion | 079 | Ultimate and Mega were 7t and 5t — coin-flip range |
| light | Healer / Buffer / Purifier | 072 | Highest sustain saturation of the eleven |
| dark | Assassin / Debuffer / Drain | 071 | Second element through the pipeline |
| null | Adaptive / Trickster / Wildcard / Disruptor | 080 | The only element with **four** archetypes, and four `tier_2` skills |

### The archetypes became mechanics, not labels

Archetype is design-only — no column, no field, nothing in code reads one. The
test of whether that worked is whether the DSL action distribution reflects the
labels. Counted across the 396 pool skills:

| | `deal_damage` | `heal` | `drain` | `shift_initiative` | `consume_en` | `dispel` |
| --- | --- | --- | --- | --- | --- | --- |
| fire | **42** | 0 | 0 | 4 | 0 | 0 |
| light | **13** | **14** | 0 | 0 | 0 | 5 |
| dark | 21 | 0 | **13** | 3 | 0 | 3 |
| wind | 32 | 0 | 0 | **24** | 0 | 0 |
| null | 39 | 3 | 0 | 12 | **10** | 5 |

Fire carries triple the damage actions of light. Thirteen of the game's sixteen
`drain` uses are dark's. **All ten `consume_en` uses are null's** — no other
element touches resource denial. `shift_initiative` concentrates in wind,
electricity, ice, null and water, the speed and control elements.

Two numbers chased deliberately: `kind: 'schedule'` is at **zero** across all
396 pool skills and all 868 signatures, and `extra_turn` appears just **five
times** in 396 skills.

### Energy curve

| Stage | min | avg | max |
| ----- | --- | --- | --- |
| Rookie | 6 | 8 | 10 |
| Champion | 11 | 13 | 16 |
| Ultimate | 12 | 18 | 24 |
| Mega | 22 | 30 | 40 |

Monotonic across stages. The one imperfection: Ultimate's floor of 12 overlaps
Champion's band.

---

## Four classes of defect, and how each was found

The rework surfaced four distinct kinds of bug. Three of them were **not in the
skills at all**, which is the most transferable thing this project learned —
and each needed a different method to find.

### 1. The harness was lying — `silence` aborted simulated battles

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


### 2. An inverted convention — `shift_initiative` signs

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


### 3. Content that was simply unwinnable

Three elements shipped pools where no side could close the fight. All three were
found the same way: reading a tier's six skills and adding up healing or
mitigation against damage.

| Element | Symptom | Cause |
| ------- | ------- | ----- |
| water Champion | 31% draws, 339t | Three of six skills were heals. `Aquatic Blessing` restored 110 + 1.4×int to the whole party while the largest AoE dealt 25 + 1.2×int — roughly four points of healing per point of damage — and `Thick Fog` blinded every enemy at 60%. |
| ice Ultimate | 81t | Four of six applied `freeze` to `enemy_all`; two granted party-wide `invulnerable`, one for two turns; a third stacked 30% damage reduction. |
| steel Champion–Mega | 34-38t | 460 points of party shield plus 65% stacked damage reduction at Ultimate; two separate party-wide `invulnerable` windows at Mega. |

**The rule that came out of it:** budget sustain and mitigation as a
*whole-tier total* against that tier's damage, never per skill. The default
equip hands a mon most of the tier at once, so three individually reasonable
heals stack into an unkillable team.

### 4. A mechanic that did not exist — `schedule`

[`dsl-runtime.ts`](backend/src/battle/dsl-runtime.ts) carried a
`TODO(P2/Tier2)` and fired a scheduled action **immediately**, ignoring `delay`
entirely. Steel was the only element in the codebase that used it — eight
times — so its whole "timed detonation" identity (`Timed Bomb`, `Temporal
Missile`, `Divine Missiler`) fired on cast while every description promised a
delay.

> [!success] Resolved
> The queue shipped in `9a4e28b`. `Battle` gained an optional
> `pendingActions: ScheduledAction[]`; `schedule` parks its inner action with
> `firesAtRound = round + delay`, and `flushScheduledActions` drains everything
> due from `advanceTurnQueue` right after the round increments — so a delayed
> hit lands at the top of the round it was timed for, before anyone acts. The
> outcome is re-checked immediately after, because a delayed hit can kill.
>
> Entries store unit **ids**, not references: a live match is serialized into
> the cluster's `battle:snap:{matchId}` key between actions, and the next action
> may be served by a different node. An entry whose actor is dead when its round
> arrives is dropped rather than fired, but still consumed so it cannot dangle.
>
> No shipped skill uses `schedule` today, so the action is available to the
> admin without any content depending on it.

### The opposite failure — fights that end too fast

Only visible once the stalls were gone. Fire's Mega resolved in **three turns**
with a 10% draw rate; wind's Ultimate and Mega in 7 and 5; ice's Mega in 6.

Three turns is not a battle, it is an initiative coin flip — whoever moves first
deletes the other side, and when both delete each other simultaneously the match
draws. That is where fire's draw rate came from: mutual annihilation, not a
stall. All three shared one skill shape — five `deal_damage` or `drain` actions
plus `extra_turn` in a single Mega skill.

Ice's Mega was deliberately raised from 6t to 29t. It is the only time this
pipeline asked a tier to get *slower*.

---

## Balance evidence — the final matrix

Test suite: `pnpm --filter @digiworld/backend test:battle-sim` (requires the
`DATABASE=sqlite DATABASE_URL=` env prefix — the repo `.env` points at Postgres).
Mirror matches, 1000 battles per cell.

| Element | Rookie | Champion | Ultimate | Mega |
| ------- | ------ | -------- | -------- | ---- |
| fire | 51/49/0% 40t | 51/49/0% 32t | 49/51/0% 28t | 53/45/2% 26t |
| water | 51/49/0% 47t | 53/47/0% 38t | 50/50/0% 34t | 50/50/0% 20t |
| plant | 47/51/2% 41t | 52/48/0% 31t | 53/47/0% 27t | 47/48/5% 16t |
| ice | 52/48/0% 40t | 49/51/0% 32t | 51/49/0% 27t | 47/53/0% 29t |
| electricity | 49/51/0% 45t | 53/48/0% 35t | 51/49/0% 16t | 49/51/0% 7t |
| earth | 49/51/0% 50t | 51/50/0% 37t | 50/50/0% 37t | 48/52/0% 28t |
| steel | 52/48/0% 45t | 51/50/0% 35t | 50/50/0% 35t | 48/52/0% 26t |
| wind | 50/50/0% 43t | 50/51/0% 31t | 52/48/0% 28t | 50/50/0% 18t |
| light | 46/54/0% 39t | 48/53/0% 17t | 49/51/0% 14t | 46/54/0% 11t |
| dark | 51/49/0% 40t | 50/50/0% 31t | 49/51/0% 28t | 48/50/2% 9t |
| null | 50/50/0% 45t | 52/49/0% 47t | 51/49/0% 25t | 50/50/0% 36t |

Every element sits inside 45/55 with draws at 0-5%, in a 7-50 turn band. Before
the rework the same matrix ranged from a 3-turn coin flip to a 339-turn stall.

The reworked elements also **converged on a common pace** — roughly 25-38 turns
from Champion through Mega — which was never imposed. It fell out of applying
the same sustain, crowd-control and burst budgets to every element.

> [!note] Watch item
> Plant's Mega draw rate sits at the top of the range, moving between 2% and 6%
> across runs on a 1000-battle sample. It is the highest in the matrix and worth
> re-measuring if it drifts further.

### What this matrix does not prove

> [!warning] The matrix above measures mirrors only — it cannot detect a power imbalance
> Every cell pits an element against **itself**. A mirror is 50/50 by
> construction: both sides draw from the same pool, so an element that is twice
> as strong as the rest of the game still reports a clean 50/50. The matrix
> proves *internal* coherence — no stalls, no coin flips, no unwinnable tiers —
> and nothing whatsoever about how elements compare to each other.

For most of this rework that distinction was not made, and "every element sits
inside 45/55" was read as "the game is balanced". It was not. Cross-element
parity was added to `battle-sim.mts` in `3099869`, which reports two extra
columns per stage:

- **vs field** — win rate against all ten other elements, affinity included.
- **neutral only** — restricted to pairs with no affinity relation in either
  direction. This is the number to judge raw power by; `vs field` conflates
  power with how kind the affinity table happens to be to that element.

The first run of it produced this, and none of it was visible in the mirror
matrix:

| Element | Rookie | Champion | Ultimate | Mega |
| ------- | ------ | -------- | -------- | ---- |
| wind | **100%** | **95%** | 58% | **3%** |
| electricity | 32% | 26% | **99%** | **97%** |
| light | 65% | **87%** | **87%** | **86%** |
| dark | 63% | 63% | 28% | **91%** |
| earth | 20% | 30% | **14%** | 22% |
| plant | **6%** | 37% | 24% | 51% |
| null | 33% | 22% | 27% | 24% |

Wind was the extreme and is the only one fixed so far (`5b9d2fb` — see
[[#The wind curve, and the tell that was ignored]]). The rest remain open.

> [!important] Cross-element parity is reporting-only, not a gate
> It prints `<-- OUT OF BAND` and does not fail the suite. Making it a hard gate
> is not currently possible: the elements are interdependent, so every fix moves
> every other number, and ten of the eleven are still out of band. Fixing wind
> made the *rest of the table look worse* — wind had been suppressing everyone
> at Rookie, and with it in range the true spread became visible (water 79%,
> light 74%, dark 73%, plant 6%). Those numbers were always there.

### The wind curve, and the tell that was ignored

Wind's defect was the **shape** of its damage curve, not its magnitude. Its
total output per stage was nearly flat where the field roughly quadruples:

| | Rookie | Champion | Ultimate | Mega | Mega/Rookie |
| - | ------ | -------- | -------- | ---- | ----------- |
| wind, before | 1805 | 2097 | 2001 | 2341 | **1.30x** |
| field median | 781 | 1322 | 1898 | 3040 | 3.89x |
| wind, after | 716 | 1386 | 1901 | 4531 | 6.33x |

A flat multiplier could not fix this — any nerf that tamed Rookie sank Mega
further. Only a per-stage reshape worked, and it had to be tuned empirically:
the response is steep and non-linear, with a 1.12x scale at Rookie moving the
win rate from 33% to 56%. It took four converging passes.

The tell was present in **every run of the suite for the entire rework**: wind's
mirror Rookie resolved in 17 turns while every other element took 39-50. That is
what a pool does when both sides delete each other far too fast. It was
rationalised as "wind is the fast element" rather than investigated. It now sits
at 43t.

> [!tip] The lesson, stated plainly
> A mirror cell cannot tell you an element is too strong — but an outlying
> **turn count** in that cell is the fingerprint of exactly that problem. Treat
> a mirror that resolves far faster or slower than its peers as a power
> anomaly until proven otherwise, not as flavour.

### The near-miss: how the catalog was almost silently destroyed

The first attempt at cross-element balance was delegated as a single
all-elements pass (`bg_9dd65f9c`). It rewrote **all 396 pool skills into one
identical `deal_damage`** — the same 217/320/445/610 curve for every element,
with every heal, drain, buff, conditional and status effect deleted. Eleven
elements collapsed into one.

Every structural check still passed. The row count was right at 1264, every id
and name was intact, `test:seed-v2` reported zero validation errors, `test:pool`
was green, and the mirror matrix was a flawless 50/50 everywhere — *because
identical pools mirror perfectly*. The work was reverted with
`git checkout -- backend/src/skills/seeds/`.

It was caught by one thing only: the mirror turn counts had become **identical**
across all eleven elements (29t/25t/22t/18t), where they had always differed.

`test:element-identity` (`8ebf5e4`) now closes that hole with 97 assertions:

1. Each element uses **≥6 distinct action kinds**, and bare `deal_damage` is
   **≤50%** of its actions.
2. Per-element identity floors — light ≥4 `heal`, dark ≥4 `drain`, null ≥3
   `consume_en`, wind ≥6 `shift_initiative`, and so on.
3. **No two elements share a damage curve.**

It was validated by reproducing the failure rather than by passing: gutting
`light.ts` the way the delegation did fires 5 assertions, and gutting `dark.ts`
to a matching curve additionally trips the distinctness check.

> [!danger] Do not delegate a balance pass across all eleven elements at once
> A brief to "fix the power extremes" is trivially satisfied by making every
> element the same, and every structural test in the repo will agree. Balance
> one element per pass, and run `test:element-identity` as a hard gate.

### Documented pre-rework baselines

| Element | Stage | Before | After |
| ------- | ----- | ------ | ----- |
| water | Champion | 31/38/**31%** — **339t** | 53/47/0% — 38t |
| ice | Ultimate | 51/49/0% — **81t** | 51/49/0% — 27t |
| ice | Mega | 48/52/0% — **6t** | 47/53/0% — 29t |
| fire | Mega | 46/44/**10%** — **3t** | 53/45/2% — 26t |
| steel | Mega | 49/51/0% — 38t | 48/52/0% — 26t |
| null | Mega | 0/0/**100%** — 1t (harness bug) | 50/50/0% — 36t |
| wind | Rookie | 49/51/0% — **17t** | 50/50/0% — 43t |

---

## Carry-forward, and the reserve that restored it

`getDefaultEquippedForStage` fills `EQUIPPED_SLOTS_PER_STAGE` (4/6/8/10) from
the stage-ordered learned pool. Under the old 6-skills-per-stage grid, a cap of
8 at Ultimate could not be filled by the current tier alone, so two Champion
skills came along and a Mega ran 6 Mega + 4 Ultimate. The archetype grid has 9
per stage, which fills Ultimate outright and leaves one spare slot at Mega —
carry-forward vanished from the default loadout as an accident of arithmetic,
without anyone deciding it should.

| Stage | Before the rework | After it | Now |
| ----- | ----------------- | -------- | --- |
| Rookie | 4 Rookie | 4 Rookie | 4 Rookie |
| Champion | 6 Champion | 6 Champion | 5 Champion + 1 Rookie |
| Ultimate | 6 Ultimate + 2 Champion | 8 Ultimate | 6 Ultimate + 2 Champion |
| Mega | 6 Mega + 4 Ultimate | 9 Mega + 1 Ultimate | 8 Mega + 2 Ultimate |

Three options were measured against the real pool. Accepting the loss was
honest but discards continuity between forms. Raising the caps to 4/6/10/13
restores the old mix but hands every mon roughly 30% more actions per fight,
which would reopen the balance work just closed across eleven elements.

**Reserving won**, in `db9d97c`. `CARRY_FORWARD_SLOT_SHARE` holds a quarter of
each stage's slots for skills learned earlier — 0 at Rookie where nothing
earlier exists, 1 at Champion, 2 at Ultimate and Mega. The caps, and therefore
the power budget, are untouched. The learned pool is unchanged either way: all
36 ids at Mega, so a player can equip whatever they like by hand.

This does shift balance, because the simulator draws its loadouts from this
function — a mon now carries two lower-stage skills instead of the strongest two
of its own tier. Measured rather than assumed: water Ultimate moved 23t to 34t,
earth Ultimate 29t to 37t, wind Mega 33t to 38t, light Mega 16t to 11t. Every
element still lands inside acceptance, so none needed retuning.

---

## Progression chains

Each element has 3 archetypes × 3 skills per stage, so a fully chained archetype
links indices 1, 2 and 3 from Rookie through Mega — 9 links per archetype, **27
per element**.

The first three elements through the pipeline (plant, dark, electricity) shipped
with only 9: the index-1 chain in each archetype, indices 2 and 3 unlinked at
every stage. The cause was the brief, not the authoring — early instructions
asked for "at least one chain per archetype", which those three satisfied
literally, while later phrasing produced full chaining. It was invisible until
all eleven could be compared side by side.

Equalised in `75c267a`. All eleven now carry 27 links, every target resolving to
a real id.

`upgrade_of` is metadata: surfaced through `CatalogSkillMeta` for the UI, never
read by the engine or by the pool's ordering, which sorts on stage, `slot_role`
and `tier_2`. Confirmed empirically — the simulator rows for the three touched
elements were unchanged.

---

## Progress — complete

| | Pool | Signatures | Digimon |
| --- | --- | --- | --- |
| fire | 36 | 190 | 95 |
| steel | 36 | 104 | 52 |
| dark | 36 | 94 | 47 |
| null | 36 | 90 | 45 |
| light | 36 | 74 | 37 |
| plant | 36 | 72 | 36 |
| electricity | 36 | 62 | 31 |
| water | 36 | 58 | 29 |
| wind | 36 | 48 | 24 |
| ice | 36 | 40 | 20 |
| earth | 36 | 36 | 18 |
| **Total** | **396** | **868** | **434 / 434** |

All eleven elements are re-authored and every Digimon in the catalog has two
signatures. Tables in [[Skill Catalog Reference]].

> [!info] "Complete" here means authored and internally coherent — not balanced
> This section tracks content authoring only. Every element is written, passes
> `test:element-identity`, and sits inside 45/55 in the mirror matrix. **Ten of
> the eleven are still out of band on cross-element power** — see
> [[#What this matrix does not prove]]. Wind (`5b9d2fb`) is the only one
> reconciled so far.

> [!note] Plant's signature set — diagnosed, then corrected
> Plant looked damage-skewed at 65% `primary_attack`. Measuring the declared
> `slot_role` against each skill's actual actions showed the labels were honest:
> 1 of 72 was arguably off. The real defect was different and worse.
>
> Plant has the RICHEST source data of the eleven — 29% of its Digimon's attacks
> carry an expressible mechanic in their wikimon text, against 9-20% elsewhere —
> and still shipped the second-highest share of bare single-`deal_damage`
> signatures. Nine skills across plant and dark had descriptions promising
> effects the mechanics never applied: "deadly poison mist" with no poison,
> "severely slows the target down" with no `spd` change, "fatal to already
> poisoned targets" with no `conditional`. The same disagreement between prose
> and behaviour as the `schedule` and `shift_initiative` defects.
>
> Restored in `a0c4739` from the wikimon source, chances and durations included.
> Plant's bare-damage share fell from 69% to 58%, and no expressible mechanic
> remains dropped anywhere in the 868 signatures. Four fire signatures show the
> same symptom but are correctly plain: their sources call for reductions to
> elemental resistance and to the user's max HP, neither of which the DSL can
> express.

---

## Maintenance guide

There is no next element — all eleven are done. What follows is the procedure
for adding or re-authoring skills, kept because every step exists to prevent a
specific mistake this project already made.

To re-author any of the remaining nine elements:

### 1. Pick the archetypes

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

### 7. Run the battle sim before declaring anything done

```bash
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:pool
DATABASE=sqlite DATABASE_URL= pnpm --filter @digiworld/backend test:battle-sim
pnpm --filter @digiworld/backend test:element-identity
pnpm --filter @digiworld/backend test:initiative-sign
```

The `DATABASE=sqlite DATABASE_URL=` prefix is mandatory — the repo `.env`
points at Postgres, and without the override both tests connect to the wrong
adapter. The db file must be deleted between runs or the seed will not
re-apply (the migrator's `schema_versions` ledger prevents duplicate
migration runs).

`test:battle-sim` takes 2s at `RUNS=200` and 8s at `RUNS=1000`, so iterating on
numbers is cheap — tune empirically instead of reasoning about formulas, which
is how wind was fixed after four passes.

`test:pool` checks pool ordering, carry-forward, and equip slices.
`test:battle-sim` catches balance pathologies — aim for win/loss near 50/50
and draw rate under ~10% at all stages. The failure mode to watch for is mass
CC on `enemy_all` at near-certain chance stacked with party-wide healing:
mirrored sides lock and heal each other into a draw. The 92% plant Mega
intermediate was exactly this pattern.

Five traps this pipeline has already sprung, all cheap to avoid:

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
   delta.    19 of 33 uses had this backwards before it was caught;
   `test:initiative-sign` now enforces it, so just run that test.
4. **A 50/50 mirror is not evidence of balance.** It is evidence of internal
   coherence only. Read the cross-element `neutral only` column before
   declaring an element done, and treat an outlying mirror turn count as a
   power anomaly — that was wind's only visible symptom for the whole rework.
5. **Never rewrite more than one element's pool per pass.** Every structural
   check in this repo passes on a catalog whose eleven elements have been
   flattened into one identical skill; that nearly shipped. Run
   `test:element-identity` after any bulk edit to a seed file.

If your element uses `silence`, note that the sim only reads it correctly from
`e5d0451` onward — see [the simulator section](#the-simulator-was-under-reporting-silenced-units-aborted-battles).
Before that commit a silenced unit aborted the battle and inflated the draw
rate to the point of hiding real results.

---

## Related

- [[Skill Catalog Reference]] — the generated tables: all 396 pool skills and
  all 868 signatures across 434 Digimon
- [[Skills catalog]] — `skills_catalog` schema, pool queries, slot-role
  ordinal, default equip logic, the XML resolver
- [[Combat]] — the battle engine that consumes resolved skills at runtime
