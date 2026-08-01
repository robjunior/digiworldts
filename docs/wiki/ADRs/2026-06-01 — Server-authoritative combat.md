---
tags:
  - digiworld/adr
aliases:
  - Server-authoritative Combat
  - No Client Damage Math
  - ADR-006
created: 2026-06-01
updated: 2026-08-01
status: Accepted
grounded-in:
  - backend/src/battle/engine.ts
  - backend/src/battle/routes.ts
  - backend/src/lobby/ws.ts
  - shared/src/battle.ts
verified-at-commit: 4e70621
---

# 2026-06-01 — Server-authoritative combat

> [!info] Status
> **Accepted** and shipped since the initial combat implementation. Every
> mutation flows through
> [`applyAction()`](backend/src/battle/engine.ts) which lives on the
> server; the client never computes damage. See [[Combat]] for the
> system reference.

## Context

DigiWorld is a competitive 3v3 turn-based game with elemental affinities,
crits, misses, ailments, buffs, item consumables, and per-match global
multipliers (`damageRate`, `xpRate`). PvP outcomes drive MMR
([[Matchmaking and MMR]]) which unlocks premium content indirectly via
economy sinks. Rewards flow to `player_wallet` on match end
([[Currency]]).

Any combat model has to answer: **where does the truth about the fight
live?** Two well-known extremes:

1. **Client-side combat.** Each client computes damage, sends the
   result. Server aggregates. Best for latency, worst for cheating —
   a modified client can claim any damage, any crit, any outcome.
2. **Server-side combat.** Client submits an intent
   (`{type:'act', matchId, action}`); server owns the state and
   returns the resolved snapshot. Best for fairness, has a latency
   floor — every action is one RTT.

The interesting middle-ground positions:

3. **Client-hint / server-verify.** Client computes and sends the
   result AS a hint; server re-computes and rejects mismatches.
   Reduces perceived latency but doubles the code paths — every damage
   formula runs twice, in two languages, and any divergence is a bug
   report that ships as an "unfair" moment.
4. **Deterministic lockstep.** Both clients simulate; a single seed +
   ordered inputs guarantees identical results. Great for RTS with
   many units and few players; overkill for a 3v3 turn-based fight
   over WebSocket.

The lever we care most about: **cheat resistance**. A player who wins
matches they didn't earn poisons matchmaking (MMR moves in the wrong
direction, honest players get worse-graded opponents). A player who
LOSES matches unfairly quits. Both cases end in refund cascades or
review-bombs.

## Decision

**Fully server-authoritative combat.** Clients only send an intent:

```typescript
{ type: 'act', matchId, action: Action }
```

Server:

1. Locks the match state (`battle:lock:{matchId}` cluster lock).
2. Loads the snapshot (`battle:snap:{matchId}`), verifies the sender
   owns the acting unit, verifies the action is legal (right turn,
   right side, target valid, enough EN, skill in cooldown, etc).
3. Runs `applyAction()` — the ONLY code path that computes damage,
   misses, crits, ailments, buffs, EN regen, KOs, turn-cursor
   advancement, initiative recomputation.
4. Persists the mutated snapshot back to `battle:snap:{matchId}`.
5. Returns a full `BattleView` snapshot + fine-grained
   `BattleEvent[]` for animation.

Clients don't compute anything. Not damage, not crit chance, not
whether a skill will hit. The UI receives events and plays them.

## Consequences

### Positive

