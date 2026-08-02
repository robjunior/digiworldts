---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - NPC Registry
  - NPCs
  - NPC Speakers
  - NPC Expressions
  - NPC Portraits
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/npc.ts
  - backend/src/npcs/repo.ts
  - backend/src/npcs/routes.ts
  - backend/src/npcs/seed.ts
  - backend/src/db/migrations/047_npcs.sql
verified-at-commit: 5d4aaa6+wt
---

# NPC Registry

> [!info] Working-tree state
> `verified-at-commit: 5d4aaa6+wt` — this system lives entirely in the
> working tree (backend `npcs/` subsystem, `shared/src/npc.ts`,
> migration `047_npcs.sql`, admin `NpcsAdmin.tsx`, portrait assets
> under `backend/public/assets/npc/`). Bump when it merges.

> [!info] TL;DR
> Speaker registry cross-referenced at [[Dialogues|dialogue]]-import
> time. Before this, `@speaker elder confuzzled` failed silently at play
> (dialogue rendered "elder" with an empty portrait slot). The registry
> gives us: (1) a concrete NPC id set the importer verifies, (2) a
> per-NPC expression key set so typos are refused at import, (3) a
> display name the UI shows instead of the raw id.

## Data model — `shared/src/npc.ts`

Verbatim ([`shared/src/npc.ts:20-35`](shared/src/npc.ts:20)):

```typescript
export type NpcExpression = {
  readonly key: string;
  readonly label?: string;
  readonly hasPortrait: boolean;
};

export type Npc = {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly NpcExpression[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export const NPC_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const NPC_EXPRESSION_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const NPC_DEFAULT_EXPRESSION = 'neutral' as const;
```

Constraints:

- **`id`** — 1-64 chars, `[a-z][a-z0-9_-]*` (lowercase kebab/snake starting
  with a letter). Enforced by `NPC_ID_PATTERN`.
- **`expression.key`** — 1-32 chars, same pattern via
  `NPC_EXPRESSION_PATTERN`.
