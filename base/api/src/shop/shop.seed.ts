/**
 * The premium-shop catalog + currency constants (TASK-26, R-13) — the ethical-
 * monetization pillar's pure data.
 *
 * A PURE data module: the fixed set of quality-of-life items a signed-in player
 * may BUY, plus the premium-currency name and the one-time starter grant. It has
 * NO I/O — no Prisma import, no DB write — on purpose, exactly like
 * `farm.seed.ts`'s `STARTING_BUILDINGS` (its DIRECT analogue) and
 * `digimon.seed.ts`'s starter roster:
 *
 *  - `ShopService.getShopForUser` projects `SHOP_ITEMS` → the public catalog and
 *    grants `STARTER_DIGICREDITS` on a player's FIRST shop visit (the same
 *    server-authoritative, idempotent grant idiom `grantStartingBuildingsIfEmpty`
 *    established — a real, payment-free EARN so DigiCredits exist to spend today,
 *    A-17). `purchaseForUser` resolves the named `itemId` here to find its price +
 *    effect. Keeping the definition side-effect-free means the service owns the
 *    single write path (behind `PrismaService`, invariant 1) and this file stays
 *    trivially unit-testable and reusable (its shape is asserted by the e2e).
 *
 * Why the effect params (`kind`/`targetResource`/`capacityDelta`) live HERE and
 * are NOT projected onto the wire (see shop.types.ts): they are SERVER-only —
 * the client needs only `priceCredits` to render a Buy button, and leaking the
 * mechanism (which building, how much capacity) would both bloat the contract and
 * couple the SPA to server internals. `ShopItemView` deliberately drops them.
 *
 * Why NOT a `prisma db seed` script: identical rationale to `farm.seed.ts` — that
 * needs a `ts-node` devDependency for a one-array constant, and the currency is
 * granted on read (not at migrate-time), so a runner would be dead weight. This is
 * the whole seed.
 */

/**
 * Which KIND of effect a shop item applies when bought. Stored nowhere in the DB
 * (the effect is applied immediately in the purchase transaction, not persisted as
 * a "kind" column); this string union is the authoring-time source of the allowed
 * vocabulary the purchase's effect switch matches on. Kept a plain string union
 * (SQLite has no enums, and the effect is never a stored column) so this module
 * has zero import surface.
 *
 * R-13 shipped the ONE kind `'building_capacity'` (extra Meat-Farm storage) so the
 * loop is observable end-to-end; the union GROWS ADDITIVELY (that is the whole point
 * of a string union with an exhaustive effect switch — a new member is a compile-time
 * gap the purchase's `if (kind === …)` narrowing forces you to fill). TASK-38 (R-13b)
 * adds `'premium_time'`: a TIMED PvE/production boost (a `durationHours` of
 * PREMIUM_PRODUCTION_MULTIPLIER× farm production) that provably NEVER touches PvP.
 * More kinds (cosmetics, extra roster slots) are later R-13b child slices.
 */
export type ShopItemKind =
  | 'building_capacity'
  | 'premium_time'
  | 'inventory_item'
  | 'inventory_slot';

/**
 * One catalog item. The public projection ({@link ShopItemView}) keeps only the
 * first four fields (`id`/`name`/`description`/`priceCredits`); the trailing three
 * (`kind`/`targetResource`/`capacityDelta`) are SERVER-only effect parameters the
 * purchase transaction reads to apply the QoL effect — they never cross the API
 * boundary (the same leak-proofing discipline `BuildingView` applies to a
 * `Building`'s internal columns).
 */
