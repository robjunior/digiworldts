/**
 * The starter-roster definition (TASK-7, R-3).
 *
 * A PURE data module: the fixed set of Digimon every new player is granted for
 * their first roster. It has NO I/O — no Prisma import, no DB write — on purpose:
 *
 *  - TASK-8's `GET /digimon` consumes this to materialize a player's starters on
 *    their first (empty) read (A-8 — server-authoritative, idempotent, so a fresh
 *    login always sees a non-empty roster without a boot hook or a `ts-node` seed
 *    runner). Keeping the definition side-effect-free means TASK-8 owns the single
 *    write path (behind `PrismaService`, invariant 1) and this file stays trivially
 *    unit-testable and reusable.
 *  - The datastore e2e (digimon.seed.spec.ts) also reads an entry from here and
 *    persists it, proving a starter definition round-trips through the real schema.
 *
 * Why NOT a `prisma db seed` script: that needs a new `ts-node` devDependency for
 * a one-array constant, and the roster is granted on read (TASK-8) rather than at
 * migrate-time — so a runner would be dead weight (A-8). This is the whole seed.
 */

/**
 * The persisted shape of one starter Digimon, MINUS the columns the datastore
 * fills in per owned instance: `id` (cuid), `userId` (the granting player),
 * `createdAt` (default now), and `deletedAt` (soft-delete marker, invariant 2).
 * i.e. exactly the fields a caller must supply to create a `Digimon` row from a
 * starter, on top of the owner. Kept as a hand-written interface (not derived from
 * the generated Prisma type) so this module has zero import surface and the fields
 * TASK-8 must map are explicit and stable.
 *
 * `type` / `element` / `stage` are string unions here for authoring safety and to
 * document the allowed vocabulary, even though the schema stores them as plain
 * `String` (SQLite has no enums — see schema.prisma). The DB does not enforce the
 * set; application code (TASK-8) does where it matters.
 */
export interface StarterDigimon {
  name: string;
  /** Attribute-triangle value. Stored as a plain String column (no DB enum). */
  type: 'Vaccine' | 'Virus' | 'Data' | 'Free';
  /** Elemental affinity. Stored as a plain String column. */
  element: 'Fire' | 'Water' | 'Nature' | 'Electric' | 'Neutral';
  /** Evolution stage. Starters are Rookies. Stored as a plain String column. */
  stage: 'Fresh' | 'In-Training' | 'Rookie' | 'Champion' | 'Ultimate' | 'Mega';
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** Starting level — always 1 for a freshly granted starter (schema default 1). */
  level: number;
}

/**
 * The classic founding trio, one per common attribute/element, all at Rookie stage
 * with modest, deliberately-balanced level-1 stats (no starter is strictly better
 * than another — the totals are equal, only the distribution differs, which keeps
 * the first choice fair and foreshadows the type triangle). These three shipped
 * with R-3 and are kept verbatim so an existing player's expectations don't shift.
 *
 * `as const`: the roster is a fixed definition, never mutated at runtime — freezing
 * it at the type level stops a consumer from accidentally pushing to or editing the
 * shared array.
 */
const FOUNDING_STARTERS = [
  {
    name: 'Agumon',
    type: 'Vaccine',
    element: 'Fire',
    stage: 'Rookie',
    hp: 50,
    atk: 14,
    def: 10,
    spd: 8,
    level: 1,
  },
  {
    name: 'Gabumon',
    type: 'Data',
    element: 'Water',
    stage: 'Rookie',
    hp: 52,
    atk: 11,
    def: 13,
    spd: 6,
    level: 1,
  },
  {
    name: 'Patamon',
    type: 'Data',
    element: 'Neutral',
    stage: 'Rookie',
    hp: 46,
    atk: 12,
    def: 8,
    spd: 16,
    level: 1,
  },
] as const satisfies readonly StarterDigimon[];

