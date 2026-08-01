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
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/dialogue.ts
  - backend/src/dialogues/runtime.ts
  - backend/src/dialogues/routes.ts
  - backend/src/dialogues/session.ts
  - backend/src/dialogues/sync.ts
verified-at-commit: 4e70621
---

# Dialogues

> [!info] TL;DR
> Twee-authored, server-evaluated dialogue trees. Nodes carry text +
> optional condition + entry actions (`give_item`, `set_flag`, etc.) +
> jumps + player choices. Server evaluates conditions, applies actions
> transactionally, and returns the next node view. Actions are
> **ledger-guarded** — each action fires exactly once per user per
> dialogue via `user_dialogue_actions` PK conflict.

## Wire schema — [`shared/src/dialogue.ts`](shared/src/dialogue.ts)

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

Unknown names throw `DialogueRuntimeError` on resolve
([`runtime.ts:39-45`](backend/src/dialogues/runtime.ts:39)).

## The predicate + action registries

### Predicates (read-only, condition evaluation)

Verbatim from [`runtime.ts:61-65`](backend/src/dialogues/runtime.ts:61):

```typescript
const PREDICATES: Readonly<Record<string, Predicate>> = {
  flag_enabled: (ctx, args, ex) => hasFlag(ctx.userId, asString(args[0]!, 'flag_enabled'), ex),
  player_has_item: (ctx, args, ex) =>
    hasItem(ctx.userId, asString(args[0]!, 'player_has_item'), asCount(args[1], 'player_has_item'), ex),
};
```

Two predicates so far — flag lookup and inventory count check. New
predicates plug in by adding to the registry.

### Actions (write, ledger-guarded)

```typescript
const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  set_flag:    async (ctx, args, ex) => { await setFlag(ctx.userId, asString(args[0]!, 'set_flag'), Date.now(), ex); return true; },
  clear_flag:  async (ctx, args, ex) => { await clearFlag(ctx.userId, asString(args[0]!, 'clear_flag'), ex); return true; },
  give_item:   async (ctx, args, ex) => { await grantItem(ctx.userId, asString(args[0]!, 'give_item'), asCount(args[1], 'give_item'), Date.now(), ex); return true; },
  remove_item: (ctx, args, ex) => removeItem(ctx.userId, asString(args[0]!, 'remove_item'), asCount(args[1], 'remove_item'), Date.now(), ex),
  start_quest: async (ctx, args, ex) => { const started = await startQuestWithin(ex, ctx.userId, asString(args[0]!, 'start_quest')); return started !== null; },
};
```

Five actions:
- **`set_flag(name)`** / **`clear_flag(name)`** — user's flag store
  (used for [[Quests#Flag-based unlock chains]] gating)
- **`give_item(itemId, qty=1)`** — inventory increment
- **`remove_item(itemId, qty=1)`** — inventory decrement (returns false
  if insufficient)
- **`start_quest(questId)`** — accepts the quest for the user

An action returning `false` throws `DialogueRuntimeError` inside the
transaction — the whole node's actions ROLL BACK, so partial state is
impossible.

## Registry as an import-time gate

The parser accepts any well-formed action name — `@do give_itme(...)`
would parse cleanly. Without validation, this typo silently does
nothing at play time, letting a writer ship a broken flow that looks
correct.

[`unsupportedNames()`](backend/src/dialogues/runtime.ts:100) walks every
node's actions AND every condition's predicate names, reports unknowns
with the passage id:

```typescript
export function unsupportedNames(definition: DialogueDefinition): readonly DialogueDiagnostic[] {
  const out: DialogueDiagnostic[] = [];
  for (const node of Object.values(definition.nodes)) {
    for (const action of node.entryActions) {
      if (!isKnownAction(action.name)) {
        out.push({ line: 0, passage: node.id, message: `unknown action "${action.name}"` });
      }
    }
    // ... predicates walked the same way
  }
  return out;
}
```

`POST /api/admin/dialogues/import` REJECTS a definition that has any
unsupported name — a silent no-op becomes a targeted error at upload
time.

## Ledger-guarded actions (exactly-once)

Actions are ONE-SHOT per `(user, dialogue, action_id)`. The parser
numbers actions per passage (`start#a0`, `start#a1`, …), so a passage
named `start` would have IDs that collide across dialogues.

Fix ([`runtime.ts:186-188`](backend/src/dialogues/runtime.ts:186)):

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

| Method | Path                                   | Auth  | Purpose                                                         |
| ------ | -------------------------------------- | ----- | --------------------------------------------------------------- |
| POST   | `/api/admin/dialogues/preview`         | admin | Parse + validate without saving — returns stats + errors + warnings |
| POST   | `/api/admin/dialogues/import`          | admin | Save one — rejects if unsupported names                         |
| POST   | `/api/admin/dialogues/sync`            | admin | Bulk-import from disk (Twee files under `backend/data/dialogues/`) |
| GET    | `/api/admin/dialogues/:id/export`      | admin | Download the original `.twee` source                            |
| DELETE | `/api/admin/dialogues/:id`             | admin | Remove                                                          |

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
-> END
```

Meaning:
- `:: name` — passage (= node)
- `[[speaker: npc::expression]]` — who's talking
- `[[@if/@else/@endif]]` — condition tree
- `[[@do action(...)]]` — entry action
- `-> label => target` — player choice

Server-side `parseAndValidate()` gates uploads through
`unsupportedNames()`.

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

## Related

- [[Quests]] — quest steps of type `dialogue` invoke this system with a
  `dialogueId`
- [[HTTP Surface]] — grep for `/api/dialogues`
- [[Cluster Coordination Layer]] — no cluster storage; session +
  ledger live in the DB
- [[Database Adapter]] — the `tx()` wrapping applies actions atomically
