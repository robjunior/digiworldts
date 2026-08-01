---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Seasons
  - Ranked Seasons
  - Season Ticker
  - Season Snapshots
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/seasons/ticker.ts
  - backend/src/seasons/routes.ts
  - backend/src/seasons/repo.ts
verified-at-commit: 4e70621
---

# Seasons

> [!info] TL;DR
> Admin-scheduled ranked seasons with `starts_at` / `ends_at`
> deadlines. A background ticker runs every 60 s on every node,
> auto-closes seasons whose planned end has passed, and snapshots the
> leaderboard on close. Cluster-locked so only ONE node processes each
> auto-close, and idempotent (`already_ended` on race).

## Data model — verify shape in [`repo.ts`](backend/src/seasons/repo.ts)

```
seasons:
  id            TEXT PRIMARY KEY
  name          TEXT
  starts_at     BIGINT
  ends_at       BIGINT
  ended_at      BIGINT NULL      -- set on close (auto OR manual)
  created_by    TEXT
  created_at    BIGINT
```

`ended_at IS NULL` marks a season as "still running". Auto-close +
manual close both fill it.

Alongside, `season_snapshots` (verify) stores the leaderboard captured
at close time.

## The ticker — [`seasons/ticker.ts`](backend/src/seasons/ticker.ts)

Runs every **60 s** on every game node. Guarded by a cluster lock so
only ONE node closes each due season per tick:

```typescript
const TICK_INTERVAL_MS = 60_000;
const LOCK_KEY = 'seasons:close';
const LOCK_TTL_SEC = 30;

async function runOnce(): Promise<void> {
  if (running) return;    // in-process re-entry guard
  running = true;
  const cluster = await getCluster();
  const token = await cluster.lock(LOCK_KEY, LOCK_TTL_SEC);
  if (!token) { running = false; return; }    // another node is on it
  try {
    const now = Date.now();
    const due = await listSeasonsDueForClose(now);
    if (due.length === 0) return;
    log.info('seasons.ticker.due', { count: due.length, ids: due.map((s) => s.id) });
    for (const season of due) {
      try {
        const result = await endSeason(season.id);
        if (result.ok) {
          log.info('seasons.ticker.closed', { id: season.id, name: season.name, snapshottedUsers: result.value.snapshottedUsers });
        } else if (result.error.kind === 'already_ended') {
          // Race with admin manual-end — expected, silent.
        }
      } catch (e) { log.error('seasons.ticker.close_threw', { id: season.id, err }); }
    }
  } finally {
    await cluster.unlock(LOCK_KEY, token);
    running = false;
  }
}
```

Two levels of guard:

1. **In-process** — `running` flag prevents overlapping ticks on slow
   DB (a 60 s tick that takes 90 s doesn't queue a second tick behind
   it).
2. **Cross-node** — `seasons:close` cluster lock (30 s TTL) makes sure
   only ONE node runs `endSeason()` at any moment.

If the lock is held, this tick skips silently — the OTHER node is on
it. Next tick tries again 60 s later.

### First-pass on startup

```typescript
export function startSeasonsTicker(): void {
  if (timer !== null) return;
  void runOnce();               // immediate first pass
  timer = setInterval(() => { void runOnce(); }, TICK_INTERVAL_MS);
  log.info('seasons.ticker.started', { intervalMs: TICK_INTERVAL_MS });
}
```

The immediate `runOnce()` catches seasons whose `ends_at` expired WHILE
THE SERVER WAS DOWN — a 4-hour outage doesn't leave a stuck-open
season sitting past its deadline.

## `endSeason()` — the transactional close

Details in [`repo.ts`](backend/src/seasons/repo.ts). Header comment
promises:

- Transactional
- Idempotent (guards on `ended_at IS NULL`)
- Concurrent admin "End now" + ticker close resolve to the same
  final state — one wins the SQL update, the other returns
  `already_ended`

The `snapshottedUsers` return value counts how many rows landed in the
season_snapshots table — used in the log line for monitoring.

## HTTP surface — [`seasons/routes.ts`](backend/src/seasons/routes.ts)

**All routes require `requireAdmin`.** No public season surface here —
player-facing reads (current season, own history) are inlined into
`/api/player/career` in a separate module.

