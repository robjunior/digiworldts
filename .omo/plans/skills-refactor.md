# DigiWorld — Skills Refactor Work Plan

**Branch**: `feat/skills-refactor` (based on `main` @ `83f9c10`)
**Estimated scope**: ~4-5 weeks, 5 sequential PRs
**Owner**: single dev, no parallel work streams
**Status**: v2 — approved by Momus (2m 34s review, verdict `[OKAY]`). Ready for user sign-off + P1 kickoff.

---

## Goal

Refactor DigiWorld's Digimon skill system from inline per-template skills into a shared, DSL-driven catalog. Land 264 new skills (11 elements × 4 stages × 6 skills), expand the engine to support new mechanics (drain, shield, cleanse, dispel, silence, blind, petrify, curse, corruption, root, extra_turn, confusion, charm, evade-as-stat), and rewire 195 existing Digimon templates to reference the catalog by ID.

Success = a player can equip 4/6/8/10 skills (by stage) on any Digimon, cast any skill via the DSL runtime, see the effects render correctly with new status icons and PT-BR/EN descriptions, and existing wikimon flavor skills coexist as legacy inline fallback until the signature-skill follow-up ships.

## Non-goals (explicitly out of scope)

- **195 unique signature skills** — one per Digimon, deferred to a follow-up project. This plan only adds the nullable `signature_skill_id` column.
- **Migration of existing wikimon skills** into the catalog. They stay inline in XML as legacy path; the DSL runtime falls through to the legacy `Skill.power` calculation when a skill has no `actions_json`.
- **Player-facing skill unlock cadence redesign**. New skills unlock at evolution — same trigger as today. No training/quest unlock mechanic.
- **Full i18n framework**. PT-BR is a runtime column switch (`skill.name` vs `skill.name_pt`), not a translation infrastructure.
- **Combat mode UI overhaul beyond skill menu**. Battle log gets new status icons; layout/formation unchanged.
- **Balance tuning as a separate phase**. Balance is continuously validated via `battle-sim.mts` during and after each phase, not a dedicated pass.

---

## Locked design decisions

| # | Decision | Answer |
|---|---|---|
| 1 | Stage mapping (I-IV → engine stages) | **I=Rookie, II=Champion, III=Ultimate, IV=Mega**. Baby/In-Training excluded from combat skill design. |
| 2 | Skill inheritance on evolution | **Carry forward**. Cumulative pool grows: 6 → 12 → 18 → 24 skills learned. |
| 3 | Equipped slots per stage | **4 → 6 → 8 → 10** (grows with stage). Skill menu UI must handle up to 10. |
| 4 | Skill architecture | **Reference by ID from `skills_catalog`**. TemplateDigimon → skill IDs, not inline Skill objects. |
| 5 | Language | **Bilingual**. Add `name_pt` + `description_pt` columns. Client renders based on locale. |
| 6 | Tier 2 mechanics | **Ship at launch** (no placeholders). Adds `extra_turn`, `confusion`, `charm`, `evade`-stat to P2. |
| 7 | Signature skills | **One per Digimon, DEFERRED**. Nullable column added now; skills designed in a follow-up project. |
| 8 | Wikimon skill migration | **Deferred**. Existing inline skills remain as fallback via engine's legacy path. |

---

## Data model changes

### `shared/src/digimon.ts` (breaking type changes)

Expand `AILMENTS` from 6 to 14:

```typescript
export const AILMENTS = [
  // existing (do not remove — 195 wikimon skills reference these)
  'burn', 'poison', 'weaken', 'freeze', 'stun', 'sleep',
  // new (P1)
  'blind', 'silence', 'root', 'petrify', 'curse', 'corruption', 'confusion', 'charm',
] as const;
```

Add stage-to-slots mapping:

```typescript
export const EQUIPPED_SLOTS_PER_STAGE: Record<Stage, number> = {
  Baby: 4,
  'In-Training': 4,
  Rookie: 4,
  Champion: 6,
  Ultimate: 8,
  Mega: 10,
};
// SKILLS_PER_DIGIMON = 4 retained for legacy wikimon-skill inline path
```

Add buff kinds for shield/cleanse/dispel semantics:

```typescript
export const BUFF_KINDS = [
  'shield_absorb',       // damage-absorb pool
  'damage_reduction',    // % reduction taken
  'invulnerable',        // 0-damage until expired
  'accuracy_up', 'accuracy_down', 'evasion_up', 'evasion_down',
  'crit_up',
  'atk_up', 'def_up', 'spd_up', 'int_up',
  'atk_down', 'def_down', 'spd_down', 'int_down',
] as const;
```

