/**
 * Nursery / Digitama wire types.
 *
 * The nursery collects "species data" from every wild Digimon the player
 * defeats in PVE. When a species meter reaches 100% the player can hatch a
 * new Rookie of that lineage — a 3-minute egg timer runs before the hatched
 * mon appears on the roster.
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

export type PendingHatchEntry = {
  id: string;
  targetCatalogId: string;
  targetName: string;
  targetStage: Stage | string;
  rookieCatalogId: string;
  rookieName: string;
  rookieDot: string;
  hatchAt: number;
  ready: boolean;
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
  | { ok: true; pending: PendingHatchEntry; rolledCatalogId: string; totalWeight: number }
  | { ok: false; error: 'no-data' | 'no-path' };

export type CollectHatchResponse =
  | { ok: true; monId: string; rookieCatalogId: string; nickname: string }
  | { ok: false; error: 'not-found' | 'not-ready' | 'template-missing' };