/**
 * TASK-190 (R-29 slice 49) — the FIRST batch of canonical first-three-seasons
 * (Adventure / Adventure 02 / Tamers) Digimon added to the LIVE starter catalog so
 * a new player actually SEES real anime species beyond the founding trio (I-17).
 *
 * WHY seeded as pure TS data, not a live fetch (A-172 / A-169 doctrine): digi-api.com
 * is a free, public, KEYLESS reference — its species FIELDS (canonical name, stage,
 * attribute, and stat feel) are transcribed here as static data mirroring the shipped
 * `as const` catalog convention (`CANONICAL_SKILL_NAMES`, `intoOptions`). No network
 * call at runtime → deterministic, no RNG, no parked resource, no boot dependency.
 *
 * Each row is a Rookie at level 1 with totals in the same modest band as the founding
 * trio (≈82) so the newcomers are immediately viewable, fair, and later evolvable
 * exactly like Agumon. Attribute/element are chosen to stay inside the EXISTING
 * `StarterDigimon` unions (no interface change, invariant 5): the batch is transcribed
 * to their canonical anime attributes AND mapped onto an available element affinity —
 * Biyomon (Vaccine/Fire, Adventure), Tentomon (Vaccine/Electric, Adventure), Palmon
 * (Data/Nature, Adventure), Gomamon (Vaccine/Water, Adventure), Veemon (Free/Neutral,
 * Adventure 02). This is a two-way-door DATA add: revert = drop this const from the
 * spread. `battle.ts` / `ENEMY_ROSTER` / `SPAWN_TABLES` / `EVOLUTION_LINES` are
 * BYTE-UNCHANGED — this only grows the pure starter array.
 */
const FIRST_SEASON_STARTERS = [
  {
    name: 'Biyomon',
    type: 'Vaccine',
    element: 'Fire',
    stage: 'Rookie',
    hp: 48,
    atk: 13,
    def: 9,
    spd: 12,
    level: 1,
  },
  {
    name: 'Tentomon',
    type: 'Vaccine',
    element: 'Electric',
    stage: 'Rookie',
    hp: 50,
    atk: 12,
    def: 12,
    spd: 8,
    level: 1,
  },
  {
    name: 'Palmon',
    type: 'Data',
    element: 'Nature',
    stage: 'Rookie',
    hp: 54,
    atk: 11,
    def: 11,
    spd: 6,
    level: 1,
  },
  {
    name: 'Gomamon',
    type: 'Vaccine',
    element: 'Water',
    stage: 'Rookie',
    hp: 52,
    atk: 10,
    def: 12,
    spd: 8,
    level: 1,
  },
  {
    name: 'Veemon',
    type: 'Free',
    element: 'Neutral',
    stage: 'Rookie',
    hp: 49,
    atk: 15,
    def: 9,
    spd: 9,
    level: 1,
  },
] as const satisfies readonly StarterDigimon[];

/**
 * Tamers (anime season 3) protagonist partners, seeded as level-1 Rookie starters so
 * a player finally SEES first-THREE-seasons species in the live roster — closing the
 * unmet Tamers half of R-29's `outcome` ("Adventure, Adventure 02, Tamers"). Same
 * pure-`as const` DATA posture as `FIRST_SEASON_STARTERS` (A-172): canonical anime
 * attributes transcribed, and each mapped onto an AVAILABLE element affinity because
 * the `StarterDigimon` union carries only Fire|Water|Nature|Electric|Neutral (no
 * Wind/Light/Dark) — Guilmon (Virus/Fire, its canonical Fire), Renamon (Data, canonical
 * Light→mapped to the neutral `Neutral` for lack of a Light affinity), Terriermon
 * (Vaccine, canonical Wind→mapped to the closest available `Nature`). All Rookie,
 * level 1, totals 82 (the founding band — fair, immediately viewable, later evolvable).
 * `battle.ts` / `ENEMY_ROSTER` / `SPAWN_TABLES` / `EVOLUTION_LINES` stay BYTE-UNCHANGED
 * (invariant 5) — this only grows the pure starter array; revert = drop from the spread.
 */
const TAMERS_STARTERS = [
  {
    name: 'Guilmon',
    type: 'Virus',
    element: 'Fire',
    stage: 'Rookie',
    hp: 48,
    atk: 15,
    def: 10,
    spd: 9,
    level: 1,
  },
  {
    name: 'Renamon',
    type: 'Data',
    element: 'Neutral',
    stage: 'Rookie',
    hp: 47,
    atk: 13,
    def: 9,
    spd: 13,
    level: 1,
  },
  {
    name: 'Terriermon',
    type: 'Vaccine',
    element: 'Nature',
    stage: 'Rookie',
    hp: 50,
    atk: 12,
    def: 11,
    spd: 9,
    level: 1,
  },
] as const satisfies readonly StarterDigimon[];

/**
 * The exact set TASK-8's `grantStarterRosterIfEmpty` grants on a player's first empty
 * roster read: the founding trio (R-3) followed by the first-3-season batch (R-29,
 * TASK-190). Kept as a single flat `readonly StarterDigimon[]` so every existing
 * consumer (`createMany`, `toOwnedDigimon`, the seed/controller specs that derive
 * their name-set from this array) picks up the new species with zero code change.
 */
export const STARTER_DIGIMON: readonly StarterDigimon[] = [
  ...FOUNDING_STARTERS,
  ...FIRST_SEASON_STARTERS,
  ...TAMERS_STARTERS,
];