export interface ShopItem {
  /** Stable slug — the `itemId` a purchase names (e.g. 'meat-storage-1'). */
  id: string;
  /** Player-facing name (e.g. 'Meat Silo Expansion'). */
  name: string;
  /** One player-facing line describing what the item does. */
  description: string;
  /** Whole DigiCredits the purchase DEBITS (Int-valued — the house whole-unit idiom). */
  priceCredits: number;
  /** Which effect the purchase applies. */
  kind: ShopItemKind;
  /**
   * SERVER-only effect param (for `building_capacity`): WHICH building to grow,
   * identified by the resource it produces — 'Meat' selects the Meat Farm. Never
   * on the wire.
   */
  targetResource: string;
  /**
   * SERVER-only effect param: whole units added by the purchase.
   *  - For `building_capacity`: units added to the target building's `capacity`.
   *  - For `inventory_slot` (TASK-281, R-31b child iv): the number of EXTRA distinct-
   *    stack inventory SLOTS granted — incremented onto the buyer's
   *    `User.inventorySlotBonus`, raising their effective cap
   *    (`INVENTORY_SLOT_CAP + bonus`). Reusing this EXISTING field (rather than adding
   *    a new one) because "a positive integer delta this purchase grants" is exactly
   *    its shape — the ShopItem interface stays byte-unchanged (invariant 5).
   * Never on the wire (dropped by {@link ShopItemView}).
   */
  capacityDelta: number;
  /**
   * SERVER-only effect param (for `premium_time`): how many hours of Premium Time this
   * purchase GRANTS. The purchase extends the buyer's `User.premiumUntil` by this many
   * hours (from `max(now, existing premiumUntil)` — stacking EXTENDS, never resets).
   * OPTIONAL because it applies only to the `premium_time` kind (a `building_capacity`
   * item leaves it undefined); never on the wire (dropped by {@link ShopItemView}).
   */
  durationHours?: number;
  /**
   * SERVER-only effect param (for `inventory_item` used via `POST /api/inventory/use`,
   * TASK-263, R-31b child i): the whole XP boost GRANTED to a player-chosen owned Digimon
   * when ONE unit of this consumable is USED. Read ONLY by the inventory USE path (the
   * shop-purchase GRANT ignores it — owning the stack is one thing, spending it is
   * another). OPTIONAL because it applies only to a USABLE consumable (a
   * `building_capacity`/`premium_time` item leaves it undefined, and an
   * `inventory_item` that bears none is not usable → the USE path 422s); never on the
   * wire (dropped by {@link ShopItemView}). Additive to the literal (invariant 5) —
   * back-compat with the shipped `heal-chip-1` row, whose slug is UNCHANGED.
   */
  xpBoost?: number;
}

/**
 * The farm-production multiplier a player earns while their Premium Time is active
 * (TASK-38, R-13b) — the SINGLE source of truth for the boost's magnitude. `+50%`
 * production while `now < User.premiumUntil`; `1` (no boost) otherwise. FarmService
 * threads this through the shared {@link computeProduced} so the READ and COLLECT
 * paths agree by construction (no drift). The web client mirrors this value
 * DISPLAY-ONLY (D-8 #1 — one canonical number, restated, never a second authority).
 *
 * `as const` so the literal type is `1.5` (not `number`) — the boost magnitude is a
 * fixed contract, not a mutable runtime value. Deliberately NOT applied anywhere near
 * `pvp/` or `battle.ts`: the boost is PvE/QoL only and NEVER touches ranked combat
 * (the ethical-monetization guarantee — spend premium currency on QoL, never
 * pay-to-win). A low-confidence balancing default (A-32), cheap to revise (two-way).
 */
export const PREMIUM_PRODUCTION_MULTIPLIER = 1.5 as const;

/**
 * The premium currency's name — a NEW free-form `resource` value on the EXISTING
 * `ResourceBalance` / `AuditLog` models (the SAME string-typed `resource` column
 * "Meat"/"Bits"/"Data" already use; SQLite has no enums — A-16 #1). Because it is
 * just another `resource` string, adding DigiCredits needs NO enum and NO
 * migration (invariant 5): the balance row is keyed by the `@@unique([userId,
 * resource])` composite exactly as a Meat balance is.
 *
 * `as const` so the literal type is `'DigiCredits'` (not `string`) — a spend or a
 * balance read that passes a mistyped currency is a compile error, not a silent
 * miss against a non-existent row.
 */
export const PREMIUM_CURRENCY = 'DigiCredits' as const;

/**
 * The one-time starter DigiCredits every player is granted on their FIRST shop
 * visit (A-17) — a real, payment-free EARN so the premium currency has a source
 * TODAY (real-money top-up is R-13b, which PARKS on a missing payment key). Chosen
 * comfortably ABOVE the price of the one shippable item ({@link SHOP_ITEMS}'s
 * `meat-storage-1` = 100) so the SUCCESS path (grant → afford → buy → effect) is
 * demonstrable on a brand-new account with a single `POST /api/shop/purchase`, and
 * with headroom left over (300 − 100 = 200) to prove the balance actually dropped
 * rather than merely emptied to zero. A low-confidence default (A-17), trivially
 * revised later (door: two-way).
 */
export const STARTER_DIGICREDITS = 300;

