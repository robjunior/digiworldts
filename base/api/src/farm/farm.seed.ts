/**
 * The starting-building definition (TASK-14, R-4).
 *
 * A PURE data module: the fixed set of buildings every new player is granted for
 * their first farm/city. It has NO I/O — no Prisma import, no DB write — on
 * purpose, exactly like `digimon.seed.ts` (its direct analogue, the starter
 * roster):
 *
 *  - TASK-15's `GET /farm` consumes this to materialize a player's starting
 *    buildings on their first (empty) read (the same server-authoritative,
 *    idempotent grant A-8 established for the starter roster — a fresh login always
 *    sees a non-empty farm without a boot hook or a `ts-node` seed runner). Keeping
 *    the definition side-effect-free means TASK-15 owns the single write path
 *    (behind `PrismaService`, invariant 1) and this file stays trivially
 *    unit-testable and reusable.
 *  - The datastore e2e (farm.seed.spec.ts) also reads an entry from here and
 *    persists it, proving a starting-building definition round-trips through the
 *    real schema.
 *
 * Why NOT a `prisma db seed` script: that needs a new `ts-node` devDependency for
 * a one-array constant, and the buildings are granted on read (TASK-15) rather
 * than at migrate-time — so a runner would be dead weight (A-8). This is the whole
 * seed.
 */

/**
 * Which building this is. Stored as a plain `String` column in the DB (SQLite has
 * no enums — see schema.prisma); this string union is the authoring-time source of
 * the allowed vocabulary and the type TASK-15 maps. Kept hand-written (not derived
 * from the generated Prisma type) so this module has zero import surface.
 */
export type BuildingKind = 'MeatFarm' | 'BitBank' | 'DataCenter';

/**
 * The resource type a building produces. Also a plain `String` column in the DB;
 * this union documents/enforces the set at authoring time only.
 */
export type ResourceType = 'Meat' | 'Bits' | 'Data';

/**
 * The persisted shape of one starting building, MINUS the columns the datastore
 * fills in per owned instance: `id` (cuid), `userId` (the granting player),
 * `lastCollectedAt` (default now — the accrual clock starts on grant), `createdAt`
 * (default now), and `deletedAt` (soft-delete marker, invariant 2). i.e. exactly
 * the fields a caller must supply to create a `Building` row from a starting
 * definition, on top of the owner.
 *
 * `kind` / `resource` are string unions here for authoring safety and to document
 * the allowed vocabulary, even though the schema stores them as plain `String`.
 * The DB does not enforce the set; application code (TASK-15) does where it
 * matters.
 */
export interface StartingBuilding {
  /** Which building. Stored as a plain String column (no DB enum). */
  kind: BuildingKind;
  /** The resource it produces. Stored as a plain String column. */
  resource: ResourceType;
  /** Whole resource units produced per real-time hour. */
  ratePerHour: number;
  /** The storage cap the accrued buffer clamps to. */
  capacity: number;
}

/**
 * The three starting buildings, one per resource type. Numbers are simple whole
 * integers chosen so each caps in roughly a day of offline production
 * (capacity ≈ ratePerHour · 24), giving a sensible "collect once a day" cadence
 * without any balancing pass — a low-confidence default (A-11) that is cheap to
 * revise later. TASK-15 grants this exact trio on a player's first empty farm read.
 *
 * `readonly` + `as const`: the set is a fixed definition, never mutated at runtime
 * — freezing it at the type level stops a consumer from accidentally pushing to or
 * editing the shared array (mirrors STARTER_DIGIMON).
 */
export const STARTING_BUILDINGS: readonly StartingBuilding[] = [
  { kind: 'MeatFarm', resource: 'Meat', ratePerHour: 60, capacity: 1440 },
  { kind: 'BitBank', resource: 'Bits', ratePerHour: 30, capacity: 720 },
  { kind: 'DataCenter', resource: 'Data', ratePerHour: 12, capacity: 288 },
] as const;
