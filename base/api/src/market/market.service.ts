import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { xpForLevel } from '../digimon/training';
import { PrismaService } from '../prisma/prisma.service';
import { PREMIUM_CURRENCY } from '../shop/shop.seed';
import type { MarketListingView, MarketState } from './market.types';
import { toListingView, toOwnedDigimonView } from './market.types';

/**
 * Player-market domain logic (TASK-42, R-10) — the smallest runnable slice of the
 * market fantasy: a seller lists ONE of their OWNED Digimon for a DigiCredits price,
 * every player can see the open listings, and a DIFFERENT player BUYS a listing —
 * DigiCredits transfer seller↔buyer and the Digimon changes hands (`userId`
 * reassignment), audit-logged on BOTH sides, all atomic.
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link ShopService} /
 * {@link PvpService}, copied deliberately): the controller owns HTTP concerns (the
 * routes, the JwtAuthGuard), this owns the rules. It reaches the datastore ONLY
 * through the injected {@link PrismaService} (invariant 1) — nothing bypasses the
 * provider; the listings, the balances, the ledger, and the Digimon rows are all
 * reached here.
 *
 * The BUY is a PAIRED economic mutation (invariant 3, the L-13 template applied to
 * BOTH signs at once): the buyer's balance is DEBITED (findUnique → guard → decrement,
 * the SPEND idiom from {@link ShopService.purchaseForUser}) and the seller's balance
 * is CREDITED (upsert-increment, the EARN idiom from `FarmService.collectForUser` /
 * `AdminService.grantResource`), and TWO append-only {@link AuditLog} rows are written
 * (one per party whose balance moved — the buyer's NEGATIVE delta owner-attributed to
 * the buyer, the seller's POSITIVE delta owner-attributed to the seller, the A-23
 * precedent), ALL inside ONE `$transaction`. Because everything is in one tx, a
 * shortfall / self-buy / stale-listing throw rolls back EVERYTHING: no ownership
 * change, no half-move (a debit without the matching credit, or vice versa), and no
 * orphan audit row. This is the ledger's 5th action (`market-sale`).
 *
 * The `'DigiCredits'` string is imported as {@link PREMIUM_CURRENCY} from the shop
 * seed — the single source of truth (never re-literaled here), so a currency rename is
 * one edit.
 */