/**
 * The shop catalog — a FROZEN pure definition (mirrors `STARTING_BUILDINGS`),
 * never mutated at runtime. `readonly [...] as const` freezes it at the type level
 * so a consumer cannot accidentally push to or edit the shared array.
 *
 * This slice ships exactly ONE quality-of-life item so the economy is observable
 * end-to-end (grant → buy → the Meat Farm's `capacity` rises, visible on
 * `/farm`); more kinds are R-13b. Its price (100) is deliberately ≤
 * {@link STARTER_DIGICREDITS} (300) so a fresh account can afford it immediately,
 * and its `capacityDelta` (480) is a sensible one-third bump over the Meat Farm's
 * seeded 1440 cap (`farm.seed.ts`) — a low-confidence balancing default (A-16),
 * cheap to revise. All whole integers (the house Int idiom).
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: 'meat-storage-1',
    name: 'Meat Silo Expansion',
    description: 'Increase your Meat Farm storage capacity.',
    priceCredits: 100,
    kind: 'building_capacity',
    targetResource: 'Meat',
    capacityDelta: 480,
  },
  {
    // TASK-38 (R-13b): the FIRST timed QoL boost. Buying it EXTENDS the player's
    // `User.premiumUntil` by `durationHours` (from max(now, existing) — stacking
    // extends, not resets) and, while active, multiplies ALL farm production by
    // PREMIUM_PRODUCTION_MULTIPLIER (+50%). A PvE/production bonus that NEVER touches
    // PvP. Priced (250) at or slightly under the 300 starter so a fresh account can
    // observe the SUCCESS path with one purchase (300 − 250 = 50 headroom left, so the
    // debit is provably not a mere empty-to-zero). `targetResource`/`capacityDelta` are
    // inert for this kind (the `premium_time` branch ignores them — they exist only
    // because the `building_capacity` kind requires them); `durationHours: 168` = 7 days.
    id: 'premium-time-7d',
    name: 'Premium Time (7 days)',
    description: '+50% farm production for 7 days. Never affects PvP.',
    priceCredits: 250,
    kind: 'premium_time',
    targetResource: '',
    capacityDelta: 0,
    durationHours: 168,
  },
  {
    // TASK-262 (R-31b): the FIRST `'inventory_item'` catalog entry — a consumable
    // chip a player BUYS to OWN a stack of. Buying it debits DigiCredits (the same
    // audited purchase `$transaction`, invariant 3) and grants ONE unit via an
    // upsert-increment into the `InventoryItem` table; `GET /api/inventory` reads the
    // owned stacks and the Inventory rail renders them.
    //
    // TASK-263 (R-31b child i): the item is now USABLE. Reframed from a battle-heal
    // chip (a no-op: there is NO persisted current-HP — `Digimon.hp` is a static max
    // stat, combat HP is engine-internal, A-245) to a "Training Chip": USING one unit
    // via `POST /api/inventory/use` consumes it AND grants `xpBoost` XP to a
    // player-chosen owned Digimon through the shipped pure `applyXpGain` (a real,
    // roster-observable effect — XP rises, may tick a level). The slug `heal-chip-1`
    // is UNCHANGED for back-compat with already-granted rows; only the display
    // name/description are reframed and `xpBoost` is added (additive, invariant 5).
    // `xpBoost` (40) is the ONLY effect param the USE path reads; `targetResource`/
    // `capacityDelta` stay INERT for this kind (the `inventory_item` grant/use branches
    // read neither). Priced (40) comfortably under the 300 starter so a fresh account
    // can buy it (and re-buy to prove the upsert-increment) with headroom.
    id: 'heal-chip-1',
    name: 'Training Chip',
    description:
      'A consumable chip. Use it on one of your Digimon to grant it a training XP boost.',
    priceCredits: 40,
    kind: 'inventory_item',
    targetResource: '',
    capacityDelta: 0,
    xpBoost: 40,
  },
  {
    // TASK-281 (R-31b child iv): the FIRST `'inventory_slot'` catalog entry — a
    // purchasable INVENTORY SLOT-EXPANSION. Where the space-limited inventory cap is
    // otherwise a flat, unchangeable 10 (INVENTORY_SLOT_CAP), buying this debits
    // DigiCredits (the same audited purchase `$transaction`, invariant 3) and
    // increments the buyer's `User.inventorySlotBonus` by `capacityDelta`, raising
    // their effective distinct-stack cap (INVENTORY_SLOT_CAP + bonus). A full
    // inventory (10/10) that was refused an 11th distinct stack can, after this buy,
    // hold an 11th; the Inventory rail's `Slots N / <cap>` line shows the raised cap
    // (it already renders the server `slotCap`, so the higher number surfaces for
    // free — no web change). `capacityDelta` (1) is the slots granted per purchase
    // (A-263 — buy again to stack more slots via the additive increment); priced (150)
    // comfortably under the 300 starter so a fresh account can observe the SUCCESS
    // path with headroom left (300 − 150 = 150). `targetResource` is inert for this
    // kind (the grant branch reads only `capacityDelta`). All whole integers.
    id: 'slot-expansion-1',
    name: 'Inventory Slot Expansion',
    description: 'Permanently add one inventory slot so you can hold more distinct items.',
    priceCredits: 150,
    kind: 'inventory_slot',
    targetResource: '',
    capacityDelta: 1,
  },
] as const;
