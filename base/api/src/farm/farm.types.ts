/**
 * Public shape of the `GET /farm` response (TASK-15, R-4).
 *
 * The FOURTH public API contract in the project (after `HealthStatus`, the
 * `/auth/*` types, and `OwnedDigimon`), written — like them — as an explicit
 * exported interface other code depends on. `GET /farm`'s 200 body is a
 * {@link FarmState}: the signed-in player's owned buildings, each with a
 * computed-on-read `produced` amount. TASK-16's SPA keeps a LOCAL mirror of these
 * types (no cross-workspace import — the house rule D-8 #1, same as the web
 * `/health`, `/auth`, and `/digimon` consumers mirror their server types); keep
 * the two in lock-step. Per invariant 5 (additive/versioned, never a silent break)
 * fields may be ADDED in later slices but an existing one must not change meaning
 * or vanish.
 *
 * Why the response is an OBJECT `{ buildings }` and NOT a bare `BuildingView[]`
 * (unlike `GET /digimon`'s array — A-11): the resource economy will soon grow more
 * top-level, non-per-building facts the SPA needs alongside the buildings — a
 * global resource balance, a server `now` clock the client can reconcile against.
 * Wrapping the list in an object lets those be ADDED as sibling fields without
 * breaking the shape (invariant 5); a top-level array would have no additive room.
 *
 * R-4b (TASK-22) realizes exactly that additive room: it adds the `balance` sibling
 * (the player's spendable per-resource totals) alongside the byte-unchanged
 * `buildings` array. `GET /farm`'s existing `buildings[]` shape does NOT change —
 * `balance` is a NEW sibling field only, so no released contract breaks (invariant
 * 5). This is why A-11 wrapped the list in an object in the first place.
 */

/**
 * One owned building as returned to the client (TASK-15, R-4).
 *
 * These are exactly the PUBLIC fields — the service projects each `Building` row
 * to this shape so internal/owner columns (`userId`, `lastCollectedAt`,
 * `createdAt`, `deletedAt`) NEVER cross the API boundary (the same discipline the
 * auth surface applies to `passwordHash` and the roster applies to its owner
 * columns). `id` is the per-instance cuid (stable identity a later
 * upgrade/collect slice keys on); `kind` / `resource` are strings here because the
 * datastore stores them as plain `String` (SQLite has no enums — see
 * schema.prisma / farm.seed.ts), the allowed vocabulary documented on the seed's
 * `BuildingKind` / `ResourceType` unions.
 *
 * `produced` is DERIVED, not a stored column: the resource this building has
 * accrued since its accrual clock (`lastCollectedAt`) was last set, computed ON
 * READ as `clamp(floor(ratePerHour · elapsedHours), 0, capacity)`. It is what
 * makes production accrue while the player is offline and be credited on return
 * with no background job. `ratePerHour` / `capacity` are re-exposed so the SPA can
 * render "produced / capacity" and the accrual rate; the raw `lastCollectedAt` the
 * math reads is deliberately NOT exposed (an internal clock, dropped after use).
 */
export interface BuildingView {
  id: string;
  /** Which building — "MeatFarm" | "BitBank" | "DataCenter". */
  kind: string;
  /** The resource it produces — "Meat" | "Bits" | "Data". */
  resource: string;
  /** Whole resource units produced per real-time hour. */
  ratePerHour: number;
  /** The storage cap `produced` clamps to (offline accrual stops once full). */
  capacity: number;
  /**
   * Computed-on-read accrued amount:
   * `clamp(floor(ratePerHour · (now − lastCollectedAt) / 3600s), 0, capacity)`.
   * Read-only — collecting/banking it (which resets the clock) is R-4b.
   */
  produced: number;
}

/**
 * One spendable per-resource balance as returned to the client (TASK-22, R-4b).
 *
 * The public projection of a `ResourceBalance` row: exactly the two fields the SPA
 * needs to render a running total ("Meat: 120"), with the internal/owner columns
 * (`id`, `userId`, `createdAt`, `updatedAt`, `deletedAt`) DROPPED at the API
 * boundary — the same discipline `BuildingView` applies to `Building`'s internal
 * columns and the auth surface applies to `passwordHash`. `resource` is a plain
 * string here for the same reason `BuildingView.resource` is: the datastore stores
 * it as a plain `String` (SQLite has no enums); the allowed vocabulary ("Meat" |
 * "Bits" | "Data") is documented on `farm.seed.ts`'s `ResourceType` union.
 *
 * `amount` is the whole spendable units currently banked for this resource (Int in
 * the DB — the house whole-unit idiom). It is a PERSISTED running total, not a
 * computed-on-read figure like `BuildingView.produced`: `POST /farm/collect` banks
 * production INTO it and it survives across reads/reloads (that persistence is
 * exactly what the collect e2e asserts by re-reading `GET /farm`).
 */
export interface ResourceBalanceView {
  /** The resource this balance is denominated in — "Meat" | "Bits" | "Data". */
  resource: string;
  /** The whole spendable units currently banked for this resource. */
  amount: number;
}

/**
 * The `GET /farm` 200 body — the signed-in player's farm/city state.
 *
 * A wrapper object (not a bare array) so future economy facts can be added as
 * sibling fields additively (invariant 5). As of R-4b it carries two siblings:
 *
 *  - `buildings` — the owned buildings, each with its computed-on-read `produced`
 *    accrual (byte-unchanged since R-4; invariant 5).
 *  - `balance` — NEW in R-4b (TASK-22): the player's spendable per-resource
 *    totals. `POST /farm/collect` banks each ready building's accrued buffer into
 *    the matching `ResourceBalance` and this reflects the running totals. A player
 *    with nothing banked yet gets an empty array (no balance row exists until the
 *    first non-zero collect creates one — see `FarmService.getFarmForUser`).
 */
export interface FarmState {
  buildings: BuildingView[];
  /**
   * The player's spendable per-resource balances (one entry per resource that has
   * a non-soft-deleted balance row). NEW sibling in R-4b — purely additive; the
   * `buildings[]` shape above is unchanged (invariant 5).
   */
  balance: ResourceBalanceView[];
}