- **Cheating is a lookup failure at worst.** A modified client can
  send `{ action: 'kill_opponent' }` — the server doesn't have that
  action, it 400s. It can send `{ action: 'fight', unitId:
  <opponent_unit> }` — server checks `unit.side === sender.side`,
  returns `not-your-unit`. Every error path is documented in
  [[WebSocket Protocol#Error codes]].
- **One source of truth for damage math.** When a designer tunes the
  crit chance from 15% → 12%, exactly one file changes:
  [`battle/engine.ts`](backend/src/battle/engine.ts). No client
  update, no protocol change, no version skew.
- **`damageRate` global tuning is free.** Admin bumps the multiplier
  in `game_settings.damage_rate`; new matches pick up the value at
  `initBattle` (frozen for the match's lifetime — see
  [[Combat#damageRate freezing]]). Existing matches keep their frozen
  rate. Zero client action required.
- **Post-match rewards are atomic with the match end.** Server
  computes outcome, calculates NetCore + XP, writes wallet + roster
  in the same tx that marks the match ended. No "server thinks I won,
  client thinks I lost" ledger discrepancy possible.
- **Spectator mode is free.** Any authed user can subscribe to
  `battle:snap:{matchId}` (with enemy-side redacted per
  [[Combat#Spectator mode]]) — the game state is already server-side.
- **Cross-node battle mutations are safe.** With
  [[Cluster Coordination Layer|CLUSTER=redis]], any node can serve any
  player's action. The lock + snapshot pattern serialises mutations
  cross-node — see [[Multi-node Deployment#What crosses nodes]].
- **Testable in isolation.** [`test/battle-combo.mts`](backend/test/battle-combo.mts)
  runs `applyAction` in-process against synthetic snapshots, verifies
  47 combat scenarios. No WebSocket, no client, no rendering — the
  formula is pure data-in, data-out.

### Negative

- **One RTT per action.** Every fight/skill/use_item/flee is a round
  trip to the server + back. At 100 ms RTT, that's 100 ms of "why is
  my click doing nothing?" latency. We mitigate with optimistic UI
  (button disables + spinner) but can't eliminate.
- **Server CPU per action.** `applyAction` is milliseconds of work,
  but on a busy multi-node with hundreds of concurrent matches, it
  adds up. Not currently a bottleneck; would be first if load
  climbs to 4-digit concurrent battles.
- **`battle:snap:{matchId}` is a full JSON blob per match.** ~few KB
  per match × 30 min TTL × concurrent-match cap = bounded memory
  cost on Redis. `MAX_CONCURRENT_MATCHES` (default 200) caps this.
- **Animation timing has to be reconstructed client-side.** Server
  returns events (`{type:'action', damage:120, cue:'crit'}`); client
  plays a crit VFX. If the client is slow or animation is bad, the
  perceived combat feels janky even though the server did the right
  thing.

### Neutral

- **`Action` union type is the wire contract.** Every new action
  (capture, use_item added post-launch) requires a shared type
  change in [`shared/src/battle.ts`](shared/src/battle.ts) — clients
  and server MUST agree. Version skew during rolling deploy is
  handled by the multi-node ip_hash stickiness ([[Multi-node
  Deployment#Session pinning vs socket pinning]]).
- **Item effects resolve on the server.** Client sends
  `{type:'use_item', itemId, targetId}`; server looks up the
  `shop_item`, decodes payload, applies the `ItemEffect` to the
  target. See [[Combat#Actions]]. Client never carries item power
  numbers.

## Rejected alternatives

### Client-side combat

Rejected trivially. Trust boundary at the client is a security
disaster for a competitive game. See Context. This is only viable
for single-player games where "cheating" hurts nobody but the player.

### Client-hint / server-verify

The pragmatic middle ground for latency-sensitive games (League of
Legends does something like this). Rejected for DigiWorld because:

1. **Turn-based means one action per second at most.** Latency isn't
   the bottleneck; there's no perceived improvement from local
   prediction.
2. **Doubles the code paths.** Damage math has to live in both
   TypeScript (client) and TypeScript (server). Same language, but
   two files, two versions, one is more likely to be updated during
   a balance patch.
3. **Divergence is a bug report.** "The client said 120 damage, the
   server said 118" — even if server wins, the animation flicker is a
   perceived bug.

### Deterministic lockstep

Both clients simulate a shared PRNG with the same seed + ordered
inputs. Popular in RTS. Rejected because:

1. **Requires perfect determinism** across two JavaScript engines
   running different browsers on different OSes. TS Number semantics
   are consistent BUT any Math.random / Date.now / floating-point
   ordering divergence desyncs the sim.
2. **Server needs to run the sim too** to compute post-match rewards
   authoritatively. So we're now shipping the sim THREE times (client
   A, client B, server), all of which must agree.
3. **The perceived-latency win only matters for high-frequency input.**
   3v3 turn-based isn't that.

### Full commit-reveal per action (crypto-level anti-cheat)

Cryptographic commitment to a hidden action (e.g., "I commit to
attacking with skill X"), reveal after opponent's response. Rejected as
massively over-engineered for a casual game — the ceremony overhead
kills the UX and the server-authoritative model already prevents
every cheat vector this would.

## Related

- [[Combat]] — the system reference
- [[WebSocket Protocol#act]] — the wire message
- [[Matchmaking and MMR]] — where cheat resistance matters most
- [[Cluster Coordination Layer#battle:snap:{matchId} + battle:lock:{matchId}]]
- [[Currency]] — post-match wallet grants (also server-authoritative)
