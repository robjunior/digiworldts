import type { Digimon, MarketListing, User } from '@prisma/client';
import type { OwnedDigimon } from '../digimon/digimon.types';

/**
 * Public shapes of the `/api/market` API (TASK-42, R-10) — the player market.
 *
 * The house feature-contract idiom (P-1, the DIRECT analogue of `pvp.types.ts` /
 * `shop.types.ts`): the response shapes live here as explicit exported interfaces
 * other code depends on, and a pure projector maps a persisted row → the leak-safe
 * view. TASK-43's `/market` SPA will keep a LOCAL mirror of these (no cross-workspace
 * import — D-8 #1). Per invariant 5 fields may be ADDED later but an existing one must
 * not change meaning or vanish.
 *
 * INVARIANT 2 (leak-safe projection) is the load-bearing rule here: a listing is
 * created by one player but READ by everyone, so the view must NEVER carry the
 * seller's private identity. `MarketListingView` exposes ONLY a non-identifying
 * `sellerDisplayName` (the seller's email LOCAL PART, mirroring the pvp opponent
 * idiom) — never `sellerId`, the full email, or `passwordHash` — plus the listed
 * Digimon's PUBLIC combat fields (so a buyer can judge what they are buying). The
 * projector below is where that guarantee is enforced, structurally: it reads only
 * whitelisted fields, so a future column added to `MarketListing`/`Digimon` cannot
 * accidentally leak through the wire.
 */

/**
 * One OPEN market listing as returned to any signed-in player (`GET /api/market`).
 *
 * `id` is the listing's cuid (the buyer POSTs `/api/market/<id>/buy`). `priceCredits`
 * is the DigiCredits asking price. `sellerDisplayName` is the seller's email LOCAL
 * PART only (invariant 2 — never `sellerId`/email). `digimon` carries the listed
 * creature's PUBLIC combat fields (the same public subset `GET /digimon` exposes,
 * minus the per-owner projection fields like `xpToNext` a listing does not need) so a
 * shopper can evaluate the offer without the server leaking internal/owner columns.
 */
export interface MarketListingView {
  id: string;
  priceCredits: number;
  /** The seller's email LOCAL PART only — never `sellerId`/email (invariant 2). */
  sellerDisplayName: string;
  /** The listed Digimon's public combat fields. */
  digimon: {
    name: string;
    type: string;
    element: string;
    stage: string;
    level: number;
    hp: number;
    atk: number;
    def: number;
    spd: number;
  };
}

/**
 * The `POST /api/market/<id>/buy` response — the buyer's fresh state after a
 * successful purchase: their now-DEBITED DigiCredits `balance` and the `digimon` they
 * just ACQUIRED (in the same {@link OwnedDigimon} shape `GET /digimon` returns, so the
 * client can slot the new creature straight into its roster). Reuses `OwnedDigimon`
 * (imported, not restated — D-8 #1: one wire shape for an owned Digimon).
 */
export interface MarketState {
  balance: number;
  digimon?: OwnedDigimon;
}

/**
 * The email's LOCAL PART (everything before the first `@`) — the non-identifying
 * display name (invariant 2). Identical to the pvp module's `localPart`; kept local so
 * this module has no cross-feature coupling. Falls back to the whole string only if
 * there is no `@` (a malformed stored email, which registration prevents).
 */
function localPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

/**
 * Project a persisted {@link MarketListing} + its {@link User seller} + the listed
 * {@link Digimon} → the leak-safe {@link MarketListingView}. This is where invariant 2
 * is enforced structurally: only whitelisted, non-identifying fields cross the wire
 * (the seller's identity is reduced to a display name; the Digimon's owner/internal
 * columns are dropped). A pure function — no I/O.
 */
export function toListingView(
  listing: MarketListing,
  seller: User,
  digimon: Digimon,
): MarketListingView {
  return {
    id: listing.id,
    priceCredits: listing.priceCredits,
    sellerDisplayName: localPart(seller.email),
    digimon: {
      name: digimon.name,
      type: digimon.type,
      element: digimon.element,
      stage: digimon.stage,
      level: digimon.level,
      hp: digimon.hp,
      atk: digimon.atk,
      def: digimon.def,
      spd: digimon.spd,
    },
  };
}

/**
 * Project a persisted {@link Digimon} row → the public {@link OwnedDigimon} shape the
 * buy response returns. Mirrors `DigimonService.toOwnedDigimon` (which is private to
 * that service), restated here so the market can return an acquired Digimon in the
 * exact wire shape `GET /digimon` uses WITHOUT reaching across the service boundary.
 * `xpToNext` is the derived next-level threshold; the market imports the same pure
 * curve the digimon module uses so there is no drift (D-8 #1).
 */
export function toOwnedDigimonView(digimon: Digimon, xpToNext: number): OwnedDigimon {
  return {
    id: digimon.id,
    name: digimon.name,
    type: digimon.type,
    element: digimon.element,
    stage: digimon.stage,
    hp: digimon.hp,
    atk: digimon.atk,
    def: digimon.def,
    spd: digimon.spd,
    level: digimon.level,
    xp: digimon.xp,
    xpToNext,
    dataFire: digimon.dataFire,
  };
}
