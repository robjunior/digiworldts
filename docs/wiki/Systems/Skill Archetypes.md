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
| wind, after | 716 | 1349 | 1901 | 4531 | 6.33x |

A flat multiplier could not fix this — any nerf that tamed Rookie sank Mega
further. Only a per-stage reshape worked, and it had to be tuned empirically:
the response is steep and non-linear, with a 1.12x scale at Rookie moving the
win rate from 33% to 56%. It took four converging passes.

> [!warning] Verify near the band edge with several seeds, not one run
> Wind was first declared done at 47/55/53/52. A re-check on a fresh database
> put Champion at 56% — over the line. It had been oscillating 54-56% across
> runs, sitting exactly on the 55% boundary, and a single passing run had hidden
> that. The correction was a 3.5% Champion trim, and the first attempt at it
> (a 6% cut) overshot to 42-45% and grazed the floor instead: the response is
> just as steep at this scale as at the earlier one.
>
> Final figures are the range over **three independent 1000-battle seeds**, not
> a best run — Rookie 47-49%, Champion 48-51%, Ultimate 52-54%, Mega 51-52%.
> Anything landing within about two points of 45% or 55% should be re-run before
> it is called done.

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

### Electricity — where the damage-curve frame broke down

Wind's fix suggested a method: compare an element's damage curve to the field
median and reshape it. Applied to electricity, that frame produced three wrong
diagnoses in a row, and the record of the wrong turns is more useful than the
fix.

Electricity summed to the **lowest damage in the game** — 0.61-0.72x the field
median at every stage, with the worst damage-per-energy at 6.2-7.9 against a
field of 9.9-11.5 — while winning 99% of neutral matchups at Ultimate and Mega.

1. **"It wins by stun-lock."** Its stun weight (summed chances) was 2.2 at
   Ultimate against 0.8 for ice, the next highest, including a `chance: 1.0`
   guaranteed stun at Mega. Cutting it to 1.45/1.30 moved the win rate from
   99% to 96%.
2. **"It wins by stacked buffs."** Three of nine Ultimate skills are pure
   party-wide buffs, combining `atk_up`+`crit_up` with enemy `def` shred and
   `damage_reduction`+`def_up`+`shield_absorb`. But light carries far more —
   selfbuff 191 and mitigation 150 at Mega against electricity's 40 and 95.
3. **Ablation settled it.** Neutralising each lever in isolation — buffs,
   mitigation, enemy debuffs, `weaken`, stun — left Ultimate and Mega at
   96-98% every time. None of them was the driver.

The measurement itself was the error. Damage was being summed from the seed
text **without weighting by target breadth**, and electricity is the AoE
element: `Neural Network` alone carries two `deal_damage` entries on
`enemy_all`. Re-weighting (`enemy_all` = party size) closed most of the gap —
but not all of it, and it also showed that weighted damage does not predict win
rate either. Light has the *lowest* weighted Mega damage in the game at 2290 and
wins 86%; plant has 2381 and wins 42%.

> [!important] Damage totals do not rank elements — only the simulator does
> Neither raw nor target-weighted damage sums predict cross-element win rate.
> Use them to form a hypothesis, never to justify a change. Wind's fix worked
> because it was tuned against measured win rates; the curve-shape story told
> around it was narrative, not mechanism.

What settled it was ablating **damage** rather than mechanics, which revealed a
cliff rather than a slope:

| Ultimate/Mega damage scale | Ultimate | Mega |
| -------------------------- | -------- | ---- |
| 1.00x | 99% | 99% |
| 0.50x | 68% | 87% |
| 0.20x | **1%** | **8%** |

An AoE hit is worth far more than its target count suggests, because clearing
the enemy line removes several attackers at once and the advantage compounds.
Electricity is therefore *correct* to carry below-median nominal damage — it had
simply been budgeted as if it were single-target. The fix is damage-only; stun,
buffs and `extra_turn` are untouched, and the `chance: 1.0` stun on `Synapse
Lock` is left in place as balanced-but-worth-watching, since a guaranteed status
with no roll offers no counterplay.

> [!warning] `RUNS=400` is triage, not measurement
> Mid-tuning, `RUNS=400` put electricity's Rookie at 45% and `RUNS=1000` put the
> same build at 55-58%. Below 1000 the noise is wider than the whole target
> band. Screen with 400; never sign off on it.

