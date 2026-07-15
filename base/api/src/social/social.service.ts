import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FriendView, FriendsResponse } from './social.types';
import { toFriendView } from './social.types';

/**
 * Social domain logic (TASK-44, R-11) — the smallest runnable slice of the social
 * fantasy: a player sends a friend request to another player BY EMAIL, the other player
 * ACCEPTS, and both then see each other in a friends list WITH a `lastSeenAt`-derived
 * `online` indicator ("connect with another real player and see they're around").
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link MarketService} /
 * {@link PvpService}, copied deliberately): the controller owns HTTP concerns (routes,
 * the JwtAuthGuard), this owns the rules. It reaches the datastore ONLY through the
 * injected {@link PrismaService} (invariant 1) — the friendship edges + the counterpart
 * users are read/written only here.
 *
 * Invariant 3 is NOT triggered: a friendship moves NO spendable value (no
 * `ResourceBalance`, no `AuditLog` row) — social edges are DOMAIN state, the same family
 * as `mmr`/`xp`/`premiumUntil`. Invariant 2 is load-bearing: every read is owner-scoped
 * by `request.user.id`, and the friends view leaks only a display name + an online
 * boolean (via {@link toFriendView}), never the counterpart's id/email. Every edge
 * carries a `deletedAt` soft-delete marker and all reads filter `deletedAt: null`.
 */
