/**
 * Nursery / Digitama wire types.
 *
 * Flow (post-pen refactor):
 *   1. Player accumulates species data by defeating wild mons in PVE.
 *   2. When a species meter reaches 100% they place an egg (Digitama)
 *      in the hatchery. A ~3-minute incubation timer runs.
 *   3. On collect the egg hatches into a **Baby** in the nursery pen
 *      (NOT a Rookie in the roster — that used to be the flow).
 *   4. The pen server-authoritatively auto-progresses each mon:
 *        Baby -> In-Training -> Rookie
 *      based on `nursery_evolve_at` timers. Meat feeds + pets applied
 *      during Baby/In-Training raise mood but do not shorten the timer
 *      (kept simple; may be a follow-up dial).
 *   5. When a mon reaches Rookie, the player clicks Graduate to move it
 *      into the regular roster (status='resting'). This mirrors the
 *      previous "Hatch!" collect action semantically.
 */

import type { Stage } from './digimon.js';

export type SpeciesTier = 'common' | 'uncommon' | 'rare';

export type SpeciesDataEntry = {
  catalogId: string;
  name: string;
  stage: Stage | string;
  dot: string;
  percent: number;
  kills: number;
  updatedAt: number;
};

export type SpeciesAwardWire = {
  catalogId: string;
  tier: SpeciesTier;
  percent: number;
  kills: number;
};

/**
 * A digitama incubating in the hatchery. Collecting when ready creates a
 * **Baby** in the nursery pen (the field name `babyCatalogId` reflects this
 * post-refactor semantic — even though the egg is themed after the eventual
 * target Rookie species, what pops out first is the Baby form).
 *
 * `targetCatalogId` still tracks the FINAL Rookie the chain will produce,
 * for hatchery-list display ("Egg — Rookie X lineage").
 */
export type PendingHatchEntry = {
  id: string;
  targetCatalogId: string;
  targetName: string;
  targetStage: Stage | string;
  babyCatalogId: string;
  babyName: string;
  babyDot: string;
  hatchAt: number;
  ready: boolean;
  /** True for a mystery egg: the pushed species is hidden until it hatches. The
   *  server still knows the rolled target internally (needed to hatch), but the
   *  view returns masked fields so the UI/pen show a mystery egg. */
  mystery: boolean;
};

export type NurseryDataResponse = {
  entries: SpeciesDataEntry[];
  totalWeight: number;
};

export type NurseryPendingResponse = {
  pending: PendingHatchEntry[];
};

export type HatchStartResponse =
  | { ok: true; pending: PendingHatchEntry }
  | { ok: false; error: 'not-enough-data' | 'template-missing' | 'no-path' | 'unknown' };

export type MixHatchResponse =
  | { ok: true; pending: PendingHatchEntry; totalWeight: number; hasMystery: boolean }
  | { ok: false; error: 'no-data' | 'no-path' };

/**
 * Collecting a ready egg creates a **Baby** in the nursery pen (NOT a Rookie
 * in the roster). To move the eventual Rookie into the roster the client
 * calls POST /api/nursery/graduate/:monId once the pen mon reaches Rookie.
 */
export type CollectHatchResponse =
  | { ok: true; monId: string; babyCatalogId: string; nickname: string }
  | { ok: false; error: 'not-found' | 'not-ready' | 'template-missing' };

// -----------------------------------------------------------------------------
// Nursery pen — Baby + In-Training + graduated Rookie hanging out in a scene.
// -----------------------------------------------------------------------------

export type NurseryPenStage = 'Baby' | 'In-Training' | 'Rookie';

/**
 * Locked-in evolution chain assigned at egg-collect time so the pen can
 * pre-render the next stages and time each hop server-side.
 */
export type NurseryChain = {
  babyCatalogId: string;
  inTrainingCatalogId: string;
  rookieCatalogId: string;
};

/**
 * A Baby, In-Training, or ready-to-graduate Rookie in the player's pen.
 *
 * The server auto-advances `stage` on read once `evolveAt` passes:
 *   - stage='Baby': evolveAt = collectAt + BABY_STAGE_MS
 *   - stage='In-Training': evolveAt = advanceAt + IN_TRAINING_STAGE_MS
 *   - stage='Rookie': evolveAt = 0 (ready to graduate to roster)
 *
 * `catalogId` swaps to the corresponding chain entry whenever the stage
 * advances, so the client can just look up the new dot texture.
 */
export type NurseryPenMon = {
  id: string;
  catalogId: string;
  nickname: string;
  stage: NurseryPenStage;
  dot: string;
  mood: number;
  petsToday: number;
  canPet: boolean;
  evolveAt: number;
  chain: NurseryChain;
};

export type NurseryView = {
  penMons: NurseryPenMon[];
  meat: number;
  maxPetsPerDay: number;
  petMoodDelta: number;
  feedMoodDelta: number;
  feedMeatCost: number;
  babyStageMs: number;
  inTrainingStageMs: number;
};

export type PetPenMonResponse = {
  ok: true;
  mood: number;
  petsToday: number;
  maxPetsPerDay: number;
};

export type FeedPenMonResponse = {
  ok: true;
  mood: number;
  meat: number;
};

export type GraduateResponse =
  | { ok: true; monId: string; nickname: string; rookieCatalogId: string }
  | { ok: false; error: 'not-found' | 'not-ready' | 'template-missing' };
