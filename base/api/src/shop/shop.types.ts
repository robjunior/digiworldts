import type { ShopItem } from './shop.seed';

/**
 * Public shape of the `/api/shop` responses (TASK-26, R-13).
 *
 * The FIFTH public API contract in the project (after `HealthStatus`, the
 * `/auth/*` types, `OwnedDigimon`, and `FarmState`), written — like them — as an
 * explicit exported interface. Both `GET /api/shop` and `POST /api/shop/purchase`
 * return a {@link ShopState}: the catalog + the player's DigiCredits balance.
 * TASK-27's SPA keeps a LOCAL mirror of these types (no cross-workspace import —
 * the house rule D-8 #1, same as every other web consumer mirrors its server
 * types); keep the two in lock-step. Per invariant 5 (additive, never a silent
 * break) fields may be ADDED in later slices but an existing one must not change
 * meaning or vanish.
 *
 * Why the response is an OBJECT `{ items, balance }` and not a bare array: the shop
 * naturally carries two top-level facts (the catalog AND the spendable balance),
 * and later slices (R-13b) will add more (owned-cosmetics, a premium-time flag) —
 * a wrapper object lets those be ADDED as sibling fields without breaking the shape
 * (invariant 5). This mirrors why `FarmState` wraps its `buildings`/`balance`.
 */

/**
 * One catalog item as returned to the client.
 *
 * Exactly the PUBLIC fields — {@link ShopService.toItemView} projects each
 * {@link ShopItem} to this shape so the SERVER-only effect params
 * (`kind`/`targetResource`/`capacityDelta`) NEVER cross the API boundary (the same
 * leak-proofing discipline `BuildingView` applies to a `Building`'s internal
 * columns and the auth surface applies to `passwordHash`). The client needs only
 * `priceCredits` to render a Buy button; how the effect works is a server concern.
 * If a new public field is ever added it must be added here deliberately
 * (invariant 5: additive).
 */
export interface ShopItemView {
  /** Stable slug — the `itemId` a purchase names. */
  id: string;
  /** Player-facing name. */
  name: string;
  /** One player-facing line describing the item. */
  description: string;
  /** Whole DigiCredits a purchase of this item costs. */
  priceCredits: number;
}

/**
 * The `/api/shop` 200 body — the signed-in player's shop state.
 *
 * A wrapper object (not a bare array) so future economy facts can be added as
 * sibling fields additively (invariant 5). As of R-13 it carries two siblings:
 *
 *  - `items` — the catalog (projected — the effect params are dropped).
 *  - `balance` — the player's DigiCredits balance (the `DigiCredits`
 *    `ResourceBalance.amount`). A brand-new player is granted the A-17 starter on
 *    their first `GET /api/shop`, so this is `STARTER_DIGICREDITS` on first read,
 *    then drops by an item's price on each successful purchase. `0` if somehow no
 *    row exists (defensive — the grant makes that unreachable for a normal flow).
 */
export interface ShopState {
  items: ShopItemView[];
  /** The player's spendable DigiCredits balance (Int; whole units). */
  balance: number;
  /**
   * When the player's PREMIUM TIME is active (TASK-38, R-13b), the ISO-8601 instant it
   * expires; `null` when no premium is active (never bought, or expired). A NEW sibling
   * field — purely ADDITIVE (invariant 5): a client that ignores it sees the byte-
   * unchanged `items`/`balance`. Projected as a string (not a `Date`) because it crosses
   * the JSON API boundary. While it is a future instant, the farm's `produced` numbers
   * on `GET /api/farm` carry the +50% boost (the observable payoff); a client renders it
   * as a "Premium active until …" indicator (TASK-39's UI slice). It is a PvE/QoL flag —
   * it NEVER affects PvP.
   */
  premiumUntil: string | null;
}

/**
 * Project a catalog {@link ShopItem} to its public {@link ShopItemView}, dropping
 * the SERVER-only effect params (`kind`/`targetResource`/`capacityDelta`). A pure
 * module-level function (no `this`, no I/O) so it is trivially reused wherever the
 * catalog is exposed and cannot accidentally leak an effect param. Kept here beside
 * the contract it produces (the mirror of `FarmService.toResourceBalanceView`,
 * though this one is pure/static since the catalog is a frozen constant).
 */
export function toItemView(item: ShopItem): ShopItemView {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    priceCredits: item.priceCredits,
  };
}