@Injectable()
export class SocialService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes`, so a bare
  // `private readonly prisma` injects `undefined` under the gate and the first request
  // 500s. Naming the provider needs no reflected metadata, so it resolves identically
  // under esbuild (tests) and tsc (build). NO other ctor param — the edges + the
  // counterpart users are all reached through this one PrismaService.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Send a friend request from `requesterId` to the player identified by `email`
   * (`POST /api/social/friends/request`).
   *
   * Steps (no `$transaction` — a request creation moves no value; invariant 3 untouched):
   *  1. Resolve the target owner-scoped-agnostic but soft-delete-aware
   *     (`findFirst({ email: lowercased, deletedAt: null })`) — none → generic 404 (a
   *     requester cannot probe which emails exist beyond the status; invariant 2 hygiene).
   *  2. Self-request guard (`target.id === requesterId`) → 422 BEFORE any write — you
   *     cannot befriend yourself.
   *  3. Duplicate-edge guard in EITHER direction: an existing non-soft-deleted edge with
   *     the pair in EITHER order (A→B or B→A) → 409. The `@@unique([requesterId,
   *     addresseeId])` only forbids the SAME direction at the DB level, so the reverse
   *     direction is checked here in application code (a composite unique on an unordered
   *     pair is not expressible in the schema).
   *  4. `create` the edge (status defaults 'pending') and return its leak-safe
   *     {@link FriendView} — the counterpart here is the TARGET (the requester already
   *     knows who they asked).
   */
  async sendRequest(requesterId: string, email: string): Promise<FriendView> {
    const normalizedEmail = email.toLowerCase();
    const target = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });
    // Generic 404 — no enumeration hint (invariant 2).
    if (target === null) {
      throw new NotFoundException('No player with that email.');
    }

    // Self-request guard — 422 (well-formed + authorized but not a valid action).
    if (target.id === requesterId) {
      throw new UnprocessableEntityException('You cannot send a friend request to yourself.');
    }

    // Duplicate in EITHER direction → 409 (a request/friendship already exists between
    // the two, regardless of who initiated it).
    const existing = await this.prisma.friendship.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { requesterId, addresseeId: target.id },
          { requesterId: target.id, addresseeId: requesterId },
        ],
      },
    });
    if (existing !== null) {
      throw new ConflictException('A friend request already exists between you and that player.');
    }

    const edge = await this.prisma.friendship.create({
      data: { requesterId, addresseeId: target.id, status: 'pending' },
    });

    // The counterpart of this view is the target the requester just asked. A fresh
    // request is never "online-relevant" to display, but we derive it uniformly from the
    // target's lastSeenAt so the shape is consistent.
    return toFriendView(edge.id, target, Date.now());
  }

  /**
   * Accept a pending friend request (`POST /api/social/friends/:id/accept`).
   *
   * Steps (no `$transaction` — a single-row status flip, invariant 3 untouched):
   *  1. Resolve the edge by `id` scoped `{ deletedAt: null, status: 'pending' }` — none
   *     → 404 (unknown, already-accepted, or soft-deleted; a generic not-found).
   *  2. Authorization: ONLY the `addresseeId` may accept (the player the request was
   *     sent TO). A requester (or any other player) accepting their own/someone else's
   *     request → 403 (mirrors AdminGuard's 401-vs-403 distinction — the caller is
   *     authenticated but not authorized for THIS action), enforced at the service
   *     boundary. Nothing is mutated on a 403.
   *  3. Flip `status` → 'accepted' via an absolute `update`, and return the updated
   *     {@link FriendView} — the counterpart here is the REQUESTER (the addressee is the
   *     caller; the friend they just gained is the requester).
   */
  async acceptRequest(userId: string, edgeId: string): Promise<FriendView> {
    const edge = await this.prisma.friendship.findFirst({
      where: { id: edgeId, deletedAt: null, status: 'pending' },
    });
    // Generic 404 for an unknown / non-pending / soft-deleted edge.
    if (edge === null) {
      throw new NotFoundException('Friend request not found.');
    }

    // Only the addressee may accept — a 403 (authenticated but not authorized), NOTHING
    // mutated. A requester cannot accept their own request; a third party cannot accept
    // someone else's.
    if (edge.addresseeId !== userId) {
      throw new ForbiddenException('Only the addressee can accept this request.');
    }

    const accepted = await this.prisma.friendship.update({
      where: { id: edge.id },
      data: { status: 'accepted' },
    });

    // The counterpart the addressee just befriended is the REQUESTER. Resolve them for
    // the view (defensively soft-delete-aware; the RESTRICT FK means they exist).
    const requester = await this.prisma.user.findFirst({
      where: { id: accepted.requesterId, deletedAt: null },
    });
    if (requester === null) {
      throw new NotFoundException('Requester not found.');
    }
    return toFriendView(accepted.id, requester, Date.now());
  }

  /**
   * The caller's friends + incoming requests (`GET /api/social/friends`).
   *
   *  - `friends` = all `accepted`, non-soft-deleted edges where the caller is EITHER the
   *    `requesterId` OR the `addresseeId` — mapped to the COUNTERPART (the other party of
   *    each edge), leak-safe, with the `online` flag derived from the counterpart's
   *    `lastSeenAt`.
   *  - `incoming` = all `pending`, non-soft-deleted edges where the caller is the
   *    `addresseeId` (requests awaiting THEIR accept) — each mapped to the requester as
   *    counterpart the same leak-safe way.
   *
   * Owner-scoped throughout (invariant 2); a single `now` snapshot is taken so every
   * `online` in the response is measured against one instant. The counterpart users are
   * batched-resolved per edge (the friends slice is small; a join-free per-edge read
   * mirrors the market's read style and keeps invariant 1 — everything through Prisma).
   */
  async getFriends(userId: string): Promise<FriendsResponse> {
    const now = Date.now();

    // ── ACCEPTED friends: the caller on EITHER side of the edge. ──
    const acceptedEdges = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        deletedAt: null,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const friends: FriendView[] = [];
    for (const edge of acceptedEdges) {
      // The counterpart is whichever side is NOT the caller.
      const counterpartId = edge.requesterId === userId ? edge.addresseeId : edge.requesterId;
      const counterpart = await this.resolveUser(counterpartId);
      if (counterpart === null) continue; // a soft-deleted counterpart drops out
      friends.push(toFriendView(edge.id, counterpart, now));
    }

    // ── INCOMING pending requests: the caller is the addressee. ──
    const incomingEdges = await this.prisma.friendship.findMany({
      where: { status: 'pending', deletedAt: null, addresseeId: userId },
      orderBy: { createdAt: 'desc' },
    });

    const incoming: FriendView[] = [];
    for (const edge of incomingEdges) {
      const requester = await this.resolveUser(edge.requesterId);
      if (requester === null) continue;
      incoming.push(toFriendView(edge.id, requester, now));
    }

    return { friends, incoming };
  }

  /** Owner-agnostic, soft-delete-aware user lookup for a counterpart projection. */
  private resolveUser(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }
}
