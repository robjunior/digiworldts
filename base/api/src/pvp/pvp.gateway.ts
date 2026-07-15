import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/auth.types';
import type { SerializedFightState } from '../digimon/digimon.types';
import { LIVE_RNG } from '../digimon/rng';
import { PrismaService } from '../prisma/prisma.service';
import { PvpService } from './pvp.service';
import type { LiveMatchSummary, PvpTurnView } from './pvp.types';

/**
 * TASK-198 (R-25a-follow3 slice 57) — the reconnect GRACE WINDOW. On a mid-fight socket
 * drop the forfeit is DEFERRED by this many ms rather than scored in the same tick, so a
 * momentary network blip (a wifi hiccup, a phone switching towers, a laptop sleeping for a
 * couple of seconds) no longer INSTANTLY costs the player the whole match + an Elo penalty:
 * if the SAME user reconnects within the window the pending forfeit is cancelled and the
 * match survives. A two-way-door DATA choice — any later "too short/too long" INBOX note is
 * a one-line re-tune. ~10s is a generous single-blip recovery window without stalling a
 * legitimately-abandoned match's result for long.
 */
export const PVP_FORFEIT_GRACE_MS = 10_000;

/**
 * The live PvP realtime gateway (TASK-192, R-25 slice 51 — the FIRST realtime slice).
 *
 * This is the socket-side twin of the OFFLINE `/api/pvp/*` HTTP flow: today a challenge
 * resolves against a static roster snapshot with the opponent NOT present. This gateway
 * stands up the deferred Socket.IO substrate (I-1's founding vision named it; R-1/R-11
 * deferred it "to the slice that first needs it") and delivers the LIVE
 * challenge→accept HANDSHAKE — the target player's browser receives a challenge in real
 * time and accepting lands both in one match room.
 *
 * SCOPE (invariant 5 — a NEW sibling transport, the engine byte-frozen): this slice
 * carries ONLY the challenge/accept NOTIFICATIONS + a presence registry. It moves NO
 * authoritative game state — combat stays server-authoritative through the byte-frozen
 * `battleTurn`/HTTP seam, and the live synchronized per-turn COMBAT broadcast is carved
 * to R-25a. So there is NO spendable value, NO `AuditLog`, NO `$transaction` here
 * (invariant 3 UNTRIGGERED); the free XP/MMR of a resolved duel still writes through
 * R-12's existing audited path when R-25a runs a live fight to its end.
 *
 * AUTH (invariant 2): every socket is authenticated on CONNECTION from the JWT in its
 * handshake (`auth.token`, reusing the SAME `JwtService`/secret `AuthModule` configures
 * — mirroring `JwtAuthGuard`, NEVER trusting a client-supplied userId). An unauthenticated
 * socket is disconnected. A `challenged` push targets the specific opponent's socket only;
 * a player challenges as THEMSELVES (the verified socket identity) and the server resolves
 * the display name via the owner-scoped user read — never a client-supplied name.
 *
 * PRESENCE is an in-memory `Map<userId, socketId>` — a live duel is ephemeral, so (like
 * the client-carried FightState doctrine A-123) there is NO DB session store to persist.
 */
