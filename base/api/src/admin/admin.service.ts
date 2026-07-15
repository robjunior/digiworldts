import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { GrantDto } from './dto/grant.dto';
import type { GrantResult } from './admin.types';

/**
 * Admin-panel domain logic (TASK-34, R-14) — the FIRST admin-tier write path. This
 * slice ships ONE observable admin write: CREDIT a target player's spendable
 * resource balance, audit-logged. It establishes the admin write-path R-14's later
 * actions (adjust/ban/distribute — carved children) reuse.
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link ShopService} /
 * {@link FarmService}, copied deliberately): the controller owns HTTP concerns (the
 * route, the AdminGuard), this owns the rules. It reaches the datastore ONLY through
 * the injected {@link PrismaService} (invariant 1) — nothing bypasses the provider.
 *
 * The GRANT is a CREDIT + audit, ALL in ONE `$transaction` (invariant 3): it is the
 * L-13 economic-mutation template's 4th occurrence (a standalone-route CREDIT, this
 * time to a TARGET player resolved by an admin, after collect's CREDIT + evolve's
 * folded DEBIT + purchase's standalone DEBIT). The CREDIT block is copied from
 * {@link FarmService.collectForUser} — upsert-INCREMENT (a grant may create the
 * (user, resource) pair, like collect, unlike a debit which must findUnique →
 * guard → decrement) — and the audit-row shape likewise. Because the balance moved
 * belongs to the TARGET, the audit row is OWNER-ATTRIBUTED TO THE TARGET (A-23), so
 * it appears on the target's ledger; recording the acting admin's id in the ledger
 * is a carved R-14 child (out of scope here).
 */
@Injectable()
export class AdminService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike
  // the production `nest build` via tsc), so a bare `private readonly prisma`
  // injects `undefined` under the gate and the first grant 500s. Naming the provider
  // needs no reflected metadata, so it resolves identically under esbuild (tests)
  // and tsc (build). NO other ctor param — both the balance AND the audit ledger are
  // reached through this one PrismaService. The e2e's 200 assertion guards a
  // regression here.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Grant `dto.amount` of `dto.resource` to the player identified by
   * `dto.targetEmail` (TASK-34, R-14) — the admin CREDIT. Returns the target's fresh
   * balance for that resource.
   *
   * `adminId` is the id of the acting admin (from `request.user.id`, the guard having
   * already proven `role === 'admin'`). It is accepted for the audit trail / future
   * admin-attribution child, but the balance and the target-attributed audit row are
   * keyed on the TARGET (A-23).
   *
   * Steps:
   *  1. Resolve the target by email owner-scoped + soft-delete-aware
   *     (`findFirst({ where: { email, deletedAt: null } })`) → a 404 BEFORE the tx if
   *     no such ACTIVE user (invariant 2: a soft-deleted user is treated as absent;
   *     the email is normalized to lowercase to match how accounts are stored). No
   *     point opening a transaction to credit a non-existent target.
   *  2. Inside ONE `$transaction` (all with `tx.*`, the L-13 CREDIT template copied
   *     from collect):
   *     a. READ the target's current balance for the resource by the composite
   *        `@@unique([userId, resource])` accessor `userId_resource` (a wrong name is
   *        a tsc error); `amountBefore = existing?.amount ?? 0`,
   *        `amountAfter = amountBefore + amount`.
   *     b. UPSERT-INCREMENT the balance (a CREDIT may CREATE the (user, resource)
   *        pair — like collect, unlike a debit which must findUnique → guard →
   *        decrement). Two grants to the same pair sum onto the ONE row.
   *     c. APPEND the invariant-3 audit row (action `'admin-grant'`, entity `'User'`,
   *        entityId the target id, the resource, `amountBefore`→`amountAfter` — a
   *        POSITIVE delta), OWNER-ATTRIBUTED TO THE TARGET (A-23), inside the SAME tx
   *        so the credit and its ledger row commit together or not at all.
   *  3. Return `{ targetEmail, resource, balance: amountAfter }`.
   */
  async grantResource(adminId: string, dto: GrantDto): Promise<GrantResult> {
    // `adminId` is intentionally unused in THIS slice's persistence (the target,
    // not the admin, owns the moved balance + audit row — A-23); referencing it
    // documents that the acting admin is known here for a future attribution child.
    void adminId;

    const normalizedEmail = dto.targetEmail.toLowerCase();
    const resource = dto.resource;
    const amount = dto.amount;

    // Resolve the target BEFORE the tx: an unknown/soft-deleted target is a 404, no
    // transaction needed. Owner-scoped + soft-delete-aware (invariant 2).
    const target = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });
    if (target === null) {
      // Generic not-found (no enumeration hint beyond the status): the target email
      // does not name an active account.
      throw new NotFoundException('Target user not found.');
    }
    const targetId = target.id;

    let amountAfter = amount;

    await this.prisma.$transaction(async (tx) => {
      // ── The CREDIT half (invariant 3) — copied from FarmService.collectForUser ──
      // Read the target's current balance for the resource. The composite
      // `@@unique([userId, resource])` accessor is `userId_resource` (a wrong name is
      // a tsc error). A first-ever grant for this (target, resource) has no row yet,
      // so amountBefore defaults to 0.
      const existing = await tx.resourceBalance.findUnique({
        where: { userId_resource: { userId: targetId, resource } },
      });
      const amountBefore = existing?.amount ?? 0;
      amountAfter = amountBefore + amount;

      // UPSERT-INCREMENT (a CREDIT — like collect, unlike a debit): create the
      // (target, resource) row at `amount` if it does not exist, else add `amount`
      // to the existing total. Two grants sum onto the ONE row (the composite unique
      // guarantees never two rows for the pair).
      await tx.resourceBalance.upsert({
        where: { userId_resource: { userId: targetId, resource } },
        create: { userId: targetId, resource, amount },
        update: { amount: { increment: amount } },
      });

      // Invariant 3: append the immutable audit row for THIS economic mutation,
      // inside the SAME transaction as the credit (atomic — both commit or neither).
      // OWNER-ATTRIBUTED TO THE TARGET (A-23), so it appears on the target's ledger.
      // Append-only: the ledger's 4th action ('admin-grant'), never updated/deleted.
      // A POSITIVE delta (amountAfter > amountBefore) — a credit, like collect.
      await tx.auditLog.create({
        data: {
          userId: targetId,
          action: 'admin-grant',
          entity: 'User',
          entityId: targetId,
          resource,
          amountBefore,
          amountAfter,
        },
      });
    });

    return {
      targetEmail: normalizedEmail,
      resource,
      balance: amountAfter,
    };
  }
}