### `skills_catalog` table — migration `005_skills_catalog_extensions.sql`

Add columns (both SQLite + Postgres). Dialect-split not required — pure `ADD COLUMN`.

- `name_pt TEXT NOT NULL DEFAULT ''` — PT-BR name (backfilled empty for existing rows; catalog seed sets real values)
- `description_pt TEXT DEFAULT NULL`
- `stage TEXT` — one of `Rookie|Champion|Ultimate|Mega` (nullable for legacy inline-wikimon skills that had no stage concept)
- `slot_role TEXT` — one of `primary_attack|sustain_dot|control|buff_support|utility|identity_finisher` (nullable for legacy)
- `upgrade_of TEXT REFERENCES skills_catalog(id)` — nullable, links Stage N skill to its Stage N-1 predecessor (progression chain)
- `tier_2 INTEGER DEFAULT 0` — flag: 1 means skill uses Tier 2 engine mechanics
- Broaden `element` CHECK to match `ELEMENTS` in shared types (already done at migration 003; no-op here)

### AILMENT enum expansion — NO SQL migration needed

**Correction from earlier draft**: Verified with `grep -in 'ailment\|CHECK' backend/src/db/schema*.sql backend/src/db/migrations/`. There is NO ailment CHECK constraint anywhere in either schema or any migration. Ailments are persisted only as:
- TypeScript `AILMENTS` const in [`shared/src/digimon.ts:16`](shared/src/digimon.ts:16)
- Zod schemas via `z.enum(AILMENTS)` in 5 backend files (dsl, xml, admin/routes, admin/impex, engine)
- In-memory `Battle` object serialized as JSON to `battle:snap:{matchId}` in Redis KV (no schema constraint)

Widening AILMENTS is a **pure TypeScript + Zod change**. Every consumer type-checks automatically the moment the const is widened. `AILMENT_ICON` and `AILMENT_LABEL` maps in [`frontend/src/components/combat3d/Combat3DBody.tsx:461-470`](frontend/src/components/combat3d/Combat3DBody.tsx:461) are declared `Record<Ailment, string>` — TypeScript **hard-fails** if these two are not extended in the same PR as the enum. This is the P1 canary — if typecheck passes, the widening is complete.

### `digimon_templates` — XML attribute for signature skill, NO SQL migration

Digimon templates are XML-only per [`backend/src/digimon/xml.ts`](backend/src/digimon/xml.ts) and [`backend/data/catalog/digimons.xml`](backend/data/catalog/digimons.xml). There is no `digimon_templates` table in either schema. Signature skill support:

- Add optional `signatureSkillId` string attribute to the `<digimon>` XML schema
- Add corresponding field to `TemplateDigimon` TypeScript type in [`shared/src/digimon.ts`](shared/src/digimon.ts)
- Extend XML reader/writer round-trip
- Default null/absent — deferred to signature-skills follow-up project

Zero SQL work. Just XML schema + shared type + reader/writer.

### Player roster `equipped_skill_ids` — column already exists, NO migration needed