The response is steeper here than anywhere else in this rework — a 6% damage
change at Rookie swung the win rate 16 points. Final figures over three
independent 1000-battle seeds: Rookie 47-50%, Champion 48-50%, Ultimate 49-50%,
Mega 48-51%.

> [!success] The turn-count tell is 4 for 4
> Wind's mirror ran 17t at Rookie, electricity's 16t/7t at Ultimate/Mega,
> light's 39/17/14/11t, and dark's 9t at Mega — each the fastest in the game at
> the stage where that element turned out to be dominant, against a field of
> 20-47t. In all four cases the anomaly was visible in every run of the suite
> long before anyone acted on it. It remains the cheapest available signal:
> read the turn column before the win column.

### Light — a support kit that does nothing

Light won 74/95/96/91%. Ablation was run first this time rather than after three
wrong guesses, and came back unusually clean:

| ablation | Rookie | Champion | Ultimate | Mega |
| -------- | ------ | -------- | -------- | ---- |
| baseline | 74% | 95% | 96% | 91% |
| damage 0.5x | **0%** | **1%** | **14%** | **5%** |
| heal ~0 | 74% | 94% | 96% | 91% |
| offensive buffs ~0 | 72% | 95% | 96% | 90% |
| mitigation ~0 | 70% | 94% | 96% | 92% |

Light appeared to be pure damage: zeroing its healing outright changed
**nothing**, on the element with the largest support kit in the game. The
conclusion drawn at the time — that the kit was decorative — was wrong. The kit
is never used by the simulator, which is a different problem with a different
owner.

> [!danger] RETRACTED — the healing is not inert. The simulator cannot cast it.
> This section originally concluded that light's support kit was mechanically
> irrelevant, and framed fixing it as a design decision. That was wrong, and the
> error was not testing the claim before writing it down.
>
> `pickAction` in `battle-sim.mts` chooses `damageSkills[0] ?? fallback[0]`,
> where a skill counts as a damage skill only if it contains `deal_damage` or
> `drain`. A pure-support skill is therefore reachable **only when no damage
> skill is affordable at all**. Light's cheapest Mega damage skill costs EN22
> and its support skills cost EN28-34, so the fallback branch can essentially
> never fire for light: any energy level that rules out the damage skill rules
> out the support skills too.
>
> Ablating light's healing changed nothing because the healing was never cast.

