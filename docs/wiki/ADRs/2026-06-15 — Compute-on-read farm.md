---
tags:
  - digiworld/adr
aliases:
  - Compute-on-read Farm
  - No Ticker Farm
  - ADR-005
created: 2026-06-15
updated: 2026-08-01
status: Accepted
grounded-in:
  - backend/src/farm/engine.ts
verified-at-commit: 4e70621
---

# 2026-06-15 — Compute-on-read farm production

> [!info] Status
> **Accepted** and shipped since the initial farm implementation. Formula
> is verbatim at
> [`engine.ts:128`](backend/src/farm/engine.ts:128). See [[Farm]] for
> the system reference.

## Context

Every player has 4 resource-generating buildings. Each produces at a
`ratePerHour`, capped at `capacity`. The obvious implementation — "tick
every N seconds, add `rate * dt` to every building" — has one killer
problem at scale:

- **10 000 registered users × 4 buildings = 40 000 rows to touch per
  tick.** Even at a 60 s tick, that's 40 000 UPDATE-per-minute — sustained
  DB write load for a game where 95% of players aren't currently active.

The active players are the ones we care about touching. The rest are
just... expecting their farm to have grown when they come back.

A related question: what happens when the SERVER is down for 10 minutes?
Do buildings pause? Do we re-simulate the missed ticks? Does the tick
rate have to persist across restarts?

## Decision

**No ticker at all.** Buildings are stored as `(produced, last_touch,
ratePerHour, capacity)` — a checkpoint. Reads compute the current
accrued value on demand, bounded by capacity, using only wall-clock
math. Verbatim from
[`engine.ts:127-130`](backend/src/farm/engine.ts:127):

```typescript
function computeProduced(row: FarmBuildingRow, now: number): number {
  const elapsed = now - row.last_touch;
  const accrued = row.produced + (elapsed / MS_PER_HOUR) * row.rate_per_hour;
  return Math.min(row.capacity, accrued);
}
```

Writes happen ONLY on:

- **Collect** — recomputes accrued, transfers to `resources`, resets
  checkpoint (`produced = 0, last_touch = now`).
- **Upgrade** — same checkpoint reset PLUS bumps rate/capacity/cost.

The DB never remembers a "current" produced value between reads. It
remembers the state at `last_touch`, and reads derive the current from
`now`.

## Consequences

### Positive

- **Zero background writes.** No ticker, no scheduled job, no cron. DB
  writes happen only when a player explicitly interacts with their farm.
  Scales to any user count trivially — an idle account is free.
- **Server-restart invariant.** A 10-minute outage doesn't lose 10
  minutes of production. `last_touch` didn't move; the next read still
  computes from the same checkpoint. The player sees the accrued value
  as if the server were up the whole time.
- **Race-free checkpoint via guarded UPDATE**
  ([`engine.ts:75`](backend/src/farm/engine.ts:75)):
  ```sql
  UPDATE farm_buildings SET produced = ?, last_touch = ?
   WHERE id = ? AND last_touch = ?
  ```
  Two concurrent collects on the same building — one wins (produces the
  banked resources), the other sees `changes = 0` and retries the read
  cycle. No lost updates, no partial state.
- **Deterministic testing.** Every farm test is
  `readFarm(userId, time)` — a pure function of DB state + wall-clock.
  No timers, no `setTimeout` mocks, no flaky tests.
- **UI reads are cheap.** The client queries `/api/farm` on every page
  load. The response is a single SELECT + a small math loop — no DB
  writes on the READ path.

### Negative

- **No "produce-while-you-watch" UX.** The player refreshes to see new
  numbers — nothing streams updates. Fine for a farm; would be
  frustrating for a real-time production game.
- **`ratePerHour` in floating-point.** Multiplying `(elapsed /
  MS_PER_HOUR) * rate` for large elapsed times could drift for very long
  gaps (weeks). Bounded by the `capacity` clamp so it never matters
  practically, but a purist would note it.
- **The client can COMPUTE the same value locally** given the same
  inputs. If we ever exposed `ratePerHour + last_touch` and let the UI
  animate, someone could game the display. We don't — the API returns
  the RESOLVED value, not the raw checkpoint.

### Neutral

- **Capacity is the clamp, not a "full" flag.** A building at capacity
  keeps returning `capacity` on every read; only a collect frees the
  slot. This matches the intended UX (you have to check in to earn
  more) but means the client must know that `accrued >= capacity`
  implies stalled — the API returns a `full: true` boolean for clarity
  ([`engine.ts:143`](backend/src/farm/engine.ts:143)).
- **Cross-timezone semantics.** `last_touch` is server clock ms since
  epoch. A player travelling changes their local clock but not the
  server's; production keeps ticking against wall time correctly.

## Rejected alternatives

### Background ticker

The obvious "just update every 60 s" approach. Rejected because it
scales O(users × buildings) per tick, which is O(N) writes for a
population where most rows don't need updating. See Context.

### Ticker that only touches active players

Sample `active_within_5min` and tick only their buildings. Better than
full ticker but adds complexity — how do we define "active"? What if a
player refreshes their farm page but doesn't COLLECT — should the
ticker keep bumping them? Every heuristic here introduces edge cases.

The compute-on-read model just doesn't have this question.

### Store `computed_at` alongside `produced`

Every read touches DB to update `computed_at = now`. Better than a
ticker (still O(reads-per-second)), but reads are more frequent than
collects — you'd introduce the same write load, just triggered
differently.

### Denormalized "last resolved value" cache

Compute-on-read but cache the resolved value in-process for N seconds
so repeat requests within a window don't rerun the math. Rejected as
premature — the math is a few multiplications; no benchmark showed it
being a hot path.

### Simulate exactly what the ticker would have produced during downtime

Instead of resuming as-if-continuous, "correct" the numbers by
replaying missed ticks. Rejected because it's the SAME numbers by
construction (rate × time = rate × time), just more expensive to
compute and susceptible to floating-point drift over long gaps.

## Related

- [[Farm]] — the system reference
- [[Currency]] — the OTHER wallet (NetCore + Credits) that farm resources
  are deliberately isolated from
- [[HTTP Surface#Farm]] — the endpoints
- [[Database Adapter]] — the guarded UPDATE pattern for concurrent-safe
  writes on shared rows