@Injectable()
export class MarketService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so a bare `private readonly prisma` injects
  // `undefined` under the gate and the first request 500s. Naming the provider needs
  // no reflected metadata, so it resolves identically under esbuild (tests) and tsc
  // (build). NO other ctor param — the listings, the balances, the ledger, AND the
  // Digimon rows are all reached through this one PrismaService.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Return every OPEN market listing (`GET /api/market`), leak-safe.
   *
   * Reads `status:'open'`, `deletedAt:null` listings, then for each joins the seller
   * (for the display name) and the listed Digimon (for the public combat fields). A
   * listing whose Digimon is now soft-deleted/gone is SKIPPED (there is nothing to
   * meaningfully show or buy — the buy path would 409 anyway), so the roster never
   * shows a phantom offer. Maps each surviving pair via {@link toListingView}, which
   * enforces invariant 2 structurally (only a display name + the Digimon's public
   * fields cross the wire — never `sellerId`/email).
   */
  async getOpenListings(): Promise<MarketListingView[]> {
    const listings = await this.prisma.marketListing.findMany({
      where: { status: 'open', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const views: MarketListingView[] = [];
    for (const listing of listings) {
      const seller = await this.prisma.user.findFirst({
        where: { id: listing.sellerId, deletedAt: null },
      });
      // The listed Digimon must still exist AND still belong to the seller (a soft-
      // deleted or transferred Digimon = a stale listing). Skip rather than show a
      // phantom offer.
      const digimon = await this.prisma.digimon.findFirst({
        where: {
          id: listing.digimonId,
          userId: listing.sellerId,
          deletedAt: null,
        },
      });
      if (seller === null || digimon === null) continue;
      views.push(toListingView(listing, seller, digimon));
    }
    return views;
  }

  /**
   * Create an OPEN listing for `digimonId` at `priceCredits` on behalf of `sellerId`
   * (`POST /api/market/list`).
   *
   * Steps (no `$transaction` — a listing CREATE moves no value; it is invariant-3-free
   * until someone BUYS):
   *  1. Owner-scoped resolve the Digimon (`findFirst({ id, userId: sellerId,
   *     deletedAt: null })`) — a seller may list ONLY their OWN active Digimon
   *     (invariant 2). Not owned / not found → 404 (a generic not-found; no
   *     enumeration hint).
   *  2. Guard `priceCredits >= 1` — a free/negative listing is nonsensical (422). This
   *     re-asserts the DTO's `@Min(1)` at the service boundary so a direct service call
   *     (or a bypassed pipe) is still safe.
   *  3. Guard there is NO existing OPEN listing for that Digimon — a Digimon can be on
   *     the market at most once at a time (422 "That Digimon is already listed."),
   *     otherwise a double-list could let two buyers race for one creature.
   *  4. `create` the listing and return its leak-safe view (the seller is the caller,
   *     so their own display name is fine to echo back).
   */
  async listDigimon(
    sellerId: string,
    digimonId: string,
    priceCredits: number,
  ): Promise<MarketListingView> {
    const digimon = await this.prisma.digimon.findFirst({
      where: { id: digimonId, userId: sellerId, deletedAt: null },
    });
    // Not the caller's Digimon (or gone): a generic 404 (invariant 2 — a seller cannot
    // probe whether some id exists on another account).
    if (digimon === null) {
      throw new NotFoundException('Digimon not found.');
    }

    // Price floor (re-asserts the DTO's @Min(1) at the service boundary).
    if (priceCredits < 1) {
      throw new UnprocessableEntityException('A listing price must be at least 1 DigiCredit.');
    }

    // At most one OPEN listing per Digimon at a time.
    const existing = await this.prisma.marketListing.findFirst({
      where: { digimonId, status: 'open', deletedAt: null },
    });
    if (existing !== null) {
      throw new UnprocessableEntityException('That Digimon is already listed.');
    }

    const seller = await this.prisma.user.findFirst({
      where: { id: sellerId, deletedAt: null },
    });
    // The authenticated caller always resolves (the guard proved the token); this is
    // defensive so `toListingView` always has a seller.
    if (seller === null) {
      throw new NotFoundException('Seller not found.');
    }

    const listing = await this.prisma.marketListing.create({
      data: { sellerId, digimonId, priceCredits, status: 'open' },
    });

    return toListingView(listing, seller, digimon);
  }

  /**
   * Buy an open listing (`POST /api/market/:listingId/buy`) — the paired economic
   * mutation, ALL in ONE `$transaction` (invariant 3, the L-13 template applied to
   * BOTH signs at once). Because everything runs in one tx, any guard throw rolls back
   * EVERYTHING: no ownership change, no half-move, no orphan audit row.
   *
   * Steps (all with `tx.*`, never `this.prisma.*`):
   *  1. Resolve the listing `findFirst({ id, status:'open', deletedAt:null })` — none
   *     → 404 (unknown or already-sold-in-a-race, though the sold case usually surfaces
   *     as the 409 below; a genuinely unknown id is a 404).
   *  2. Self-buy guard (`listing.sellerId === buyerId`) → 422 BEFORE any balance read —
   *     a seller buying their own listing is meaningless (it would credit and debit the
   *     same account and pointlessly reassign the Digimon to itself).
   *  3. Re-read the listed Digimon owner-scoped to the SELLER (`findFirst({ id,
   *     userId: sellerId, deletedAt:null })`) — moved/gone since listing → 409 (a stale
   *     listing; the Digimon no longer belongs to the seller, so the sale cannot honor
   *     what was advertised).
   *  4. BUYER DEBIT (the SPEND half — findUnique → guard → decrement, from
   *     {@link ShopService.purchaseForUser}). `null || amount < priceCredits` → 422
   *     "Requires N DigiCredits." A pure debit NEVER upserts (it must prove a coverable
   *     row exists first). Capture buyerBefore/buyerAfter.
   *  5. SELLER CREDIT (the EARN half — upsert-increment on `userId_resource`, from
   *     `FarmService.collectForUser`). A seller who never opened the shop has no
   *     DigiCredits row yet, so the upsert CREATEs it at `priceCredits`; an existing row
   *     is incremented. Capture sellerBefore/sellerAfter.
   *  6. TRANSFER OWNERSHIP: `tx.digimon.update({ id: digimonId }, { userId: buyerId })`
   *     — the Digimon changes hands (visible on the buyer's EXISTING GET /digimon).
   *  7. CLOSE THE LISTING: flip `status` → 'sold' so it leaves GET /api/market and a
   *     second buy 404/409s (it is no longer 'open').
   *  8. TWO AuditLog rows (invariant 3): action 'market-sale', entity 'MarketListing',
   *     entityId = listingId, resource DigiCredits — the buyer's NEGATIVE-delta row
   *     (userId = buyerId) and the seller's POSITIVE-delta row (userId = sellerId,
   *     owner-attributed to the party whose balance moved — the A-23 precedent).
   *  9. Return {@link MarketState} { balance: buyerAfter, digimon: the acquired
   *     OwnedDigimon }.
   */
  async buyListing(buyerId: string, listingId: string): Promise<MarketState> {
    return this.prisma.$transaction(async (tx) => {
      // Resolve the OPEN listing. An unknown id (or one already soft-deleted) is a 404.
      const listing = await tx.marketListing.findFirst({
        where: { id: listingId, status: 'open', deletedAt: null },
      });
      if (listing === null) {
        throw new NotFoundException('Listing not found.');
      }

      // Self-buy guard — BEFORE any balance read (a seller cannot buy their own
      // listing; it would credit and debit one account and reassign the Digimon to
      // itself). 422: well-formed + authorized but not a valid action.
      if (listing.sellerId === buyerId) {
        throw new UnprocessableEntityException('You cannot buy your own listing.');
      }

      // Re-read the listed Digimon owner-scoped to the SELLER. If it moved/gone since
      // the listing was created, the listing is STALE → 409 Conflict (the sale cannot
      // honor what was advertised). Everything rolls back.
      const digimon = await tx.digimon.findFirst({
        where: {
          id: listing.digimonId,
          userId: listing.sellerId,
          deletedAt: null,
        },
      });
      if (digimon === null) {
        throw new ConflictException('This listing is no longer available.');
      }

      // ── BUYER DEBIT (the SPEND half — invariant 3, from ShopService.purchaseForUser)
      // Read the buyer's DigiCredits balance by the `@@unique([userId, resource])`
      // accessor `userId_resource`. Owner-scoped by `buyerId` (invariant 2).
      const buyerBalance = await tx.resourceBalance.findUnique({
        where: {
          userId_resource: { userId: buyerId, resource: PREMIUM_CURRENCY },
        },
      });
      // Sufficiency guard. A pure DEBIT must NOT upsert (that would create a row at a
      // negative/absent balance): no row OR too little → 422 with a player-facing
      // reason. Throwing inside the tx rolls back EVERYTHING (no partial move).
      if (buyerBalance === null || buyerBalance.amount < listing.priceCredits) {
        throw new UnprocessableEntityException(
          `Requires ${listing.priceCredits} ${PREMIUM_CURRENCY}.`,
        );
      }
      const buyerBefore = buyerBalance.amount;
      const buyerAfter = buyerBefore - listing.priceCredits;
      await tx.resourceBalance.update({
        where: {
          userId_resource: { userId: buyerId, resource: PREMIUM_CURRENCY },
        },
        data: { amount: { decrement: listing.priceCredits } },
      });

      // ── SELLER CREDIT (the EARN half — upsert-increment, from
      // FarmService.collectForUser). A seller who never opened the shop has no
      // DigiCredits row yet, so `upsert` CREATEs it at `priceCredits`; an existing row
      // is incremented. Capture before/after for the seller's audit row — a create
      // means a before of 0.
      const sellerBalanceBefore = await tx.resourceBalance.findUnique({
        where: {
          userId_resource: {
            userId: listing.sellerId,
            resource: PREMIUM_CURRENCY,
          },
        },
      });
      const sellerBefore = sellerBalanceBefore?.amount ?? 0;
      const sellerAfter = sellerBefore + listing.priceCredits;
      await tx.resourceBalance.upsert({
        where: {
          userId_resource: {
            userId: listing.sellerId,
            resource: PREMIUM_CURRENCY,
          },
        },
        create: {
          userId: listing.sellerId,
          resource: PREMIUM_CURRENCY,
          amount: listing.priceCredits,
        },
        update: { amount: { increment: listing.priceCredits } },
      });

      // ── TRANSFER OWNERSHIP: the Digimon changes hands. `where: { id }` safely drops
      // the owner filter — the same-tx read above already proved it belongs to the
      // seller, and SQLite's serialized writer means no interleaving write changed it.
      const acquired = await tx.digimon.update({
        where: { id: listing.digimonId },
        data: { userId: buyerId },
      });

      // ── CLOSE THE LISTING: flip to 'sold' so it leaves GET /api/market and a second
      // buy 404s (it is no longer 'open').
      await tx.marketListing.update({
        where: { id: listing.id },
        data: { status: 'sold' },
      });

      // ── TWO AuditLog rows (invariant 3), owner-attributed to the party whose balance
      // moved (A-23). Both reference the same listing; the buyer's delta is NEGATIVE (a
      // spend), the seller's POSITIVE (an earn). Append-only — the ledger's 5th action.
      await tx.auditLog.create({
        data: {
          userId: buyerId,
          action: 'market-sale',
          entity: 'MarketListing',
          entityId: listing.id,
          resource: PREMIUM_CURRENCY,
          amountBefore: buyerBefore,
          amountAfter: buyerAfter,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: listing.sellerId,
          action: 'market-sale',
          entity: 'MarketListing',
          entityId: listing.id,
          resource: PREMIUM_CURRENCY,
          amountBefore: sellerBefore,
          amountAfter: sellerAfter,
        },
      });

      return {
        balance: buyerAfter,
        // Project the acquired Digimon into the public OwnedDigimon shape (the buyer
        // now owns it). `xpToNext` uses the SAME pure curve the digimon module uses,
        // so there is no drift (D-8 #1).
        digimon: toOwnedDigimonView(acquired, xpForLevel(acquired.level)),
      };
    });
  }
}
