---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Dialogues
  - Dialogue System
  - NPC Dialogues
  - Twee
  - Choose-your-own
  - Dialogue Simulator
  - Cross-reference Validation
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/dialogue.ts
  - backend/src/dialogues/runtime.ts
  - backend/src/dialogues/routes.ts
  - backend/src/dialogues/session.ts
  - backend/src/dialogues/sync.ts
  - backend/src/dialogues/simulate.ts
  - backend/src/dialogues/xref.ts
  - backend/src/db/migrations/047_npcs.sql
  - backend/src/db/migrations/048_onboarding_intro_dialogue_id.sql
verified-at-commit: 5d4aaa6+wt
---

# Dialogues

> [!info] Working-tree state
> `verified-at-commit: 5d4aaa6+wt` — HEAD is at `5d4aaa6`; the sections
> below on [[#Predicates]] + [[#Actions]] extensions, [[#Cross-reference
> validation]] and the [[#Dialogue simulator]] reflect **uncommitted
> work in the working tree**. They land together with the
> [[NPC Registry]] and migration `048_onboarding_intro_dialogue_id.sql`.
> When that lands, bump `verified-at-commit` to the merge commit.

> [!info] TL;DR
> Twee-authored, server-evaluated dialogue trees. Nodes carry text +
> optional condition + entry actions (`give_item`, `set_flag`, `add_ntc`,
> `teleport`, …) + jumps + player choices. Server evaluates conditions,
> applies actions transactionally, and returns the next node view.
> Actions are **ledger-guarded** — each action fires exactly once per
> user per dialogue via `user_dialogue_actions` PK conflict. Import
> gates: **name registry** rejects unknown predicate/action names AND
> **cross-reference checker** rejects references to unknown NPCs, quests
> and items.

## Wire schema — `shared/src/dialogue.ts`

```typescript
export const DIALOGUE_SCHEMA_VERSION = 2 as const;

export type DialogueDefinition = {
  readonly schemaVersion: typeof DIALOGUE_SCHEMA_VERSION;
  readonly dialogueId: string;
  readonly title: string;
  readonly startNodeId: string;
  readonly npcIds: readonly string[];
  /** Security gate: true when any node carries an action or a condition, so
   *  the client must never resolve this dialogue on its own. */
  readonly requiresServerAdvance: boolean;
  readonly nodes: Readonly<Record<string, DialogueNode>>;
};

export type DialogueNode = {
  readonly id: string;
  readonly tags: readonly string[];
  readonly speaker: DialogueSpeaker | null;
  readonly condition: DialogueCondition | null;
  readonly text: readonly DialogueTextPart[];
  readonly entryActions: readonly DialogueAction[];
  readonly jumps: readonly DialogueJump[];
  readonly choices: readonly DialogueChoice[];
};
```

### Conditions

```typescript
export type DialogueCondition =
  | { readonly kind: 'all'; readonly of: readonly DialogueCondition[] }
  | { readonly kind: 'any'; readonly of: readonly DialogueCondition[] }
  | { readonly kind: 'not'; readonly of: DialogueCondition }
  | { readonly kind: 'predicate'; readonly name: string; readonly args: readonly DialogueValueRef[] }
  | { readonly kind: 'compare'; readonly left: DialogueValueRef; readonly op: '=='|'!='|'<'|'<='|'>'|'>='; readonly right: DialogueValueRef };
```

Boolean tree over predicates and comparisons. Recursive `all` / `any` /
`not` build up gates like "player has 3 potions AND flag `quest-b-done`
NOT set".

### Value refs

```typescript
export type DialogueValueRef =
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'fact'; readonly name: string };
```

- **`literal`** — inline value.
- **`variable`** — dialogue-scoped variable, populated at
  `startDialogue` (`ctx.variables[name]`).
- **`fact`** — external world state populated by the server
  (`ctx.facts[name]`).

## Runtime facts populated at session start

[`session.ts::buildContext`](backend/src/dialogues/session.ts:45)
fetches four facts in parallel and pins them for the session lifetime:

```typescript
async function buildContext(userId, displayName, dialogueId) {
  const [rating, balances, leadElement] = await Promise.all([
    partyRating(userId),
    getBalances(userId),
    partyLeadElement(userId),
  ]);
  return {
    userId,
    dialogueId,
    facts: {
      level: rating.meanLevel,
      ntc: balances.netcore,
      credits: balances.credits,
      party_lead_element: leadElement ?? '',
    },
    variables: { player_name: displayName },
  };
}
```

| Fact                 | Type   | Source                                             |
| -------------------- | ------ | -------------------------------------------------- |
| `level`              | number | Party average level (`partyRating`)                |
| `ntc`                | number | Wallet NetCore (`getBalances`)                     |
| `credits`            | number | Wallet Credits (`getBalances`)                     |
| `party_lead_element` | string | Lead mon's element (`partyLeadElement`), `""` if empty |

Variables (writable per session):
- `player_name` — the requesting user's `displayName`.

Facts are frozen at `startDialogue` — a mid-dialogue level-up doesn't
change the gate a subsequent condition evaluates against. Deliberate:
keeps a single dialogue playthrough deterministic.

## Predicates

Verbatim from [`runtime.ts:69-84`](backend/src/dialogues/runtime.ts:69):

```typescript
const PREDICATES: Readonly<Record<string, Predicate>> = {
  flag_enabled: (ctx, args, ex) =>
    hasFlag(ctx.userId, asString(args[0]!, 'flag_enabled'), ex),
  player_has_item: (ctx, args, ex) =>
    hasItem(ctx.userId, asString(args[0]!, 'player_has_item'), asCount(args[1], 'player_has_item'), ex),
  has_ntc: (ctx, args, ex) =>
    hasNetcore(ctx.userId, asAmount(args[0], 'has_ntc'), ex),
  has_credits: (ctx, args, ex) =>
    hasCredits(ctx.userId, asAmount(args[0], 'has_credits'), ex),
  party_has_element: async (ctx, args) => {
    const target = asString(args[0]!, 'party_has_element');
    const elements = await partyElements(ctx.userId);
    return elements.includes(target as (typeof elements)[number]);
  },
};
```

| Predicate                       | Purpose                                              |
| ------------------------------- | ---------------------------------------------------- |
| `flag_enabled(flagName)`        | Player has the flag set (via [[Quests]] / earlier dialogue) |
| `player_has_item(itemId, qty=1)`| Inventory count ≥ qty                                |
| `has_ntc(amount)`               | NetCore balance ≥ amount                             |
| `has_credits(amount)`           | Credits balance ≥ amount                             |
| `party_has_element(element)`    | Party contains at least one mon of that element      |

## Actions

Verbatim from [`runtime.ts:98-142`](backend/src/dialogues/runtime.ts:98):

```typescript
const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  set_flag: async (ctx, args, ex) => { await setFlag(ctx.userId, asString(args[0]!, 'set_flag'), Date.now(), ex); return true; },
  clear_flag: async (ctx, args, ex) => { await clearFlag(ctx.userId, asString(args[0]!, 'clear_flag'), ex); return true; },
  give_item: async (ctx, args, ex) => { await grantItem(ctx.userId, asString(args[0]!, 'give_item'), asCount(args[1], 'give_item'), Date.now(), ex); return true; },
  remove_item: (ctx, args, ex) => removeItem(ctx.userId, asString(args[0]!, 'remove_item'), asCount(args[1], 'remove_item'), Date.now(), ex),
  start_quest: async (ctx, args, ex) => {
    const started = await startQuestWithin(ex, ctx.userId, asString(args[0]!, 'start_quest'));
    return started !== null;
  },
  add_ntc: async (ctx, args, ex) => {
    await addNetcore(ctx.userId, asAmount(args[0], 'add_ntc'), ex);
    return true;
  },
  add_xp: async (ctx, args, ex) => {
    const delta = asAmount(args[0], 'add_xp');
    const result = await execRun(ex, SQL_BUMP_PARTY_XP, [delta, Date.now(), ctx.userId]);
    return result.changes > 0;
  },
  teleport: async (ctx, args, ex) => {
    await teleportPlayer(ctx.userId, asCoordinate(args[0], 'teleport'), asCoordinate(args[1], 'teleport'), ex);
    return true;
  },
  unlock_area: async (ctx, args, ex) => {
    await setFlag(ctx.userId, `${AREA_FLAG_PREFIX}${asString(args[0]!, 'unlock_area')}`, Date.now(), ex);
    return true;
  },
};
```

| Action                                    | Effect                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `set_flag(name)` / `clear_flag(name)`     | User flag store — gates future quests + dialogues                         |
| `give_item(itemId, qty=1)`                | Inventory increment                                                       |
| `remove_item(itemId, qty=1)`              | Inventory decrement (returns `false` → tx rollback if insufficient)       |
| `start_quest(questId)`                    | Accepts the quest for the user                                            |
| `add_ntc(amount)`                         | Grant NetCore                                                             |
| `add_xp(amount)`                          | Bump XP on every party mon (`SQL_BUMP_PARTY_XP` — `status='party'`)       |
| `teleport(x, y)`                          | World-map jump via `teleportPlayer()`                                     |
| `unlock_area(areaKey)`                    | Sets flag `area.unlocked.{areaKey}` — sugar over `set_flag`               |

SQL for `add_xp` ([`runtime.ts:37-41`](backend/src/dialogues/runtime.ts:37)):

```sql
UPDATE player_roster
   SET xp = xp + ?, updated_at = ?
 WHERE user_id = ? AND status = 'party'
```

Note: only party members receive XP. Resting/nursery/adventure mons stay put.

`unlock_area` prefix constant ([`runtime.ts:43`](backend/src/dialogues/runtime.ts:43)):

```typescript
const AREA_FLAG_PREFIX = 'area.unlocked.';
```

So `@do unlock_area("crystal_grove")` writes flag
`area.unlocked.crystal_grove` — gate other content with
`@if flag_enabled("area.unlocked.crystal_grove")`.

## Registry as an import-time gate (name-level)

The parser accepts any well-formed action name — `@do give_itme(...)`
would parse cleanly. Without validation, this typo silently does
nothing at play time, letting a writer ship a broken flow that looks
correct.

[`unsupportedNames()`](backend/src/dialogues/runtime.ts) walks every
node's actions AND every condition's predicate names, reports unknowns
with the passage id. `POST /api/admin/dialogues/import` REJECTS a
definition that has any unsupported name — a silent no-op becomes a
targeted error at upload time.

## Cross-reference validation

Second gate on top of `unsupportedNames`. The parser accepts any
STRING argument, so `@do give_item("meat_pack")` where `meat_pack`
isn't a real shop item silently no-ops at play. The cross-reference
checker turns that into a targeted error at import.

[`buildCrossRefChecker()`](backend/src/dialogues/xref.ts:32) prefetches
every NPC, quest and item id in ONE round-trip. Interface is sync so a
folder sync of N files pays for one prefetch:

```typescript
export type CrossRefChecker = {
  readonly npcExists: (id: string) => boolean;
  readonly npcHasExpression: (id: string, expression: string) => boolean;
  readonly questExists: (id: string) => boolean;
  readonly itemExists: (id: string) => boolean;
};

export async function buildCrossRefChecker(): Promise<CrossRefChecker> {
  const [npcs, quests, items] = await Promise.all([
    listNpcs(),
    q<{ readonly id: string }>(SQL_ALL_QUEST_IDS),
    q<{ readonly id: string }>(SQL_ALL_ITEM_IDS),
  ]);
  // ... build sets + expression map
}
```

### What it checks

Per node ([`xref.ts::unresolvedReferences`](backend/src/dialogues/xref.ts:73)):

- **Speaker** — `speaker.npcId` must exist in the [[NPC Registry]]; if
  it does, `speaker.expression` must be one of that NPC's declared
  expression keys.
- **Actions carrying an id** — the first STRING arg is looked up:
  - `give_item` / `remove_item` → `shop_items.id`
  - `start_quest` → `quests.id`
- **Predicates carrying an id** — same first-arg pattern:
  - `player_has_item` → `shop_items.id`

Everything else (numbers, flags, coord, wallet-amount predicates) isn't
cross-referenced by design — flags are per-user strings, coords are
arbitrary, wallet amounts have no registry. Items and quests have
registries; NPCs now have one too.

### Sample error

```json
{
  "line": 0,
  "passage": "alice_greet",
  "message": "NPC \"alice\" has no expression \"confuzzled\""
}
```

vs the pre-checker behavior: dialogue imports, `alice_greet` runs at
play time, renders "alice" with an empty portrait slot, error goes
unnoticed until QA sees it.

### Wired into every import path

- `POST /api/admin/dialogues/preview` — uses `parseAndValidateWithRefs`
- `POST /api/admin/dialogues/import` — same
- `POST /api/admin/dialogues/sync` — builds ONE checker, passes to
  every file's parse (see
  [`sync.ts:60-85`](backend/src/dialogues/sync.ts:60))

## Ledger-guarded actions (exactly-once)

Actions are ONE-SHOT per `(user, dialogue, action_id)`. The parser
numbers actions per passage (`start#a0`, `start#a1`, …), so a passage
named `start` would have IDs that collide across dialogues.

Fix ([`runtime.ts:236-238`](backend/src/dialogues/runtime.ts:236)):

```typescript
function ledgerKey(dialogueId: string, action: DialogueAction): string {
  return `${dialogueId}:${action.id}`;
}
```

Full qualification with dialogue id keeps one dialogue's ledger entry
from suppressing another's action.

### The claim pattern

```typescript
async function claim(ex, ctx, action, now): Promise<boolean> {
  const info = await execRun(ex, SQL_CLAIM_ACTION, [ctx.userId, ledgerKey(ctx.dialogueId, action), now]);
  return info.changes > 0;
}
```

SQL:

```sql
INSERT INTO user_dialogue_actions (user_id, action_id, applied_at)
     VALUES (?, ?, ?)
ON CONFLICT (user_id, action_id) DO NOTHING
```

If the INSERT succeeds (first time), `changes = 1` → run the action.
If it conflicts (already applied), `changes = 0` → skip.

Concurrent advances: two requests race to claim the same action;
whichever INSERT wins runs it, the other blocks on the PK, sees the
row, skips. **The INSERT is the mutex.** No double-payout.

### Whole-node transaction

```typescript
export async function applyEntryActions(node, ctx): Promise<readonly string[]> {
  if (node.entryActions.length === 0) return [];
  const now = Date.now();
  return tx(async (t) => {
    const applied: string[] = [];
    for (const action of node.entryActions) {
      if (!(await claim(t, ctx, action, now))) continue;
      const args = action.args.map((arg) => resolveValue(arg, ctx));
      if (!(await handler(ctx, args, t))) {
        throw new DialogueRuntimeError(`action "${action.name}" was refused`);
      }
      applied.push(action.id);
    }
    return applied;
  });
}
```

Refused `remove_item` inside a node with a `give_item` beside it rolls
BOTH back — the reward isn't handed out for free just because the cost
side ran out first.

## Dialogue simulator

Admin-only endpoint that walks a dialogue **without persisting anything**.
Purpose: preview the flow, verify branch coverage, sanity-check that a
gated choice actually opens.

Endpoint: `POST /api/admin/dialogues/:id/simulate`

Request body ([`routes.ts:30-45`](backend/src/dialogues/routes.ts:30)):

```typescript
{
  overrides: {
    level?: number;                         // 1..999 (default 1)
    playerName?: string;                    // 1..64 chars (default "Player")
    flags?: string[];                       // max 200 flag names to seed as set
    items?: Record<itemId, qty>;            // per-item inventory seed
  };
  history: Array<{ nodeId, choiceId }>;     // max 500 steps to replay
}
```

Simulator's internal `SimulatorFactOverrides` shape carries more than
the wire schema exposes ([`simulate.ts::SimulatorFactOverrides`](backend/src/dialogues/simulate.ts:11)):

```typescript
type SimulatorFactOverrides = {
  readonly level?: number;
  readonly playerName?: string;
  readonly flags?: readonly string[];
  readonly items?: Readonly<Record<string, number>>;
  readonly ntc?: number;
  readonly credits?: number;
  readonly partyLeadElement?: string;
  readonly partyElements?: readonly string[];
};
```

> [!warning] Wire schema is narrower than the internal shape
> Zod on the endpoint accepts only `level`/`playerName`/`flags`/`items`.
> `ntc` / `credits` / `party_lead_element` / `partyElements` are NOT
> reachable from the wire schema and default to 0 / null. Admins who
> want to preview economic gates (`has_ntc`) or element gates
> (`party_has_element`) need to hand-seed those via the admin UI's
> future override panel. Track in a follow-up.

### Response

```typescript
type SimulatorView = {
  readonly nodeId: string;
  readonly speaker: DialogueSpeaker | null;
  readonly tags: readonly string[];
  readonly text: string;                     // rendered with variables interpolated
  readonly actionsAtEntry: SimulatedActionPreview[];
  readonly choices: SimulatedChoicePreview[];
  readonly done: boolean;                    // reached DIALOGUE_END_NODE
  readonly jumpTrail: readonly string[];     // node ids traversed by @jumps
  readonly flags: readonly string[];         // current simulated set
  readonly items: Readonly<Record<string, number>>;
  readonly ntc: number;
  readonly credits: number;
  readonly partyLeadElement: string | null;
  readonly teleportedTo: { x: number; y: number } | null;
};
```

`SimulatedActionPreview.note` explains WHY a claim would fail (e.g.
`"remove_item: player has 0/2 of 'foo'"`) — the writer sees what's
missing without playtesting through the dialogue.

`SimulatedChoicePreview.conditionSummary` renders the condition as
human prose (`"has_ntc(500) and not flag_enabled(quest.done)"`),
sourced from
[`simulate.ts::renderCondition`](backend/src/dialogues/simulate.ts).

### Failure modes

```typescript
type SimulatorFailure =
  | { kind: 'unknown-dialogue' }             // 404
  | { kind: 'unknown-node'; nodeId: string } // 400
  | { kind: 'invalid-history'; step: number; reason: string }   // 400
  | { kind: 'evaluation-error'; step: number; reason: string }; // 400
```

The `step` field points at the exact history entry that broke — the
admin UI (`admin/src/routes/AdminSimulator.tsx`) can highlight it inline.

## HTTP surface — [`dialogues/routes.ts`](backend/src/dialogues/routes.ts)

### Player

| Method | Path                              | Auth | Purpose                                                     |
| ------ | --------------------------------- | ---- | ----------------------------------------------------------- |
| GET    | `/api/dialogues`                  | user | List available dialogues                                    |
| GET    | `/api/dialogues/:id`              | user | Fetch definition                                            |
| POST   | `/api/dialogues/:id/start`        | user | Enter dialogue — server session begins at `startNodeId`     |
| POST   | `/api/dialogues/:id/advance`      | user | `{ choiceId }` → validate → advance → apply actions → next view |
| POST   | `/api/dialogues/abandon`          | user | Bail out of the current dialogue session                    |

Errors on advance:
- 400 `invalid-body`
- 403 `choice-not-available` — condition failed OR choiceId not on
  current node
- 404 (dialogue or session gone)
- 409 `busy` — the user is already in a different dialogue session

### Admin

| Method | Path                                        | Auth  | Purpose                                                         |
| ------ | ------------------------------------------- | ----- | --------------------------------------------------------------- |
| POST   | `/api/admin/dialogues/preview`              | admin | Parse + cross-ref check without saving — returns stats + errors |
| POST   | `/api/admin/dialogues/import`               | admin | Save one — rejects if unsupported names OR unresolved refs      |
| POST   | `/api/admin/dialogues/sync`                 | admin | Bulk-import from `backend/data/dialogues/` — one checker prefetch |
| GET    | `/api/admin/dialogues/:id/export`           | admin | Download the original `.twee` source                            |
| DELETE | `/api/admin/dialogues/:id`                  | admin | Remove                                                          |
| POST   | `/api/admin/dialogues/:id/simulate`         | admin | Walk the dialogue with `overrides` + `history`, zero side effects |

## Interactive onboarding intro

Migration [`048_onboarding_intro_dialogue_id.sql`](backend/src/db/migrations/048_onboarding_intro_dialogue_id.sql)
adds:

```sql
ALTER TABLE onboarding_config ADD COLUMN intro_dialogue_id TEXT;
```

When set, `/intro` runs the referenced dialogue through the runtime
(same path `DialogueOverlay` uses in dungeons) instead of rendering the
static `intro_dialogue` paragraphs. `NULL` (default) preserves the
pre-P5 paragraph flow — see [[Onboarding and Tutorial]].

Cross-reference validation happens at the ONBOARDING API layer
(`onboarding/engine.ts::updateConfig`) rather than an FK, so a
paragraph-only deploy that never boots the dialogue system still works.

## Twee — the authoring format

Dialogues are written in
[Twee](https://twinery.org/cookbook/terms/terms_twee.html), a
plain-text passage format used by the Twine engine. Parser at
[`shared/src/dialogue-parser.ts`](shared/src/dialogue-parser.ts).

Sketch (verify exact syntax from a real dialogue in
`backend/data/dialogues/`):

```
:: intro
[[speaker: alice::happy]]
Alice greets you warmly.
[[@if flag_enabled("first-meet"):]]
  "Ah, we've met before!"
[[@else:]]
  "Nice to finally meet."
  [[@do set_flag("first-meet")]]
[[@endif]]
-> got_it => reply_ok
-> skip => reply_skip

:: reply_ok
Alice smiles.
[[@do give_item("healing_potion", 1)]]
[[@do add_ntc(50)]]
-> END
```

Meaning:
- `:: name` — passage (= node)
- `[[speaker: npc::expression]]` — who's talking (**cross-ref checked**
  — both npc and expression must exist)
- `[[@if/@else/@endif]]` — condition tree
- `[[@do action(...)]]` — entry action (**cross-ref checked** on the
  first string arg for item/quest actions)
- `-> label => target` — player choice

Server-side `parseAndValidateWithRefs()` gates uploads through
`unsupportedNames()` + `unresolvedReferences()` in one pass.

## Session state

`user_dialogue_sessions` (verify schema):

```
user_id           TEXT
dialogue_id       TEXT
current_node_id   TEXT
started_at        INTEGER
PRIMARY KEY (user_id)   -- one active session per user
```

Single active session per user is enforced by the PK — trying to start
a second returns `busy`. Abandon or complete first.

## Test coverage

Verify via `pnpm --filter @digiworld/backend test:*` on:

- `test/dialogue-runtime-smoke.mts` — pre-existing runtime coverage
- `test/dialogue-runtime-b-smoke.mts` — **new** — coverage for the P5
  actions (`add_ntc`, `add_xp`, `teleport`, `unlock_area`) + predicates
  (`has_ntc`, `has_credits`, `party_has_element`)
- `test/dialogue-session-smoke.mts` — pre-existing session lifecycle
- `test/onboarding-intro-dialogue-smoke.mts` — **new** — verifies the
  onboarding config's `intro_dialogue_id` boots the runtime path
- `test/npc-registry-smoke.mts` — **new** — [[NPC Registry]] CRUD

## Related

- [[Quests]] — quest steps of type `dialogue` invoke this system with a
  `dialogueId`; `bumpTalkObjectives` inside session end fires quest
  progression when the dialogue completes
- [[NPC Registry]] — the speaker + expression source of truth the
  cross-ref checker walks
- [[Currency]] — `add_ntc` grants NetCore, `has_ntc` / `has_credits`
  gate on wallet balances
- [[Onboarding and Tutorial]] — first real runtime driver for the new
  interactive-intro path
- [[HTTP Surface]] — grep for `/api/dialogues` + `/api/npcs`
- [[Cluster Coordination Layer]] — no cluster storage; session +
  ledger live in the DB
- [[Database Adapter]] — the `tx()` wrapping applies actions atomically