| Method | Path                                | Purpose                                              |
| ------ | ----------------------------------- | ---------------------------------------------------- |
| GET    | `/api/admin/seasons`                | List all                                             |
| GET    | `/api/admin/seasons/:id`            | Fetch one                                            |
| POST   | `/api/admin/seasons`                | Create — `{ name, startsAt, endsAt }`                |
| PATCH  | `/api/admin/seasons/:id`            | Update — partial                                     |
| POST   | `/api/admin/seasons/:id/end`        | Manual "End now" — same code path as ticker          |
| DELETE | `/api/admin/seasons/:id`            | Remove (verify — may only allow before start)        |

### Zod

```typescript
const CreateSeasonSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().nonnegative(),
}).strict();

const UpdateSeasonSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  startsAt: z.number().int().nonnegative().optional(),
  endsAt: z.number().int().nonnegative().optional(),
}).strict();
```

### Errors

```typescript
type SeasonError =
  | { kind: 'not_found' }
  | { kind: 'already_ended' }
  | { kind: 'invalid_range'; reason: string }
  | { kind: 'name_required'; reason: string };
```

Status mapping ([`routes.ts:44-52`](backend/src/seasons/routes.ts:44)):

- `not_found` → 404
- `already_ended` → 409
- `invalid_range` / `name_required` → 400

## Manual "End now"

Same code path as the ticker — `endSeason(id)`. Semantically identical.
The admin panel button and the ticker are two triggers for one
transaction; whichever hits first wins.

Response shape ([`routes.ts:103-108`](backend/src/seasons/routes.ts:103)):

```json
{
  "ok": true,
  "season": <the updated season row>,
  "snapshottedUsers": 43
}
```

Frontend refreshes the row inline.

## Design notes

> [!info] Why is there NO ticker for player-facing things?
> Farm production, dungeon state, matchmaking bracket widening — all
> compute-on-read (see [[2026-06-15 — Compute-on-read farm]]). Seasons are
> different because "close a season" has SIDE EFFECTS the client can't
> synthesize — a snapshot has to be taken, a leaderboard has to be
> frozen. That requires a WRITE, and the write has to happen even if
> nobody's currently looking.

> [!info] Why lock TTL 30 s but tick every 60 s?
> The lock TTL is the SAFETY NET for a node crashing mid-close. If a
> node dies while holding `seasons:close`, the TTL expires in 30 s and
> the next node's tick picks up. Setting TTL == tick interval would
> risk two nodes running simultaneously if one node's tick drifts.

> [!info] Player-facing career page reads
> The current active season + user's own snapshot history are exposed
> via `/api/player/career` (in a separate module — verify path). This
> file is admin-only.

## What can go wrong

> [!warning] Ticker not started at boot
> If `startSeasonsTicker()` isn't called at
> [`server.ts`](backend/src/server.ts) boot, seasons NEVER auto-close.
> Verify with `seasons.ticker.started` log line at every deploy.

> [!warning] `already_ended` on every tick
> Season closed by admin, but ticker keeps trying? No — the
> `listSeasonsDueForClose(now)` filter is `WHERE ended_at IS NULL AND
> ends_at <= ?`. A closed season won't be listed. `already_ended`
> only fires on the RACE (admin + ticker on the same season).

> [!warning] Slow `endSeason` blocks the tick
> A season with 100k+ users to snapshot could take long enough to
> exceed `LOCK_TTL_SEC = 30`. Next tick's lock acquire would succeed
> (previous lock expired), and TWO close attempts could race. The
> `ended_at IS NULL` guard in `endSeason` still saves us — but the
> snapshot table might get duplicate rows unless the snapshot
> INSERT also uses `ON CONFLICT DO NOTHING`. Verify the snapshot
> query.

## What's NOT here

- **Season leaderboard reads** — separate from admin surface. Live in
  `/api/player/career` or similar.
- **Rewards on close** — snapshot captures the ranking; distribution
  of season rewards (rank-based Credits / items) is a follow-up. The
  ticker just does the snapshot right now.
- **Season pass / progression** — seasons don't currently carry a
  battle-pass concept. Open follow-up.

## Related

- [[Cluster Coordination Layer]] — `seasons:close` lock
- [[Multi-node Deployment]] — the ticker runs on every node
- [[Matchmaking and MMR]] — MMR is not seasonally reset; a season is a
  snapshot on top of continuous MMR history
- [[HTTP Surface]] — grep for `/api/admin/seasons`
- [[Database Adapter]] — the transactional `endSeason` write