@WebSocketGateway({
  namespace: '/pvp',
  // CORS origin from the SAME env the HTTP CORS reads (`app.ts` `WEB_ORIGIN`), so the
  // browser socket contract matches the browser HTTP contract. Multiple origins may be
  // given comma-separated, identical to `createApp()`'s parsing.
  cors: {
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class PvpGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /**
   * The Socket.IO namespace server, injected by Nest after boot (via `@WebSocketServer`).
   * The `challenged`/`matched` emits above are the only sinks. Definite-assignment (`!`)
   * because Nest sets it before any message is handled.
   */
  @WebSocketServer()
  private readonly server!: Server;

  /**
   * In-memory presence: which connected socket a signed-in user is on. Ephemeral — a
   * disconnect removes the entry; nothing is persisted (A-123). `userId → socketId`.
   */
  private readonly online = new Map<string, string>();

  /**
   * TASK-193 (R-25a slice 52) — the ephemeral MATCH-ROOM registry: which two players
   * share a live duel, keyed by the `matchId` minted on `accept`. In-memory only (A-123,
   * mirroring the presence `Map` above): a live duel is ephemeral, so there is NO DB
   * session store — a process restart forgets in-flight matches (acceptable; the client
   * simply re-challenges). The `turn` handler looks a match up here to (a) authorize the
   * sender as a participant (invariant 2) and (b) find BOTH sockets to push the resolved
   * turn to. `matchId → { challengerId, opponentId }`.
   */
  private readonly matches = new Map<string, { challengerId: string; opponentId: string }>();

  /**
   * TASK-198 (R-25a-follow3 slice 57) — pending-forfeit timers, keyed by `matchId`. When a
   * participant's socket drops, instead of forfeiting immediately we arm a `setTimeout`
   * here; if the same user reconnects within the grace window the timer is cleared and the
   * match survives, otherwise the timer callback (`expireForfeit`) runs the EXACT scored
   * forfeit path. Ephemeral in-memory only (A-123, mirroring `online`/`matches`): a process
   * restart forgets in-flight timers. `matchId → timer`.
   */
  private readonly pendingForfeits = new Map<string, NodeJS.Timeout>();

  /**
   * TASK-199 (R-25a-follow3 slice 58) — the last-known TURN VIEW per live match, keyed by
   * `matchId`. Ephemeral in-memory only (A-123, mirroring `online`/`matches`/`pendingForfeits`
   * — a process restart forgets in-flight views; the client simply re-challenges). Captured
   * in {@link handleTurn} each time a turn resolves and REPLAYED to a socket that RECONNECTS
   * FRESH (a page reload / new socket) within the grace window, so the rejoining client
   * RESUMES the exact in-progress fight (HP/round/log/menu) instead of landing on an empty
   * menu with no live panel. Deleted on a terminal outcome (a finished fight needs no
   * resume), in {@link expireForfeit}, and wherever the room is torn down, so it never leaks
   * past its match. NOT on any wire contract — it carries a `PvpTurnView`, the same shape the
   * `turn`/`rejoined` pushes already send. `matchId → PvpTurnView`.
   */
  private readonly lastViews = new Map<string, PvpTurnView>();

  /**
   * TASK-313 (R-44b — the live-opponent submission BUFFER) — the ephemeral per-match
   * PAIRING buffer that holds one live player's skill pick until the OTHER's arrives, keyed
   * by `matchId`. In-memory only (A-123, mirroring `matches`/`lastViews` — a process restart
   * forgets in-flight submissions; the client simply re-submits). Each entry has a
   * `challenger` slot (carrying the client-carried authoritative `state`/`difficulty` snapshot)
   * and an `opponent` slot (only a skill CHOICE — the opponent's champion STATS stay
   * DB-authoritative in `challengeTurn`). When BOTH slots fill, {@link handleSubmit} resolves
   * ONE exchange (challenger → `skillId`, opponent → `opponentSkillId`, the TASK-312 seam) and
   * clears the entry. Torn down alongside the room on a terminal outcome (in
   * {@link resolveAndBroadcast}) so it never leaks past its match. NOT on any wire contract.
   * `matchId → { challenger?, opponent? }`.
   */
  private readonly pendingSubmissions = new Map<
    string,
    {
      challenger?: {
        skillId?: string;
        action?: 'flee' | 'pass' | 'timeout';
        state?: SerializedFightState;
        difficulty?: 'easy' | 'normal' | 'hard';
      };
      opponent?: { skillId?: string; action?: 'flee' | 'pass' | 'timeout' };
    }
  >();

  /**
   * The grace window used to arm a deferred forfeit. Defaults to {@link PVP_FORFEIT_GRACE_MS}
   * but is a MUTABLE instance field so the gateway e2e can drive the EXPIRY path fast
   * (override to a few ms via `app.get(PvpGateway).graceMs = …`) without a fixed multi-second
   * sleep — the timer fires deterministically. Not part of any wire contract.
   */
  graceMs = PVP_FORFEIT_GRACE_MS;

  // Explicit @Inject() tokens — REQUIRED, not decorative (L-7/P-7): the vitest/esbuild
  // transform does NOT emit constructor `design:paramtypes` (unlike the production
  // `nest build` via tsc), so a bare reflected param type would inject `undefined` under
  // the gate. Naming the provider directly needs no reflected metadata, so it resolves
  // identically under esbuild (tests) and tsc (build). `JwtService` resolves because
  // `PvpModule` imports `AuthModule`, which re-exports `JwtModule` (the same cross-module
  // wiring the guard uses); `PrismaService` because `PvpModule` imports `PrismaModule`;
  // `PvpService` because it is a provider of THIS module (TASK-193 — the `turn` handler
  // resolves the live turn through the shared `challengeTurn`/`battleTurn` seam).
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PvpService) private readonly pvp: PvpService,
  ) {}

  /**
   * Authenticate on connection (invariant 2). Read the JWT from the socket handshake
   * `auth.token` and verify it with the SAME `JwtService` `JwtAuthGuard` uses. A valid
   * token pins the verified userId onto `socket.data.userId` and registers presence; an
   * absent/invalid token disconnects the socket (an unauthenticated client can never join
   * the realtime surface). NEVER trusts a client-supplied userId — only the token subject.
   */
  handleConnection(socket: Socket): void {
    const token = this.extractToken(socket);
    if (token === undefined) {
      socket.disconnect(true);
      return;
    }
    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token);
    } catch {
      socket.disconnect(true);
      return;
    }
    socket.data.userId = payload.sub;
    this.online.set(payload.sub, socket.id);

    // TASK-198 (R-25a-follow3 slice 57) — REJOIN SWEEP. If this user dropped mid-fight and
    // reconnects within the grace window, cancel the pending forfeit and keep the match
    // alive. For every live `matches` room this VERIFIED `payload.sub` participates in that
    // has an armed pending-forfeit timer, clear the timer, drop the `pendingForfeits` entry,
    // and PUSH `rejoined { matchId }` to BOTH this reconnecting socket AND the peer's socket
    // (resolved from `online`, if present) — owner-scoped (invariant 2), keyed off the
    // verified subject's room membership, NEVER a client field. The `matches` room stores
    // userIds (not socketIds), so re-registering presence above is all a rejoin needs — the
    // next `turn` from either side already resolves the current socket via `online`.
    for (const [matchId, room] of this.matches) {
      if (room.challengerId !== payload.sub && room.opponentId !== payload.sub) {
        continue;
      }
      const timer = this.pendingForfeits.get(matchId);
      if (timer === undefined) {
        continue;
      }
      clearTimeout(timer);
      this.pendingForfeits.delete(matchId);
      // TASK-199 — re-seed the rejoining socket with the last-known in-progress turn view
      // (may be `undefined` if no turn has resolved yet — then the client simply reopens the
      // opening menu as before). Owner-scoped: this socket belongs to the VERIFIED
      // `payload.sub`, a participant of this room. The peer already holds live state in its
      // still-mounted component, so its push stays the matchId-only shape (do not disturb it).
      socket.emit('rejoined', { matchId, view: this.lastViews.get(matchId) });
      const otherId = room.challengerId === payload.sub ? room.opponentId : room.challengerId;
      const otherSocketId = this.online.get(otherId);
      if (otherSocketId !== undefined) {
        this.server.to(otherSocketId).emit('rejoined', { matchId });
      }
    }
  }

  /**
   * The socket went away. Drop the presence entry (only if it still owns the id), THEN —
   * TASK-194 (R-25a-follow slice 53) — sweep any live match room this user is in and
   * notify the OTHER participant so a mid-fight disconnect no longer STRANDS them.
   *
   * Before this slice `handleDisconnect` only dropped presence: if A dropped mid-fight, B
   * waited forever for a `turn` that would never arrive and the `matches` entry LEAKED in
   * memory. Now, for every match room the dropping `userId` participates in (as
   * `challengerId` OR `opponentId`), we resolve the OTHER participant's socketId from the
   * presence map and PUSH `opponent_left { matchId }` to THAT socket only (owner-scoped,
   * invariant 2 — keyed off the VERIFIED `socket.data.userId` match membership, NEVER a
   * client field), then DELETE the entry so the room does not leak. The web `/pvp` renders
   * an "Opponent disconnected — match ended" banner and ends the live-fight panel.
   *
   * TASK-197 (R-25a-follow2 slice 56) — the sweep now ALSO SCORES the abandon as a
   * forfeit: for each swept live room the dropping user was in, `PvpService.forfeitMatch`
   * applies the symmetric Elo move (the still-online `otherId` WINS, the dropping `userId`
   * LOSES) and we PUSH a NEW `match_forfeited { matchId, outcome, ratings }` to the
   * remaining participant's socket (owner-scoped, invariant 2). We keep emitting
   * `opponent_left` too (back-compat: TASK-194's notify-only path/test/UX stays green; the
   * scored result is purely additive — the web upgrade drives off `match_forfeited`). The
   * rating write reuses `challengeTurn`'s exact `elo` + owner-scoped `$transaction` shape —
   * `battle.ts` / the engine is NOT touched; MMR is domain progression so NO `AuditLog`
   * (invariant 3 UNTRIGGERED, A-176/A-179).
   *
   * A disconnect with NO live match emits nothing, writes NO rating and does not crash.
   * Invariant 5 held (`match_forfeited` is a NEW additive sibling event; the engine/turn
   * seam is byte-unchanged, `battle.ts` untouched).
   *
   * TASK-198 (R-25a-follow3 slice 57) — the forfeit is now DEFERRED behind a grace window
   * instead of scored in this same tick. For each live room the dropping user is in, we no
   * longer delete the room or write the rating here; we arm a `setTimeout(graceMs)` keyed on
   * the `matchId` (idempotent — if a timer already exists for that match we skip). The
   * `matches` room SURVIVES so a `handleConnection` rejoin sweep can find and cancel it. If
   * the window expires with no rejoin, {@link expireForfeit} runs the EXACT TASK-197 scored
   * forfeit body verbatim (byte-identical outcome, just delayed). A brief blip is thus
   * recoverable; a genuine abandon still forfeits after the window.
   *
   * A disconnect with NO live match arms no timer, writes NO rating and does not crash.
   * Invariant 5 held (`rejoined` is a NEW additive sibling event; the engine/turn seam +
   * `battle.ts` are byte-unchanged; the scored outcome is TASK-197's, only deferred).
   *
   * Presence is dropped FIRST (synchronous) so the dropping user's own now-stale socketId
   * can never be resolved as "the other participant" when the timer later fires — only a
   * still-online peer is pushed to and credited.
   */
  handleDisconnect(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    if (userId === undefined) {
      return;
    }
    if (this.online.get(userId) === socket.id) {
      this.online.delete(userId);
    }
    // For each live room the dropping user is in, DEFER the forfeit behind the grace window
    // (do NOT delete the room or score here — a rejoin within the window cancels it).
    for (const [matchId, room] of this.matches) {
      if (room.challengerId !== userId && room.opponentId !== userId) {
        continue;
      }
      // Idempotent: if a timer is already armed for this match (e.g. both sides dropped),
      // do not stack a second one.
      if (this.pendingForfeits.has(matchId)) {
        continue;
      }
      const timer = setTimeout(() => {
        void this.expireForfeit(matchId, userId);
      }, this.graceMs);
      this.pendingForfeits.set(matchId, timer);
    }
  }

  /**
   * TASK-198 — the DEFERRED forfeit: the grace window expired with no rejoin, so score the
   * abandon exactly as TASK-197 did in the same tick before. Re-read the room from `matches`
   * (if it is already gone — rejoined, or a double-fire — return without effect), clear its
   * `pendingForfeits` entry, delete the room, then run the EXACT TASK-197 forfeit body:
   * resolve `otherId`/`otherSocketId` from the CURRENT presence map, apply the symmetric Elo
   * move (`forfeitMatch(otherId, leaverId)` — the remaining player WINS, the leaver LOSES),
   * and PUSH `opponent_left` + `match_forfeited { matchId, outcome, ratings }` to the
   * remaining participant's socket (owner-scoped, invariant 2). Because `otherSocketId` is
   * re-resolved at EXPIRY, a peer who also dropped and reconnected is still reached correctly.
   */
  async expireForfeit(matchId: string, leaverId: string): Promise<void> {
    const room = this.matches.get(matchId);
    this.pendingForfeits.delete(matchId);
    if (room === undefined) {
      // Already rejoined (timer cleared) or double-fired — nothing to score.
      return;
    }
    this.matches.delete(matchId);
    // TASK-199 — the room is gone, so drop any retained view (it can never be resumed now).
    this.lastViews.delete(matchId);
    // TASK-201 (R-25a-follow3 slice 60) — the match ended (forfeited): tell any spectators
    // watching this room to close their read-only panel. Additive room emit (see
    // {@link handleWatchMatch}); the owner-scoped `opponent_left`/`match_forfeited` pushes
    // below are byte-unchanged. Socket.IO auto-cleans the now-empty spectator room.
    this.server.to(this.spectatorRoom(matchId)).emit('spectator_ended', { matchId });
    const otherId = room.challengerId === leaverId ? room.opponentId : room.challengerId;
    const otherSocketId = this.online.get(otherId);
    // The remaining player WINS the forfeit; the dropping `leaverId` LOSES.
    const result = await this.pvp.forfeitMatch(otherId, leaverId);
    if (otherSocketId !== undefined) {
      this.server.to(otherSocketId).emit('opponent_left', { matchId });
      this.server.to(otherSocketId).emit('match_forfeited', {
        matchId,
        outcome: result.outcome,
        ratings: result.ratings,
      });
    }
    // TASK-200 — the forfeited match left the live-match SET; refresh the lobby so it
    // disappears from every online client's live-matches list in real time.
    await this.broadcastLobby();
  }

  /**
   * A player challenges another to a live duel. If the target is ONLINE, push a
   * `challenged` event to THAT socket only (owner-scoped, invariant 2) carrying the
   * challenger's server-authoritative display name (resolved via the owner-scoped user
   * read, NEVER a client-supplied name). If the target is OFFLINE, ack `{online:false}`
   * to the challenger (graceful — no crash). The `fromUserId` is the VERIFIED socket
   * identity, not a client field.
   */
  @SubscribeMessage('challenge')
  async handleChallenge(
    socket: Socket,
    payload: { opponentId?: string },
  ): Promise<{ online: boolean }> {
    const fromUserId = socket.data.userId as string | undefined;
    const opponentId = payload?.opponentId;
    if (fromUserId === undefined || typeof opponentId !== 'string' || opponentId.length === 0) {
      return { online: false };
    }
    const targetSocketId = this.online.get(opponentId);
    if (targetSocketId === undefined) {
      return { online: false };
    }
    const fromDisplayName = await this.displayNameFor(fromUserId);
    this.server.to(targetSocketId).emit('challenged', { fromUserId, fromDisplayName });
    return { online: true };
  }

  /**
   * The challenged player ACCEPTS. Emit `matched` to BOTH sockets (the acceptor's own
   * socket + the original challenger's, if still online) with a fresh `matchId`,
   * establishing the shared room. This slice proves the handshake REACHES a live
   * opponent, nothing more — the live per-turn COMBAT broadcast is R-25a.
   */
  @SubscribeMessage('accept')
  handleAccept(socket: Socket, payload: { fromUserId?: string }): { matchId: string } | { online: false } {
    const opponentId = socket.data.userId as string | undefined; // the acceptor (verified)
    const challengerId = payload?.fromUserId;
    if (opponentId === undefined || typeof challengerId !== 'string' || challengerId.length === 0) {
      return { online: false };
    }
    const matchId = randomUUID();
    const matched = { matchId, challengerId, opponentId };
    // TASK-193: register the shared match room BEFORE emitting `matched`, so the very
    // first `turn` a client sends against this `matchId` finds its participants (A-123,
    // ephemeral in-memory only). The `turn` handler authorizes senders against + pushes
    // resolved turns to the two participants recorded here.
    this.matches.set(matchId, { challengerId, opponentId });
    // The acceptor's own socket always receives it; the challenger's only if still online.
    socket.emit('matched', matched);
    const challengerSocketId = this.online.get(challengerId);
    if (challengerSocketId !== undefined && challengerSocketId !== socket.id) {
      this.server.to(challengerSocketId).emit('matched', matched);
    }
    // TASK-200 (R-25a-follow3 slice 59) — the live-match SET just grew; re-broadcast the
    // lobby so every online `/pvp` socket's live-matches list picks up this new duel in
    // real time. Fire-and-observe (additive): the `matched` payload above is byte-unchanged.
    void this.broadcastLobby();
    return { matchId };
  }

  /**
   * TASK-193 (R-25a slice 52) — the LIVE SHARED TURN. A participant of a `matchId` room
   * drives ONE turn of the shared duel; the server resolves it through the byte-frozen
   * `battleTurn`/`challengeTurn` seam (opponent injected as `foe`, `skipEconomicReward=true`
   * as `PvpService.challengeTurn` already does, `LIVE_RNG` for real entropy — L-75) and
   * PUSHES the resolved `PvpTurnView` to BOTH participant sockets, so a skill either player
   * picks appears live on both HUDs without a reload.
   *
   * AUTH (invariant 2): the sender is the VERIFIED `socket.data.userId`, and the turn is
   * accepted ONLY if that user is a participant of the given `matchId` room (rejected
   * otherwise). An unknown `matchId` is rejected gracefully (ack `{ok:false}`, no crash).
   * The turn resolves from the sender's OWN champion (owner-scoped in `challengeTurn`) vs
   * the OTHER participant as `foe` — a player drives only their own side.
   *
   * INVARIANT 5: this only CALLS the shared seam; `battle.ts`/`battleTurn`/every wire SHAPE
   * is byte-unchanged. INVARIANT 3 UNTRIGGERED: `challengeTurn` resolves with
   * `skipEconomicReward=true`, so no spendable value / audit row moves here (the ended-fight
   * Elo/MMR write over R-12's audited path is CARVED to the R-25a follow-on child; note
   * `challengeTurn` DOES currently apply the Elo move on an ended ranked duel — but a live
   * broadcast turn moves NO loot/resource, only the free rating, exactly as the offline HTTP
   * `challenge/turn` does today; no NEW audited value is introduced by the broadcast).
   */
  @SubscribeMessage('turn')
  async handleTurn(
    socket: Socket,
    payload: {
      matchId?: string;
      skillId?: string;
      action?: 'flee' | 'pass' | 'timeout';
      state?: SerializedFightState;
      difficulty?: 'easy' | 'normal' | 'hard';
    },
  ): Promise<{ ok: boolean }> {
    const userId = socket.data.userId as string | undefined;
    const matchId = payload?.matchId;
    if (userId === undefined || typeof matchId !== 'string' || matchId.length === 0) {
      return { ok: false };
    }
    const room = this.matches.get(matchId);
    // Unknown match → reject gracefully (no crash). Non-participant → reject (invariant 2).
    if (room === undefined) {
      return { ok: false };
    }
    if (userId !== room.challengerId && userId !== room.opponentId) {
      return { ok: false };
    }

    // The OTHER participant is the opponent (`foe`) for THIS sender's turn.
    const opponentId = userId === room.challengerId ? room.opponentId : room.challengerId;

    // Resolve through the SHARED byte-frozen seam. `challengeTurn(challengerId, dto, rng)`
    // reads the sender's champion owner-scoped, injects the opponent as `foe`, and passes
    // `skipEconomicReward=true` — exactly the offline HTTP path, minus the HTTP transport.
    const view = await this.pvp.challengeTurn(
      userId,
      {
        opponentId,
        skillId: payload.skillId,
        state: payload.state,
        action: payload.action,
        difficulty: payload.difficulty,
      },
      LIVE_RNG,
    );

    // TASK-313 (R-44b — live-opponent submission BUFFER): the broadcast + teardown tail is
    // shared VERBATIM with `handleSubmit` via {@link resolveAndBroadcast} (a pure extraction —
    // `handleTurn`'s behaviour is byte-identical). One-sided AI-driven turn resolved above.
    await this.resolveAndBroadcast(matchId, room, view);
    return { ok: true };
  }

  /**
   * TASK-313 (R-44b — live-opponent submission BUFFER) — the SHARED broadcast + teardown tail
   * for a resolved `PvpTurnView`, called IDENTICALLY by {@link handleTurn} (the one-sided
   * AI-driven path) and {@link handleSubmit} (the two-sided paired path). A PURE extraction of
   * `handleTurn`'s prior inline tail — every step (the terminal `lastViews`/`matches`/
   * `pendingForfeits` teardown + spectator `spectator_ended`, the both-participants `turn { view }`
   * point-to-point push loop, the `spectator_turn` room fan-out, and the `broadcastLobby()` on a
   * shrunk set) is byte-for-byte what `handleTurn` did before, so the existing `turn` flow +
   * every prior `pvp.gateway.spec.ts` case stays green with NO behaviour change (invariant 5).
   */
  private async resolveAndBroadcast(
    matchId: string,
    room: { challengerId: string; opponentId: string },
    view: PvpTurnView,
  ): Promise<void> {
    // TASK-199 (R-25a-follow3 slice 58) — RETAIN the newest resolved view so a fresh reconnect
    // (page reload / new socket) can RESUME the exact in-progress fight. On a terminal outcome
    // the fight is over and needs no resume, so drop the entry rather than replay a finished
    // fight to a rejoining socket. Ephemeral (A-123); the wire SHAPE is untouched.
    //
    // TASK-200 (R-25a-follow3 slice 59) — a terminal outcome ENDS the live match, so the room
    // is no longer "in progress": tear it down (`matches.delete`) and any armed pending forfeit
    // for it, then re-broadcast the lobby so this duel disappears from every online client's
    // live-matches list in real time. A mid-fight turn leaves `matches` untouched (the SET is
    // unchanged → no lobby broadcast). All additive: the `turn` push payload is byte-unchanged.
    let matchEnded = false;
    if (view.battle.outcome !== null) {
      this.lastViews.delete(matchId);
      this.matches.delete(matchId);
      // TASK-313 — the paired-submission buffer is torn down with the room so it never leaks
      // past its match (mirroring the pendingForfeits teardown below).
      this.pendingSubmissions.delete(matchId);
      const timer = this.pendingForfeits.get(matchId);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.pendingForfeits.delete(matchId);
      }
      matchEnded = true;
    } else {
      this.lastViews.set(matchId, view);
    }

    // Push the resolved turn to BOTH participants (owner-scoped to their two socketIds via
    // the presence map). A player not currently connected simply misses the push (ephemeral).
    for (const participantId of [room.challengerId, room.opponentId]) {
      const socketId = this.online.get(participantId);
      if (socketId !== undefined) {
        this.server.to(socketId).emit('turn', { view });
      }
    }
    // TASK-201 (R-25a-follow3 slice 60) — ADDITIVE spectator fan-out: after the byte-unchanged
    // participant point-to-point loop above, emit the SAME already-computed `view` (no recompute)
    // to the per-match spectator ROOM under a DISTINCT event name (`spectator_turn`, NOT the
    // participants' `turn`), so every watching bystander sees this resolved turn live while the
    // participant `turn` contract stays untouched. Fires for non-terminal AND terminal turns (a
    // spectator sees the final resolving turn carrying `view.battle.outcome`).
    this.server.to(this.spectatorRoom(matchId)).emit('spectator_turn', { matchId, view });
    // On a terminal turn the room is torn down (see above) — tell spectators to close their
    // read-only panel; Socket.IO then auto-cleans the now-empty room.
    if (matchEnded) {
      this.server.to(this.spectatorRoom(matchId)).emit('spectator_ended', { matchId });
    }
    // TASK-200 — if the live-match SET shrank (this fight ended), refresh the lobby.
    if (matchEnded) {
      void this.broadcastLobby();
    }
  }

  /**
   * TASK-313 (R-44b — the live-opponent submission BUFFER) — the human-facing half that makes a
   * live PvP duel truly TWO-SIDED. Where {@link handleTurn} resolves a turn ONE-SIDEDLY (the
   * emitting socket is the challenger; the opponent's move is the engine AI), `submit` PAIRS both
   * live humans' picks: each player emits their chosen skill, the server BUFFERS the first until
   * the second arrives, then resolves ONE exchange feeding the challenger's pick as `skillId` and
   * the opponent's as `opponentSkillId` (the TASK-312 engine seam) and broadcasts the resolved
   * `turn { view }` to both via the SAME {@link resolveAndBroadcast} tail.
   *
   * AUTH (invariant 2): identical guards to `handleTurn` — `userId` is the VERIFIED
   * `socket.data.userId` (never a wire id), the `matchId` must be a current `matches` room, and
   * the sender must be a participant of it; else `{ ok:false }`, no resolution, no push.
   *
   * BUFFERING: this player's pick is recorded into `pendingSubmissions.get(matchId)` under the
   * slot matching their side (challenger vs opponent). The challenger slot ALSO carries the
   * client-carried `state`/`difficulty` — that is the authoritative fight snapshot fed to the
   * exchange (the opponent supplies only a skill CHOICE; their champion STATS stay DB-authoritative
   * in `challengeTurn`). If a slot is already filled this round, the latest pick overwrites it
   * (last pick wins before resolution) — never resolve twice. When BOTH slots are present the
   * exchange resolves, the buffer is cleared, and the resolved view is broadcast. A supplied skill
   * the opponent's champion cannot legally use is refused DOWNSTREAM (the TASK-312 422): the ack is
   * `{ ok:false }` and NEITHER the room NOR the (still-valid) opposing slot is torn down, so the
   * offending player can re-submit a legal pick — never a silent AI fallback (invariant 2).
   *
   * ACK: `{ ok:true, waiting }` where `waiting` is true iff the other slot is still empty (so the
   * client can show "waiting for opponent" until the second submission lands). Additive — no
   * existing contract touched; the absent-`submit` path is the AI-driven `turn` duel, byte-identical.
   */
  @SubscribeMessage('submit')
  async handleSubmit(
    socket: Socket,
    payload: {
      matchId?: string;
      skillId?: string;
      action?: 'flee' | 'pass' | 'timeout';
      state?: SerializedFightState;
      difficulty?: 'easy' | 'normal' | 'hard';
    },
  ): Promise<{ ok: boolean; waiting?: boolean }> {
    const userId = socket.data.userId as string | undefined;
    const matchId = payload?.matchId;
    if (userId === undefined || typeof matchId !== 'string' || matchId.length === 0) {
      return { ok: false };
    }
    const room = this.matches.get(matchId);
    // Unknown match → reject gracefully (no crash). Non-participant → reject (invariant 2).
    if (room === undefined) {
      return { ok: false };
    }
    if (userId !== room.challengerId && userId !== room.opponentId) {
      return { ok: false };
    }

    // Record this player's pick under their slot. The challenger's slot carries the authoritative
    // client fight snapshot (`state`/`difficulty`); the opponent supplies only a skill CHOICE.
    const buffer = this.pendingSubmissions.get(matchId) ?? {};
    const isChallenger = userId === room.challengerId;
    if (isChallenger) {
      buffer.challenger = {
        skillId: payload.skillId,
        action: payload.action,
        state: payload.state,
        difficulty: payload.difficulty,
      };
    } else {
      buffer.opponent = { skillId: payload.skillId, action: payload.action };
    }
    this.pendingSubmissions.set(matchId, buffer);

    // Only one side in → buffer and wait for the other (no resolution, no push).
    if (buffer.challenger === undefined || buffer.opponent === undefined) {
      return { ok: true, waiting: true };
    }

    // BOTH picks are in → resolve exactly ONE exchange. FIXED orientation (TASK-312 seam):
    // challenger pick → `skillId`, opponent pick → `opponentSkillId`. The client-carried
    // authoritative snapshot is the CHALLENGER's `state`/`difficulty`.
    const challenger = buffer.challenger;
    const opponent = buffer.opponent;
    let view: PvpTurnView;
    try {
      view = await this.pvp.challengeTurn(
        room.challengerId,
        {
          opponentId: room.opponentId,
          skillId: challenger.skillId,
          opponentSkillId: opponent.skillId,
          action: challenger.action,
          state: challenger.state,
          difficulty: challenger.difficulty,
        },
        LIVE_RNG,
      );
    } catch {
      // An illegal/unaffordable pick throws the TASK-312 422 downstream. Refuse the turn WITHOUT
      // tearing down the room or the valid slots — the offending player re-submits a legal pick
      // and the buffered picks stay so the round can still resolve (never a silent AI fallback).
      return { ok: false };
    }
    // Consume the buffered round before broadcasting (never resolve the same picks twice).
    this.pendingSubmissions.delete(matchId);
    await this.resolveAndBroadcast(matchId, room, view);
    return { ok: true, waiting: false };
  }

  /**
   * TASK-200 (R-25a-follow3 slice 59) — project the ephemeral `matches` registry into the
   * PUBLIC live-match lobby list. For every in-progress duel, map its `matchId` +
   * participant userIds to `{ matchId, challenger, opponent }` where each side carries the
   * SERVER-resolved non-identifying display name (via the owner-scoped {@link displayNameFor}
   * — the email local-part, NEVER a client-supplied name; invariant 2). Ordered by `matchId`
   * ascending so the e2e can assert a stable snapshot. Read-only projection of the
   * server-authoritative registry — no fight state, no socketId, no per-user secret leaks.
   */
  private async buildLobby(): Promise<LiveMatchSummary[]> {
    const entries = [...this.matches.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Promise.all(
      entries.map(async ([matchId, room]) => ({
        matchId,
        challenger: {
          userId: room.challengerId,
          displayName: await this.displayNameFor(room.challengerId),
        },
        opponent: {
          userId: room.opponentId,
          displayName: await this.displayNameFor(room.opponentId),
        },
      })),
    );
  }

  /**
   * TASK-200 — a socket REQUESTS the current lobby snapshot (an ack). Any AUTHENTICATED
   * socket may call it (an unauthenticated socket was disconnected in {@link handleConnection}
   * before it could message). Reads NO client input; returns the current live-match list so a
   * freshly-mounted `/pvp` page can seed its lobby before the next `matches_changed` push.
   */
  @SubscribeMessage('list_matches')
  async handleListMatches(): Promise<{ matches: LiveMatchSummary[] }> {
    return { matches: await this.buildLobby() };
  }

  /**
   * TASK-201 (R-25a-follow3 slice 60) — a NON-PARTICIPANT socket subscribes to WATCH a live
   * duel turn-by-turn (the lobby already exposes which matches are live; this lets a bystander
   * actually SEE the fight). It:
   *   (a) validates `body.matchId` is a string that IS a CURRENT key of the server-authoritative
   *       `matches` registry — an unknown/ended match returns `{ view: null }`, no join, no crash
   *       (NEVER trust a client-supplied matchId beyond membership in the registry; invariant 2);
   *   (b) REJECTS a PARTICIPANT watching their own match — a duelist already receives the resolved
   *       turns point-to-point via `turn`; the spectator feed is for non-participants only;
   *   (c) joins the socket to the per-match spectator ROOM (`spectatorRoom(matchId)`, a namespaced
   *       key DISTINCT from any participant routing — participants are never in this room, so the
   *       participant `turn` stream stays byte-identical);
   *   (d) returns the CURRENT view (`lastViews.get(matchId) ?? null`) as the ack so the spectator
   *       seeds immediately — `null` before the first turn resolves (client shows a placeholder).
   * Auth is already enforced in {@link handleConnection}. This is the FIRST use of Socket.IO rooms
   * (`socket.join` + `server.to(room).emit`) — every prior push is owner-scoped point-to-point off
   * the `online` presence map; a public spectator room is correct because a live duel is public
   * spectacle (the lobby already exposed it) and the room carries only the server-computed view,
   * no socketId/secret/JWT (invariant 2). Additive: no existing handler/emit changes.
   */
  @SubscribeMessage('watch_match')
  handleWatchMatch(socket: Socket, body: { matchId?: string }): { view: PvpTurnView | null } {
    const userId = socket.data.userId as string | undefined;
    const matchId = body?.matchId;
    if (typeof matchId !== 'string' || matchId.length === 0) {
      return { view: null };
    }
    const room = this.matches.get(matchId);
    if (room === undefined) {
      // Unknown or already-ended match — nothing to watch (do not join).
      return { view: null };
    }
    // A participant already gets `turn` point-to-point; refuse to also make them a spectator.
    if (userId === room.challengerId || userId === room.opponentId) {
      return { view: null };
    }
    socket.join(this.spectatorRoom(matchId));
    return { view: this.lastViews.get(matchId) ?? null };
  }

  /**
   * TASK-201 — a spectator STOPS watching: leave the per-match spectator room. Additive + tiny;
   * a leave for a room the socket is not in is a harmless no-op. (Even without this, a disconnect
   * auto-removes the socket from all rooms — a spectator carries no match state to sweep.)
   */
  @SubscribeMessage('unwatch_match')
  handleUnwatchMatch(socket: Socket, body: { matchId?: string }): { ok: boolean } {
    const matchId = body?.matchId;
    if (typeof matchId === 'string' && matchId.length > 0) {
      socket.leave(this.spectatorRoom(matchId));
    }
    return { ok: true };
  }

  /**
   * TASK-201 — the Socket.IO room key a spectator of `matchId` joins. Namespaced (`spectate:…`)
   * so it can NEVER collide with any other routing — participants are pushed point-to-point off
   * their socketId and are never in this room, which is exactly why the additive `spectator_turn`
   * room emit in {@link handleTurn} cannot touch the participant `turn` stream.
   */
  private spectatorRoom(matchId: string): string {
    return `spectate:${matchId}`;
  }

  /**
   * TASK-200 — re-broadcast the lobby to EVERY connected `/pvp` socket whenever the
   * live-match SET changes (a duel starts in `handleAccept`, ends in `handleTurn`'s terminal
   * branch, or forfeits in `expireForfeit`). A NAMESPACE broadcast is correct here: which
   * matches are live is PUBLIC activity (the only per-match datum is the two public display
   * names — no owner-private secret, no fight state, no socketId), unlike the owner-scoped
   * point-to-point `turn`/`challenged` pushes. Additive: it never alters an existing emit.
   */
  private async broadcastLobby(): Promise<void> {
    this.server.emit('matches_changed', { matches: await this.buildLobby() });
  }

  /**
   * matching `PvpService.listOpponents` so no full email leaks cross-user (invariant 2).
   * Falls back to the raw userId if the user cannot be read (defensive — never throws).
   */
  private async displayNameFor(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true },
    });
    if (user === null) return userId;
    const at = user.email.indexOf('@');
    return at === -1 ? user.email : user.email.slice(0, at);
  }

  private extractToken(socket: Socket): string | undefined {
    const raw = socket.handshake.auth?.token;
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }
}