- **`displayName`** — 1-120 chars (see repo validator).
- **`expression.label`** — optional, 1-64 chars when set.
- **`hasPortrait`** — computed at fetch time from the filesystem (see
  [[#Portrait storage]]).

## Persistence — [migration `047_npcs.sql`](backend/src/db/migrations/047_npcs.sql)

```sql
CREATE TABLE IF NOT EXISTS npcs (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  expressions   TEXT NOT NULL DEFAULT '[]',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
```

Design notes from the migration header:

- **`expressions` is a JSON blob** — small enough that a blob wins over
  a side table on both dialects.
- **`hasPortrait` is NOT persisted** — the filesystem is the source of
  truth for portrait existence at
  `backend/public/assets/npc/{id}/{expression}.png`. `hydrate()` calls
  `existsSync()` per expression at fetch time.
- **Portable** — TEXT-only columns, JSON stored as TEXT to match
  `dialogue_definitions.npc_ids` / `ir_json`.

## Portrait storage

Filesystem-backed under `config.paths.npcPortraitsDir` (typically
`backend/public/assets/npc/`). Layout:

```
backend/public/assets/npc/
├── elder/
│   ├── neutral.png
│   └── concerned.png
├── nursery/
│   ├── neutral.png
│   └── happy.png
└── tamer_guild/
    ├── neutral.png
    ├── concerned.png
    └── happy.png
```

Served as static files at `/assets/npc/{id}/{expression}.png` by the
Fastify static plugin (verify wire-up in
[`backend/src/server.ts`](backend/src/server.ts)).

### `hasPortrait` computed at fetch

```typescript
function hydrate(row: NpcRow): Npc {
  const stored = parseExpressions(row.expressions);
  const expressions: NpcExpression[] = stored.map((expr) => ({
    key: expr.key,
    ...(expr.label !== undefined ? { label: expr.label } : {}),
    hasPortrait: existsSync(portraitPath(row.id, expr.key)),
  }));
  return { id: row.id, displayName: row.display_name, expressions, ... };
}
```

Consequence: uploading or deleting a portrait file doesn't require a DB
update. The next `GET /api/npcs` reflects the new state.

## Validation ([`repo.ts::validateInput`](backend/src/npcs/repo.ts:103))

Runs on every `saveNpc()` call (POST and PUT). Rejects with
`NpcValidationError` carrying the full issue list:

- `id` matches `NPC_ID_PATTERN`.
- `displayName` non-empty after trim, ≤ 120 chars.
- **At least one expression required** — typically `neutral`.
- Each `expression.key` matches `NPC_EXPRESSION_PATTERN`.
- No duplicate expression keys within an NPC.
- Each `expression.label`, when set, is 1-64 chars.

## HTTP surface — [`npcs/routes.ts`](backend/src/npcs/routes.ts)

### Player

| Method | Path                  | Auth | Purpose                                            |
| ------ | --------------------- | ---- | -------------------------------------------------- |
| GET    | `/api/npcs`           | user | List every NPC (with `hasPortrait` per expression) |
| GET    | `/api/npcs/:id`       | user | Fetch one; 404 `npc-not-found`                     |

### Admin CRUD

| Method | Path                     | Auth  | Purpose                                          |
| ------ | ------------------------ | ----- | ------------------------------------------------ |
| POST   | `/api/admin/npcs`        | admin | Create; 409 `npc-exists` if id in use             |
| PUT    | `/api/admin/npcs/:id`    | admin | Replace `displayName` + `expressions`             |
| DELETE | `/api/admin/npcs/:id`    | admin | Remove — **also deletes every portrait file** on disk |

Zod schema for create/update:

```typescript
const NpcInputSchema = z.object({
  id: NpcIdSchema,
  displayName: z.string().trim().min(1).max(120),
  expressions: z.array(z.object({
    key: ExpressionKeySchema,
    label: z.string().trim().min(1).max(64).optional(),
  })).min(1),
});
```

### Portrait upload/delete

| Method | Path                                                    | Auth  | Purpose                                                                 |
| ------ | ------------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| POST   | `/api/admin/npcs/:id/portrait/:expression`              | admin | Upload PNG via multipart. Returns `{ok, url}` on 201                    |
| DELETE | `/api/admin/npcs/:id/portrait/:expression`              | admin | Delete the file on disk                                                 |

### Upload guards

Verbatim from [`routes.ts:97-116`](backend/src/npcs/routes.ts:97):

- **Max 1 MB** per portrait (`MAX_PORTRAIT_BYTES = 1_000_000`)
- **Non-empty** file (`empty-file` if 0 bytes)
- **Must be a PNG** — checked by magic bytes:

```typescript
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}
```

- **Expression must be declared** on the NPC — if you POST a portrait
  for an undeclared expression key, 400 `expression-not-declared` +
  the current declared list is returned.

### Errors

| Status | Slug                       | Cause                                                       |
| ------ | -------------------------- | ----------------------------------------------------------- |
| 400    | `invalid-input`            | Zod fail on body                                            |
| 400    | `invalid-id`               | Path `:id` doesn't match `NPC_ID_PATTERN`                    |
| 400    | `invalid-params`           | `:id` OR `:expression` invalid on portrait endpoints         |
| 400    | `missing-file`             | Multipart with no file part                                  |
| 400    | `empty-file`               | 0-byte upload                                               |
| 400    | `file-too-large`           | > 1 MB — response includes `maxBytes`                        |
| 400    | `not-a-png`                | Magic bytes don't match                                     |
| 400    | `expression-not-declared`  | Portrait upload for an undeclared expression key             |
| 404    | `npc-not-found`            | GET/PUT/DELETE/portrait against unknown id                   |
| 404    | `portrait-not-found`       | DELETE portrait that doesn't exist on disk                   |
| 409    | `npc-exists`               | POST create with existing id                                 |

## Initial seed — [`npcs/seed.ts`](backend/src/npcs/seed.ts)

Boots the 5 NPCs the shipped `.twee` intros need. Idempotent — never
overwrites an admin edit; if a row exists, the seeder leaves it alone.

| id            | Display name              | Expressions                                |
| ------------- | ------------------------- | ------------------------------------------ |
| `elder`       | Elder of the Forest       | `neutral`, `concerned`                      |
| `nursery`     | Nursery Keeper            | `neutral`, `happy`                          |
| `tamer_guild` | Tamer Guild Officer       | `neutral`, `concerned`, `happy`             |
| `the_world`   | The World                 | `neutral`, `concerned`                      |
| `unknown`     | Unknown Presence          | `neutral`                                   |

Log line on first boot: `npc.seed.ok { inserted, skipped }`.

## Cross-reference validation into dialogues

The whole point of this registry is the import-time gate on dialogues.
See [[Dialogues#Cross-reference validation]]:

- Every dialogue node's `speaker.npcId` must exist in `npcs`.
- If it exists, `speaker.expression` must be one of the NPC's declared
  expression keys.

`buildCrossRefChecker()` prefetches `listNpcs()` once and hands both
gates to the runtime. `POST /api/admin/dialogues/import` rejects mismatches
with `unresolvedReferences` diagnostics.

### Sample rejection

```json
{
  "line": 0,
  "passage": "alice_greet",
  "message": "NPC \"alice\" has no expression \"confuzzled\""
}
```

Fixable by (a) creating the NPC or (b) declaring the expression via
`PUT /api/admin/npcs/:id`.

## What DOESN'T live here

- **Player-facing NPC dialogue** — dialogues carry the flow; NPCs just
  say who's talking. See [[Dialogues]].
- **Quest giver metadata** — a `giver` on a quest is a free-form string
  (see [[Quests#Quest]]), not necessarily an NPC id. Follow-up: unify.
- **Portrait binary storage** — files on disk, not the DB. Backups
  must include `backend/public/assets/npc/` alongside the DB, or the
  portraits get lost. See [[SQLite backup and restore]] +
  [[Postgres backup and restore]] for the accompanying data plane.

## What can go wrong

> [!warning] Portrait file uploaded but not declared
> A file at `assets/npc/elder/rage.png` without `rage` in the NPC's
> expression list is invisible to the game — dialogues can't reference
> `elder::rage` because the cross-ref check fails. Fix: declare the
> expression via `PUT /api/admin/npcs/elder`.

> [!warning] Expression declared but portrait missing
> Dialogue references `elder::concerned` successfully at import (both
> exist), but `hasPortrait: false` at render time. UI usually falls
> back to `neutral` — verify the exact fallback in the frontend
> `SpeakerPortrait` component (out of scope here). No harm to the flow;
> visual cue is degraded.

> [!warning] Delete NPC with live dialogues
> The DELETE endpoint isn't cascade-protected. Every dialogue that
> references the deleted NPC will fail its next import
> (cross-ref check). Existing saved dialogues keep working at play time
> because they don't re-import; they render the raw id + a broken
> portrait slot. Fix: audit dialogues before deleting.

> [!warning] Portrait upload MAX_PORTRAIT_BYTES stated in bytes, not KB
> The error response is `{ error: 'file-too-large', maxBytes: 1000000 }`.
> UI should format for humans (~1 MB). Currently just displays the raw
> number.

## Related

- [[Dialogues]] — the ONLY consumer of the registry; every rule here
  exists because of dialogue cross-referencing
- [[Quests]] — quests may reference NPCs via `giver` (verify —
  currently free-form)
- [[HTTP Surface]] — grep for `/api/npcs`
- [[Database Adapter]] — the `?` placeholder + upsert pattern is the
  same one every other repo uses
- [[SQLite backup and restore]] + [[Postgres backup and restore]] —
  the DB half of an NPC backup; the portrait files need separate care