**Correction from earlier draft**: `equipped_skill_ids TEXT` column ALREADY exists in both schemas ([schema.sql:108](backend/src/db/schema.sql:108), [schema-pg.sql:105](backend/src/db/schema-pg.sql:105)) with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` idempotency in the pg schema. There's existing infrastructure:

- `SQL_UPDATE_EQUIPPED_SKILLS` at [`backend/src/roster/routes.ts:48`](backend/src/roster/routes.ts:48)
- Parsing/loading at [roster/routes.ts:131, 232, 256, 433](backend/src/roster/routes.ts:131)
- `equippedSkills` field on party members
- API validation at [`roster/routes.ts:311`](backend/src/roster/routes.ts:311): `skillIds: z.array(z.string().min(1)).min(1).max(SKILLS_PER_DIGIMON)`

**What needs updating**: the `.max(SKILLS_PER_DIGIMON)` constraint currently caps at 4. In P1, replace with dynamic per-stage validation:
```typescript
skillIds: z.array(z.string().min(1)).min(1).refine(
  (arr, ctx) => arr.length <= EQUIPPED_SLOTS_PER_STAGE[ctx.digimon.stage],
  { message: 'too many skills for stage' }
)
```
Same-shaped `.max()` replacements in 3 other Zod schemas (see SKILLS_PER_DIGIMON callsite audit in P1 deliverables).

### Battle state — extend `Battle` type in `shared/src/battle.ts`

Add unit fields:

- `activeBuffs: ActiveBuff[]` where `ActiveBuff = { kind: BuffKind, amount: number, remainingTurns: number, sourceId: string }`
- `evade: number` — base evasion stat (default 0; skills/buffs modify)
- Extend existing `Ailmented` to include new AILMENTS

Add battle-level: no new field needed. `turnQueue: TurnEntry[]` + `turnCursor: number` already exist at [`shared/src/battle.ts:119-120`](shared/src/battle.ts:119) with `shiftInitiative()` mutation helper at [`engine.ts:141-157`](backend/src/battle/engine.ts:141). `execExtraTurn` inserts a new `TurnEntry` at `turnCursor + 1`.

---

## Backend implementation

### DSL runtime — new file `backend/src/battle/dsl-runtime.ts`

**Purpose**: execute `actions_json` from `skills_catalog`. Called from `applyAction()` when skill has non-null actions_json; fall through to legacy `skill.power` path otherwise.

**Public API**:
```typescript
export function executeDSL(
  battle: Battle,
  actor: Unit,
  actions: Action[],
  primaryTarget: Unit | null,
): { events: BattleEvent[]; error?: string }
```

**Action executors** — one function per DSL action kind:
- `execDealDamage` — existing damage formula but with `amount` from DSL (flat or scaled from a stat), respects `ignore_defense`
- `execHeal` — restore HP capped at hpMax
- `execApplyStatus` — roll chance, add ailment with turns
- `execModifyStat` — buff/debuff atk/def/spd/int for N turns
- `execConsumeEn` / `execRestoreEn` — clamp to enMax
- `execShiftInitiative` — mutate turnQueue position by delta
- `execSchedule` — enqueue a delayed action; battle tick decrements delay
- `execConditional` — resolve `if` condition on target; execute `then` or `else` branch

**Tier 1 mechanics** (new action kinds):
- `execDrain` — deal damage + heal caster for a fraction (single atomic action, not damage+heal composition, because chain multiplier applies once)
- `execApplyShield` — add `shield_absorb` buff with N absorbed_hp; damage decrements shield first
- `execCleanse` — remove ailments matching predicate (all | specific type | first-in)
- `execDispel` — remove buffs matching predicate
- `execApplyDamageReduction` — buff with % taken reduction
- `execApplyInvulnerable` — 0-damage buff, N turns

**Tier 2 mechanics** (require engine changes beyond DSL):
- `execExtraTurn` — mutation to `turnQueue`; insert actor into next slot after current
- `execConfusion` — apply `confusion` ailment; engine's turn resolver randomly re-targets 50% of actions to random ally
- `execCharm` — apply `charm` ailment; engine's turn resolver forces target of next action to be caster
- `execEvadeBoost` / `execAccuracyDown` — modify `evade` stat / `accuracy` stat on unit; miss-check formula changes

### Engine changes — `backend/src/battle/engine.ts`

**`applyAction()` hybrid path** (around line 545):

```typescript
if (action.type === 'skill') {
  const s = actor.skills.find((sk) => sk.id === action.skillId);
  if (!s) return { ok: false, error: 'unknown skill', code: 'skill-invalid' };
  if (actor.en < s.energyCost) return { ok: false, error: 'not enough energy', code: 'no-energy' };

  // NEW: DSL path
  if (s.actionsJson) {
    const actions = parseActions(s.actionsJson);
    const { events } = executeDSL(battle, actor, actions, target);
    return { ok: true, battle, events };
  }

  // Legacy path (existing) — for wikimon inline skills
  skill = s;
}
```

**Miss check overhaul** (Tier 2 requirement):

Replace `Math.random() < MISS_CHANCE` (flat 8%) with:
```typescript
const accuracyRoll = Math.random() * 100;
const hitChance = clamp(
  BASE_HIT + actor.accuracy - target.evade,
  MIN_HIT_PCT, MAX_HIT_PCT
);
const missed = accuracyRoll > hitChance;
```

Where `BASE_HIT = 92` (matches current 8% miss default), `MIN_HIT_PCT = 20`, `MAX_HIT_PCT = 98`. `actor.accuracy` and `target.evade` default 0.

**`tickActorAilments()` extensions**:

New per-turn effects:
- `curse` — DoT that grows: 3% hpMax turn 1, 5% turn 2, 8% turn 3+ until cleared
- `blind` — no per-turn effect; affects hit-check when this actor attacks
- `silence` — no per-turn effect; skill actions rejected in `applyAction`
- `petrify` — skip turn + +50% def while active
- `root` — no per-turn effect; blocks flee action
- `corruption` — no per-turn effect; caster's next attack fires with random element instead
- `confusion` — no per-turn effect; 50% re-target roll happens in `applyAction`
- `charm` — no per-turn effect; forces target coercion in `applyAction`

**Turn queue mutation** (`extra_turn` support):

The engine already exposes `turnQueue: TurnEntry[]` + `turnCursor: number` on `Battle` ([shared/src/battle.ts:119](shared/src/battle.ts:119)) with `shiftInitiative()` at [engine.ts:141](backend/src/battle/engine.ts:141) as the mutation primitive. `execExtraTurn` inserts a new `TurnEntry` for the actor at index `turnCursor + 1` — one function call, no infrastructure change. `execShiftInitiative` just calls the existing `shiftInitiative()`.

**Confusion / charm target resolution** (`applyAction` header):

Before target lookup, check actor's ailments:
```typescript
if (actor.ailments.some(a => a.kind === 'confusion') && Math.random() < 0.5) {
  target = randomAllyOf(actor); // re-target to ally
}
if (actor.ailments.some(a => a.kind === 'charm')) {
  target = charmSourceOf(actor); // forced by charm caster
}
```

### Skill catalog seed — new file `backend/src/skills/seed-catalog.ts`

Type: `type SkillSeed = SkillInput & { name_pt: string; description_pt: string; stage: Stage; slot_role: SlotRole; upgrade_of?: string; tier_2?: boolean }`

Structure: 11 arrays of 24 skills each (4 stages × 6 slots), one per element. Total 264 entries.

Each element seeded in a separate function for reviewability:
```typescript
async function seedFireSkills(): Promise<void>
async function seedWaterSkills(): Promise<void>
// ... 11 total
```

Called from a top-level `seedSkillsCatalogV2()` that:
1. Runs each element's seed function
2. Upserts by (element, stage, slot_role, name) as composite uniqueness — allows re-seeding without duplicates
3. Logs per-element counts and any DSL validation errors

Idempotent (safe to re-run). Called from server boot after migrations, guarded by an env flag `SKILLS_V2_SEED=1` to prevent accidental production seed.

### Battle sim regression — extend `backend/test/battle-sim.mts`

Add matrix runner:
```typescript
for (const stage of ['Rookie', 'Champion', 'Ultimate', 'Mega']) {
  for (const elA of ELEMENTS) {
    for (const elB of ELEMENTS) {
      const results = runMatchups(elA, elB, stage, N=100);
      recordStats(results); // TTK median, victory rate, skill usage distribution
    }
  }
}
```

Regression bar: victory rate for any (elA, elB) pair within [30%, 70%] after balance passes. TTK median within [3, 15] turns for same-stage matchups. Any panic = hard fail.

---

## Frontend implementation

### Combat skill menu — [`frontend/src/components/combat/SkillMenu.tsx`](frontend/src/components/combat/SkillMenu.tsx) + [`CommandPanel.tsx`](frontend/src/components/combat/CommandPanel.tsx)

- Grid layout that adapts to 4/6/8/10 buttons based on `activeUnit.stage`
- 4 → 2×2 grid
- 6 → 3×2 grid
- 8 → 4×2 grid
- 10 → 5×2 grid
- Overflow: horizontal scroll if any dimension exceeds container

### New status icons — `frontend/src/scene3d/` or `components/combat3d/StatusBar.tsx`

For each of 8 new ailments + BUFF_KINDS, add:
- Unicode/emoji placeholder OR SVG asset (placeholder acceptable at launch, art follows)
- Color coding: red debuff, green buff, blue special
- Tooltip on hover with description

### Skill equip UI — `frontend/src/routes/Roster.tsx` or new `components/roster/SkillEquipModal.tsx`

- Modal opens from roster grid Digimon click
- Lists all learned skills (cumulative pool for stage)
- N checkboxes where N = `EQUIPPED_SLOTS_PER_STAGE[stage]`
- Save writes to `equipped_skill_ids` via `PUT /api/roster/:id/skills`

### Admin editor — `frontend/src/components/admin/`

- Add `name_pt` + `description_pt` fields to skill editor form
- DSL action editor: expand from current basic form to support all new action kinds
  - Drop-down for kind, then dynamic fields per kind
  - JSON editor fallback for advanced authoring
- Progression chain visualization: if `upgrade_of` set, render "← previous stage" link

### i18n runtime — `frontend/src/lib/locale.ts` (new)

Simple conditional:
```typescript
export function displayName(skill: SkillDefinition, locale: 'en' | 'pt-BR'): string {
  return locale === 'pt-BR' && skill.name_pt ? skill.name_pt : skill.name;
}
```

User locale sourced from browser (`navigator.language`) or account preference (add `locale` to user record — separate small PR if scoped in).

---

## Phasing

Each phase = one PR. Sequential merges. All PRs based on `feat/skills-refactor`; final PR opens against `main`.

### P0 — CSS bump (done)
- Commit `0658948` on `feat/skills-refactor`
- Frees the branch to receive skill work

### P1 — Type foundation (2-3 days)

**Deliverables**:

*Shared types* — [`shared/src/digimon.ts`](shared/src/digimon.ts):
- Expand `AILMENTS` from 6 to 14 (add: blind, silence, root, petrify, curse, corruption, confusion, charm)
- Add `EQUIPPED_SLOTS_PER_STAGE` map
- Add `BUFF_KINDS` enum
- Add optional `signatureSkillId?: string` to `TemplateDigimon` type (deferred field, present for forward-compat)

*Shared battle types* — [`shared/src/battle.ts`](shared/src/battle.ts):
- Extend `Unit` with `activeBuffs: ActiveBuff[]` and `evade: number` (both default empty/0 at battle init)
- Add `ActiveBuff = { kind: BuffKind, amount: number, remainingTurns: number, sourceId: string }`
- Update `CONTROL_AILMENTS` set at line 188 to include: `petrify`, `confusion`, `charm`
- Note: `turnQueue: TurnEntry[]` + `turnCursor: number` already exist — no change needed

*Frontend type consumers* — [`frontend/src/components/combat3d/Combat3DBody.tsx:461-470`](frontend/src/components/combat3d/Combat3DBody.tsx:461):
- Extend `AILMENT_ICON: Record<Ailment, string>` with all 8 new entries (placeholder icons OK — unicode/emoji; art in P5)
- Extend `AILMENT_LABEL: Record<Ailment, string>` with all 8 new entries
- These two maps are the P1 canary: TypeScript **hard-fails** if the AILMENTS widening isn't matched here

*SQL migration* — one file only:
- `005_skills_catalog_extensions.sql` — adds `name_pt`, `description_pt`, `stage`, `slot_role`, `upgrade_of`, `tier_2` columns to `skills_catalog`

*Backend refactors* — [`backend/src/battle/engine.ts`](backend/src/battle/engine.ts) + others:
- `tickActorAilments()` — stub cases for 8 new ailments (log-only, no gameplay effect yet; ensures engine boots without runtime error when new-ailment JSON blob is loaded)
- Refactor `SKILLS_PER_DIGIMON` callsites to use `EQUIPPED_SLOTS_PER_STAGE[stage]` where dynamic-per-stage matters. Audit found 12 callsites across 6 files:
  - [`shared/src/digimon.ts:94`](shared/src/digimon.ts:94) — definition (keep as legacy default = 4 for wikimon fallback)
  - [`backend/src/roster/routes.ts:311, 440, 450`](backend/src/roster/routes.ts:311) — equip Zod schema `.max()` → dynamic; fallback default + response field → stage-aware
  - [`backend/src/scraper/cli.ts:105, 123, 387, 390, 461`](backend/src/scraper/cli.ts:105) — scraper skill selection: **KEEP at 4** (scraper still assigns 4 default wikimon skills per template)
  - [`backend/src/admin/routes.ts:158, 251, 266`](backend/src/admin/routes.ts:158) — admin Zod schema + seeding: **KEEP at 4** (admin curates wikimon inline slots)
  - [`backend/src/admin/impex.ts:150`](backend/src/admin/impex.ts:150) — import/export: **KEEP at 4** (wikimon manifest format)
  - [`backend/src/battle/engine.ts:82-83`](backend/src/battle/engine.ts:82) — battle setup slicing → stage-aware for equipped catalog skills

*XML schema* — [`backend/src/digimon/xml.ts`](backend/src/digimon/xml.ts):
- Add optional `signatureSkillId` attribute to `<digimon>` element
- Extend Zod parser + XML serializer round-trip

**Gates** (all must be green before P1 PR merges):
- `pnpm typecheck` clean across backend + frontend + shared
- `pnpm --filter @digiworld/backend test:migrator` passes with migration 005
- `pnpm --filter @digiworld/backend test:pg-portability` — existing `SQL_*` constants still PREPARE cleanly against schema with new columns; no new SQL constants yet
- `pnpm --filter @digiworld/backend test:features` still passes (no functional change; only type expansion)
- `battle-combo.mts` maintains 44/47 pass baseline. **Invocation** (no pnpm script exists): `pnpm --filter @digiworld/backend exec tsx test/battle-combo.mts`. Confirmed baseline via one-off run: `passed: 44, failed: 3` (unchanged behavior).
- Zod audit: every existing `z.enum(AILMENTS)` consumer accepts the widened enum without runtime rejection
- Visual sanity: `AILMENT_ICON` map renders placeholder for every new ailment (grep for each new entry in `Combat3DBody.tsx`)

**Merge**: PR titled `feat(skills-p1): type foundation for skills-v2`

### P2 — DSL runtime + Tier 1 + Tier 2 mechanics (10-14 days)

**Deliverables**:
- `backend/src/battle/dsl-runtime.ts` — full interpreter for all DSL action kinds
- `applyAction()` hybrid path in `engine.ts`
- Tier 1 mechanics (10 new action kinds): drain, apply_shield, cleanse, dispel, apply_damage_reduction, apply_invulnerable, apply_evade, apply_accuracy, silence (via apply_status), blind (via apply_status)
- Tier 2 mechanics: extra_turn (queue mutation), confusion (target coercion), charm (target coercion), evade-as-stat (miss check overhaul)
- 15-20 test skills seeded via a new `pnpm --filter @digiworld/backend test:dsl-smoke` script covering every action kind
- Extended `battle-sim.mts` matrix runner

**Gates**:
- Every DSL action kind has a dedicated unit test in `test/dsl-runtime.mts` (new file)
- `battle-combo.mts` 44/47 baseline preserved (fix any regressions caused by miss-check overhaul; the 3 pre-existing failures may need updating for evade formula). Invoke via `pnpm --filter @digiworld/backend exec tsx test/battle-combo.mts`.
- `battle-sim.mts` runs 500 matches without panic
- Turn-queue mutation preserves ailment tick order (test: apply burn, use extra_turn, verify burn still ticks on schedule)
- Confusion re-target correctness (test: cast damage skill on enemy with confusion active, verify 50% roll re-targets to random ally)
- Charm force-target correctness (test: cast damage skill while charmed, verify target is charm source)
- Shield absorb correctness (test: 100-damage attack vs 50-shield target, verify HP damage = 50, shield destroyed)
- Cleanse specificity (test: burn+silence on target, cleanse `type: 'debuff-all'` removes both; cleanse `type: 'burn'` removes only burn)

**Merge**: PR titled `feat(skills-p2): DSL runtime + Tier 1/2 engine mechanics`

### P3 — Skill catalog seed (5-7 days)

**Deliverables**:
- `backend/src/skills/seed-catalog.ts` — 264 skills across 11 elements × 4 stages × 6 slots
- Bilingual names (`name` = EN, `name_pt` = PT-BR) and descriptions
- Progression chains via `upgrade_of` where naming implies it (mandatory for slots 1 + 6; optional for slots 2-5)
- Deduplication audit script — checks no two skills share (mechanical effect + target pattern) across elements
- Admin editor gets bilingual fields
- User review gate: **each element's 24 skills posted for user review before moving to next element**

**Gates**:
- All 264 skills load without DSL validation errors (`SkillInputSchema.safeParse` passes on every entry)
- Seed idempotency: running twice produces zero new rows
- Balance sim: `battle-sim.mts` matrix runner produces victory rates within [30%, 70%] for same-stage matchups after any energy-cost tuning
- User signs off per-element (11 signoffs total, 1 per element)
- Naming register audit: no LLM slop patterns (checked list: no repeated opening verbs like "unleashes a torrent of", no English loanwords beyond agreed list, Stage IV names use apocalyptic/mythological register)

**Merge**: PR titled `feat(skills-p3): 264-skill catalog seed + bilingual admin fields`

### P4 — Digimon roster wire-up (2-3 days)

**Deliverables**:
- New helper [`backend/src/skills/pool.ts`](backend/src/skills/pool.ts) exporting `getLearnedPoolIds(element: Element, stage: Stage): Promise<string[]>` — returns all catalog skill IDs where `element = ? AND stage_ordinal <= currentStage_ordinal`. This is the "carry forward" mechanic — a Champion Fire Digimon's pool is Rookie + Champion Fire skills; a Mega's is all four stages.
- Same helper used by:
  - Battle setup ([`backend/src/battle/engine.ts:82-83`](backend/src/battle/engine.ts:82)) — resolves each unit's usable skills at battle start
  - Roster equip endpoint — validates `equipped_skill_ids` is a subset of the learned pool
  - Frontend skill equip UI — displays available pool for equip picker
- Backfill script for existing rosters: for each `player_roster` row with `equipped_skill_ids IS NULL`, populate with first `EQUIPPED_SLOTS_PER_STAGE[stage]` IDs from `getLearnedPoolIds()`
- Legacy wikimon skills preserved in [`backend/data/catalog/digimons.xml`](backend/data/catalog/digimons.xml) — untouched. Battle engine falls through to legacy `Skill.power` path when a skill has no `actions_json`
- **No per-template migration** (pool is derived, not stored). No `pool_skill_ids` column, no XML change to Digimon templates beyond the `signatureSkillId` added in P1.

**Gates**:
- Unit test: `getLearnedPoolIds('fire', 'Mega')` returns exactly 24 IDs (6 × 4 stages) when catalog is fully seeded
- Unit test: `getLearnedPoolIds('fire', 'Rookie')` returns exactly 6 IDs (Rookie stage only)
- All 195 templates: for each template, `getLearnedPoolIds(template.element, template.stage)` returns non-empty array (no orphan Digimon)
- Battle-sim random matchup: picks 2 templates, resolves each unit's pool, runs 100 battles, no panics
- Roster backfill runs on a DB snapshot: prints `rosters updated: N, rosters skipped (equipped_skill_ids already set): M`, no errors
- Existing players can log in, view roster, see their Digimon with populated `equipped_skill_ids`
- Wikimon skill invocation still works (test: pick an Agumon with Pepper Breath from its wikimon inline pool, cast it, verify legacy damage path fires and produces same damage as before this PR)

**Merge**: PR titled `feat(skills-p4): learned-pool helper + roster backfill`

### P5 — Frontend (5-6 days, can parallel P4)

**Deliverables**:
- Combat skill menu grid handles 4/6/8/10 slots dynamically
- Status icons for all 8 new ailments + all buff kinds (placeholder OK for launch)
- Skill equip modal in Roster
- Admin editor: DSL action editor for new kinds + bilingual fields
- i18n locale runtime switch
- Battle log renders new statuses correctly (icon + name)

**Gates**:
- Visual QA: skill menu rendered at every stage (4, 6, 8, 10 slots) — no overflow, no clipped labels
- Skill equip flow: user opens modal → picks N skills → saves → reload roster shows saved selection
- Admin editor: authoring a Tier 2 skill (extra_turn) via UI produces valid `actions_json` that DSL runtime executes
- Locale switch: user changes locale in account settings, skill names re-render without page reload
- Combat log shows every new status with correct icon + name in both locales
- `pnpm typecheck` + `pnpm build` clean

**Merge**: PR titled `feat(skills-p5): combat skill menu + status icons + skill equip UI + i18n`

**Total elapsed**: 23-31 working days (~3.5-4.5 calendar weeks with review cycles). P1 shrunk from 3-4 → 2-3 days (3 of 4 originally-planned migrations turned out unnecessary). P4 shrunk from 4-5 → 2-3 days (pool is derived from `(element, stage)` query, not stored per-template).

---

## Test plan

### Unit tests
- `test/dsl-runtime.mts` (new) — one describe block per action kind, verifies isolated behavior
- `test/skills-catalog.mts` (new) — CRUD + DSL validation roundtrip
- `test/migrator-smoke.mts` (existing) — extended with 005-008
- `test/postgres-portability.mts` (existing) — extended with new SQL constants

### Integration tests
- `test/features-smoke.mts` (existing) — extended with skill equip API + DSL execution end-to-end

### Regression
- `test/battle-combo.mts` — maintains 44/47 pass rate as baseline. Invoke: `pnpm --filter @digiworld/backend exec tsx test/battle-combo.mts` (no pnpm script exists; direct tsx invocation)

### Simulation
- `test/battle-sim.mts` — matrix runner with 100 matchups per (element_pair × stage_pair), records victory rate + TTK + skill usage distribution; fails if any pair falls outside [30%, 70%] winrate after balance passes

### Manual QA
- Per-element user review gate in P3 (11 gates)
- Roster migration walk-through in P4
- Full combat visual QA in P5

---

## Migration strategy

- All schema changes via numbered migrations in `backend/src/db/migrations/`
- Dialect-split where semantics differ: `.sqlite.sql` uses table rebuild for CHECK changes; `.pg.sql` uses `ALTER TABLE DROP/ADD CONSTRAINT`
- Data migrations (P4 template rewire, roster equipped_skill_ids backfill) run as one-shot scripts in `backend/src/db/data-migrations/*.mts`, idempotent
- **Only one SQL migration in this refactor**: `005_skills_catalog_extensions.sql` (skills_catalog column additions), landing in P1. Signature-skill support (originally proposed as 007) becomes an XML schema change, not a SQL migration. Migrations originally numbered 006 (ailment CHECK) and 008 (roster equipped_skill_ids) turned out to be unnecessary: no ailment CHECK exists anywhere and the `equipped_skill_ids` column already exists in both schemas.
- Rollback: legacy wikimon inline skill path preserved throughout P2-P5; feature can be reverted by setting `SKILLS_V2_ENABLED=0` env flag (P2 introduces flag)

---

## Rollout

- `SKILLS_V2_ENABLED` env flag defaults `false` in P1-P4, flips `true` in P5 when frontend ships
- Behind flag:
  - `false` — engine uses legacy path always; skill equip UI hidden; skills_catalog seed present but not surfaced
  - `true` — DSL path active for skills with `actions_json`; equip UI visible; catalog skills selectable
- Post-P5 merge: enable in staging, run 1000 battle-sim matchups + 24h soak test, monitor error logs
- Prod flip: canary players (subset by user ID) for 48h, monitor victory-rate distribution and error rate, then full rollout

---

## Deferred (explicitly out of this refactor)

- **Signature skills** — 195 one-per-Digimon unique skills. Design + seed as a follow-up project. This plan only adds the nullable `signature_skill_id` column.
- **Wikimon skill migration to catalog** — existing inline skills stay in XML. Legacy engine path handles them. Migration to catalog is a separate ticket if desired.
- **Skill unlock cadence redesign** — new skills unlock automatically at evolution, same as today. No training/quest gating.
- **Damage variance on element pair balance** — the STAGE_MULTIPLIER + `scaleForLevel` interaction stays. New skills tune via `energy_cost` and DSL `amount`.
- **Frontend art assets for status icons** — unicode/emoji placeholders acceptable at launch. Art pipeline is a follow-up.
- **Combat animations for new action kinds** — the existing 11 attack runners are element-based. New action kinds (drain, shield, cleanse) reuse the caster's element runner. Bespoke per-action animations are a follow-up.

---

## Risks + mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DSL runtime timebox slips | High | High | P2 hard-capped at 14 days. If not done, shrink Tier 2 to `extra_turn` only (defer confusion/charm/evade) and reopen decision. |
| 264 AI-generated skills have severe imbalance | High | Medium | `battle-sim.mts` matrix runner is a gate in P3. Iterate on `energy_cost` until winrates within [30%, 70%]. |
| Ailment enum expansion breaks frontend combat log silently | Medium | Medium | P1 gate includes frontend status-icon audit (visual check every ailment renders). |
| PR review latency on 5 sequential PRs | Medium | Medium | User is sole reviewer; each PR designed to be reviewable in <1 hr. Per-element gates in P3 replace bulk review with 11 small checks. |
| 195 template migration corrupts roster data | Low | High | Migration script tested against DB snapshot before production. Rollback via feature flag. |
| Wikimon legacy path breaks after DSL wiring | Medium | High | P2 gate includes explicit "cast Pepper Breath, verify legacy damage" test. Never touch the `power` field or existing calc. |
| Tier 2 confusion/charm re-targeting introduces subtle bugs | High | Medium | Dedicated unit tests in `dsl-runtime.mts`. Property test: after 1000 confusion casts, distribution of targets is uniform over allies. |
| Bilingual data drift (name says "Fire", name_pt says "Água") | Low | Low | P3 audit script checks each seed entry's translation plausibility (both fields non-empty, no null in PT). |
| Frontend skill menu with 10 buttons overflows on mobile | Medium | Low | Design assumes desktop-first per Roadmap S4. Mobile is stretch. |

---

## Open questions (to resolve during implementation, not blockers)

1. When does a Digimon "learn" the higher-stage skills — at the moment of evolution, or one per level after evolution?
   - **Default**: instant on evolution. Player gets full new pool immediately.

2. Should energy costs escalate across stages (Stage IV skills more expensive) or match player's expanding en pool?
   - **Default**: costs scale with stage but slower than power (Stage IV has 2× cost of Stage I but 3-4× effect).

3. Should the DSL runtime respect skill `cooldown` field (currently unused)?
   - **Default**: yes. P2 wires cooldown tracking as part of engine changes.

4. `upgrade_of` FK chains — do we enforce that all 4 stages of a chain exist, or allow partial chains (e.g., only slot 1 chains, other slots stage-only)?
   - **Default**: chains required for slot 1 (primary attack) + slot 6 (identity finisher); optional for 2-5.

5. What renders as "primary" between EN and PT-BR in the admin editor?
   - **Default**: EN name is DB key + admin display key; PT-BR shown as secondary field.

---

## Sign-off flow

1. **This plan** → Momus review → user approves changes → merge plan to branch as `.omo/plans/skills-refactor.md`
2. **P1 merged** → user reviews types/migrations, confirms no cascading breakage
3. **P2 merged** → user reviews DSL runtime + engine changes, plays a test battle
4. **P3 merged** → user has already signed off per-element during seed
5. **P4 merged** → user verifies existing rosters still work
6. **P5 merged** → user does full combat QA + locale switch test
7. **Feature flag flip** → user approves prod enablement after staging soak

Nothing merges without user approval on the PR.
