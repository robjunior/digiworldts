import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DAILY_REWARDS,
  advanceStreak,
  claimedOnSameDay,
} from './daily.rewards';
import type { DailyClaimResult, DailyState } from './daily.types';

/**
 * Daily-reward domain logic (TASK-235, R-40) — the server-authoritative daily claim
 * loop, the load-bearing value-moving core of R-40 (the Dashboard slide widget is the
 * carved follow-on that RENDERS what this ships).
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link FarmService} /
 * {@link AdminService}, copied deliberately): the controller owns HTTP concerns (route,
 * guard), this owns the rules. It reaches the datastore ONLY through the injected
 * {@link PrismaService} (invariant 1). The pure streak/reward rules live in
 * `daily.rewards.ts` (unit-tested without a DB); this service only wires them to the
 * User row + the balance/ledger.
 *
 * A CLAIM is a CREDIT + audit, ALL in ONE `$transaction` (invariant 3) — the L-13
 * economic-mutation template's upsert-INCREMENT branch (copied from
 * {@link FarmService.collectForUser} / {@link AdminService.grantResource}): a grant may
 * create the (user, resource) pair. The once-per-UTC-calendar-day gate + the streak
 * advance on the `User` row run in the SAME tx as the credit + the audit row, so the
 * whole "refuse-if-claimed-today → advance → credit → audit" unit commits together or
 * not at all.
 */
@Injectable()
export class DailyService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so a bare `private readonly prisma` injects
  // `undefined` under the gate and the first request 500s. NO other ctor param — both
  // the User row AND the balance/ledger are reached through this one PrismaService.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * `GET /daily` — read the player's current streak state (read-only, no mutation).
   * `claimedToday` is derived server-side from the stored `lastDailyClaimedAt` vs `now`.
   */
  async getStateForUser(userId: string): Promise<DailyState> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (user === null) {
      // The JWT vouched for a principal that is no longer an active account.
      throw new NotFoundException('User not found.');
    }
    const streakDay = user.dailyStreakDay;
    return {
      streakDay,
      claimedToday: claimedOnSameDay(user.lastDailyClaimedAt, new Date()),
      nextDay: advanceStreak(streakDay),
      rewards: DAILY_REWARDS,
    };
  }

  /**
   * `POST /daily/claim` — grant the current streak-day's reward and advance the streak,
   * once per UTC calendar day (TASK-235, R-40). The whole value move is ONE
   * `$transaction`: re-read the user INSIDE the tx, refuse if already claimed today,
   * else advance + credit + audit + stamp — all atomic (invariant 3).
   */
  async claimForUser(userId: string): Promise<DailyClaimResult> {
    // Snapshot `now` ONCE so the same-day gate and the stored timestamp agree.
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read the target row owner-scoped + soft-delete-aware INSIDE the tx (the
      // authoritative state — never a value read before the tx opened). On SQLite the
      // writer is serialized, so a concurrent double-fire observes the first commit and
      // re-derives its own outcome (the same-day gate below then refuses it).
      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
      });
      if (user === null) {
        throw new NotFoundException('User not found.');
      }

      // The once-per-UTC-calendar-day gate (server-authoritative from the stored
      // timestamp, never a client-supplied day — invariant 2). A second claim the same
      // day throws → the tx rolls back → NO credit, NO audit row, streak UNCHANGED.
      if (claimedOnSameDay(user.lastDailyClaimedAt, now)) {
        throw new ConflictException('Daily reward already claimed today.');
      }

      // Advance the streak (0→1, 1..6→+1, 7→1) and pick the day's reward.
      const newDay = advanceStreak(user.dailyStreakDay);
      const reward = DAILY_REWARDS[newDay - 1];
      const { resource, amount } = reward;

      // ── The CREDIT half (invariant 3) — the L-13 upsert-INCREMENT template. Read the
      // current balance for the resource via the composite `@@unique([userId, resource])`
      // accessor `userId_resource` (a wrong name is a tsc error); a first-ever grant has
      // no row yet, so amountBefore defaults to 0.
      const existing = await tx.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource } },
      });
      const amountBefore = existing?.amount ?? 0;
      const amountAfter = amountBefore + amount;

      // UPSERT-INCREMENT (a CREDIT — like collect/grant, unlike a debit): create the
      // (user, resource) row at `amount` if absent, else add `amount` to the total.
      await tx.resourceBalance.upsert({
        where: { userId_resource: { userId, resource } },
        create: { userId, resource, amount },
        update: { amount: { increment: amount } },
      });

      // Append the immutable audit row for THIS economic mutation, in the SAME tx as the
      // credit (atomic). Append-only: the ledger's 'daily-claim' action, a POSITIVE
      // delta, owner-attributed to the claiming player. entity/entityId are plain Strings
      // ('User' + the userId), matching the ledger's cross-kind convention.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'daily-claim',
          entity: 'User',
          entityId: userId,
          resource,
          amountBefore,
          amountAfter,
        },
      });

      // Advance the streak state + stamp the claim instant on the User row, in the SAME
      // tx (so the "claimed today" gate is now armed for the rest of the day).
      await tx.user.update({
        where: { id: userId },
        data: { dailyStreakDay: newDay, lastDailyClaimedAt: now },
      });

      const claimResult: DailyClaimResult = {
        streakDay: newDay,
        claimedToday: true,
        nextDay: advanceStreak(newDay),
        rewards: DAILY_REWARDS,
        granted: reward,
      };
      return claimResult;
    });

    return result;
  }
}
