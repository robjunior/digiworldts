import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ActivityFeed } from './activity.types';

/**
 * Activity-feed domain logic (TASK-248, R-31 — the SIXTH & LAST dual-sidebar rail).
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link DailyService}, copied
 * deliberately): the controller owns HTTP concerns (route, guard), this owns the read.
 * It reaches the datastore ONLY through the injected {@link PrismaService} (invariant 1).
 *
 * This is a READ-ONLY projection of the append-only `AuditLog` ledger — the data ALREADY
 * exists on disk (every economic mutation writes an owner-scoped audit row via the L-13
 * template) but no endpoint read it back until now. There is NO `$transaction`, NO
 * `create`, NO write of any kind: reading the immutable ledger moves no spendable value,
 * so invariant 3 is UNTRIGGERED. Owner-scoping (`WHERE userId`) is the caller's verified
 * JWT `sub` threaded down from the controller — never a client-supplied id (invariant 2).
 */
@Injectable()
export class ActivityService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so a bare `private readonly prisma` injects
  // `undefined` under the gate and the first request 500s.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * `GET /activity` — the caller's most recent audited actions, newest first, capped at
   * 20 (a sidebar rail shows a short recent feed, not the whole ledger). Read-only; uses
   * the `@@index([userId])` owner-scoped read path. The `createdAt` `DateTime` is
   * serialized to an ISO string so the plain wire body carries no `Date` object.
   */
  async getFeedForUser(userId: string): Promise<ActivityFeed> {
    const rows = await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        resource: r.resource,
        amountBefore: r.amountBefore,
        amountAfter: r.amountAfter,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