See [[#The simulator cannot see support]] for how far this reaches. `execHeal`
itself is correct — it resolves targets, clamps to `hpMax`, applies and emits an
event — and light's Mega heals restore 138-385 HP against a ~1700 HP pool,
which is the same order as its strongest hit. The magnitudes were never the
problem.

Fixing that is a design decision, not a balance pass, so this rebalance
deliberately left it alone. Either the support effects need magnitudes that
register, or light's damage budget has to fall far enough that sustain becomes
its only route to a win. Both change what the element *is*.

Tuning was per-stage, since the response differed sharply by tier — a uniform
0.70x gave 8/37/68/48 and 0.80x gave 26/70/80/71. Final figures over three
independent 1000-battle seeds: Rookie 48-51%, Champion 52%, Ultimate 50-51%,
Mega 50-51%.

Both overshoots on the way there were caught by the band-edge rule rather than
by any failing test — one build sat at 46-47% at Ultimate, another at 45-49% at
Champion, each technically inside 45/55 and each about a point from the floor.
A 5% Ultimate bump then swung the result 8 points.

### Dark — when the standard probe reads "unfixable"

Dark inverted between adjacent tiers, at 71/64/32/99%. Its ablation profile
looked, at first, like a structural defect rather than a balance problem:

| ablation | Rookie | Champion | Ultimate | Mega |
| -------- | ------ | -------- | -------- | ---- |
| baseline | 71% | 64% | 32% | 99% |
| damage 0.5x | **0%** | **0%** | **0%** | **81%** |
| drain ~0 | 71% | 68% | 28% | 98% |
| all buffs ~0 | 74% | 65% | 29% | 98% |
| enemy debuffs ~0 | 68% | 66% | 28% | 98% |
| statuses ~0 | 71% | 70% | 31% | 99% |

Halving damage annihilates three tiers — all to 0% — while Mega drops only 99%
to 81%. No other lever moves Mega at all.

The reading that Mega was "unresponsive to damage" was wrong, and a second,
deeper probe is what showed it: 0.50x gives 81%, **0.25x gives 15%**, 0.10x
gives 0%. The cliff sits *between* 0.5x and 0.25x rather than above it, so the
standard 0.5x probe lands on a plateau and reports no response.

> [!tip] Probe twice before concluding a stage is structurally broken
> A single 0.5x damage cut is enough to locate the lever on most elements, but
> dark's Mega plateau makes it read as immune. When one probe shows little
> movement, take a second at 0.25x before reaching for a bug hypothesis — that
> is the difference between a tunable curve and a defect, and it costs 2s.

Dark's `drain` is worth roughly nothing, exactly as light's healing was. That
is now two of the four reconciled elements whose signature mechanic is
mechanically inert while satisfying its identity floor — see
[[#Light — a support kit that does nothing]]. Worth assuming it is the rule
rather than the exception until an element proves otherwise.

Final figures over three independent 1000-battle seeds, converged in one
iteration past the screen: Rookie 49-51%, Champion 48-50%, Ultimate 48%,
Mega 49-52%.

> [!note] Watch item
> Dark's Mega mirror draw rate is 4%, unchanged by the rebalance and now the
> highest in the matrix since plant's fell to 0%.

### The simulator cannot see support

`pickAction` prefers any damage skill over every support skill, and only falls
through when no damage skill is affordable. Since support skills are generally
the *more* expensive ones, that fallback rarely fires. The effect is that a
measurable share of each element's loadout never gets cast:

| element | Rookie | Champion | Ultimate | Mega |
| ------- | ------ | -------- | -------- | ---- |
| light | 2/4 | 3/6 | 4/8 | **6/10** |
| plant | 1/4 | 2/6 | 3/8 | **6/10** |
| null | 0/4 | 0/6 | 3/8 | 3/10 |
| electricity | 0/4 | 1/6 | 1/8 | 3/10 |
| water | 1/4 | 1/6 | 2/8 | 2/10 |
| earth | 1/4 | 1/6 | 1/8 | 2/10 |
| wind | 0/4 | 0/6 | 1/8 | 2/10 |
| dark | 0/4 | 1/6 | 0/8 | 1/10 |
| ice | 1/4 | 0/6 | 0/8 | 0/10 |
| fire | 0/4 | 0/6 | 0/8 | 0/10 |
| steel | 0/4 | 0/6 | 0/8 | 0/10 |

Fire and steel fight with their whole kit. Light and plant fight with 40% of
theirs at Mega.

> [!success] Fixed in `bb15d94` — the table above is now the historical bias
> `pickAction` picks, in order: cleanse when an ally is afflicted, heal when the
> most injured ally is below `HEAL_BELOW`, buff during the opening rounds, then
> damage. Instrumenting selection confirms the previously dead skills now
> dominate usage — Mending Light at 14394 casts, Warm Radiance at 6858 — and the
> action mix across a full run is 82.3% damage, 10.1% heal, 7.6% buff.

Two things this cost, both worth knowing before touching the AI again.

**`HEAL_BELOW` is load-bearing.** At 0.55 the mutual-healing stall came straight
back: light's Ultimate mirror ran 288 turns at 10% draws, water's Champion 143
turns at 9%. At 0.35 light still ran 133t. It sits at **0.25** — heal only in
real danger, which is both what a player does and what lets the fight end. The
worst case is now 122t with draws at or below 3%.

**It invalidated the previous balance**, immediately putting 37 of 44 cells out
of band, and the re-sweep needed 14 iterations against the original 5. Damage
scaling is a blunter instrument once healing throughput is in the equation.

Fights are legitimately longer now — 21-122t against the old 21-45t — and the
slow elements are exactly the support-heavy ones. That is the intended
consequence of support existing, not a regression.

Rebalancing under the fixed AI also **repaired six of the eleven damage
inversions** on its own, because elements no longer need their damage suppressed
so hard to stay in band. It introduced four others; the tracked list went 11 to
9. See [[#Balance and progression pull apart]].

> [!note] Watch item
> Plant's Champion mirror runs 122t, the longest in the matrix, at 0% draws. Not
> a stall by the old standard — water's was 339t at 31% — but the one to watch.

### The sweep, and why one-at-a-time could not work

Fixing elements individually does not converge. With wind, electricity, light
and dark each brought to ~50%, re-measuring put wind back at 68/72% and
electricity at 56/58/68%. The cause is arithmetic: every win is someone's loss,
so removing two dominant elements lifts everyone who used to lose to them,
including elements already centred.

> [!important] Element balance is a fixed-point problem, not a list of bugs
> Treat it as coordinate descent over all eleven at once. A per-element pass is
> a single step of that descent, and its result is only provisional until the
> whole field is re-measured.

`1ab7e49` replaced the manual passes with a sweep: measure all eleven, scale
each element's damage in proportion to its deviation from 50%, repeat. Damping
is deliberate — 0.3 of the measured 2.7 points-per-percent response, so it
under-corrects rather than oscillates.

| sweep | worst deviation | cells out of band (of 44) |
| ----- | --------------- | ------------------------- |
| 1 | 41 | 31 |
| 2 | 29 | 21 |
| 3 | 10 | 7 |
| 4 | 5 | 0 |
| 5 | 4 | 0 |

It only ever multiplies `deal_damage` base and factor, and
`test:element-identity` runs after every sweep — the safeguard that the
catalog-destroying delegation lacked. All 22 seed files came out byte-identical
in entry count, `tier_2`, `upgrade_of` and per-kind action counts. Turn counts
also converged to a 44/33/31/23-26t band from a spread of 7-50t, which was never
targeted.

### Balance and progression pull apart

The sweep bought parity with progression, and nothing in the repo noticed.
`test:battle-sim` compares elements at a **matched stage** and never compares a
stage to the one below it. An element can therefore be perfectly balanced at all
four tiers while its damage falls as the player evolves.

Electricity's strongest Mega skill hits for **90** where its Rookie skill hits
for **117**. Reaching the final tier drops your damage by a quarter.

> [!danger] This is structural, and damage tuning cannot fix it
> These are the AoE-heavy elements. Clearing an enemy line is worth far more
> than its target count, so an element whose `enemy_all` breadth grows with tier
> must carry ever-lower per-hit damage to stay balanced. Balance and progression
> are in genuine tension, and with only a balance gate in place, progression is
> what silently gives way.

#### Narrowing AoE was the obvious fix. It was measured, and it does not work.

The first version of this note recommended stopping AoE breadth from growing
with tier. That recommendation was written without testing it. Prototyped on
electricity — the worst case, with a Mega peak of 90 against wind's 637 — it
fails:

| attempt | progression | neutral win rate, Ultimate / Mega |
| ------- | ----------- | --------------------------------- |
| committed state | broken (94 -> 90) | 50% / 50% |
| AoE 3 targets -> 2, damage ~3x | **restored** (290 / 380) | **32% / 26%** |
| same, damage +45% / +60% | restored (421 / 608) | 37% / 32% |

Hitting three targets is worth far more than hitting two for triple the damage —
the compounding is superlinear, because clearing the line removes several
attackers at once. Recovering balance at two targets needs a Mega peak around
1200, which is **1.9x the strongest skill in the game**. That trades an
absurdly low headline number for an absurdly high one.

> [!important] Three constraints, any two
> 1. **Balance** — ~50% neutral win rate.
> 2. **Progression** — damage grows as the player evolves.
> 3. **Comparable headline numbers** — no element an order out from the field.
>
> The committed state satisfies 1 and 3. Narrowing AoE satisfies 1 and 2. There
> is no known configuration satisfying all three by tuning damage and target
> breadth alone, so resolving it means changing something else: how AoE is
> valued by the engine, how party size works, or accepting that AoE elements
> read differently on paper.

The defect predates the rework for electricity (115/230/230/330) and for wind,
which the rework happened to fix; the sweep made it worse and spread it to dark,
light, nullelem and plant.

`test:damage-progression` now asserts that total and peak single-hit damage grow
by at least 1.1x per stage, with an explicit `KNOWN_INVERSIONS` list of the 11
outstanding failures. The list may only shrink: the test fails on a new
inversion **and** fails if a listed one is fixed without being removed, so the
debt cannot quietly rot. It was verified in both directions.

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
> `test:element-identity`, and sits inside 45/55 in the mirror matrix. All
> eleven are now also inside 45/55 on **cross-element** power after the sweep in
> `1ab7e49` — see [[#The sweep, and why one-at-a-time could not work]]. What
> remains open is progression, not balance: eleven damage inversions are tracked
> in `test:damage-progression`.

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
