import type { AnimatedElement, RunnerBuilder } from './types';
import { buildDarkRunner } from './dark';
import { buildEarthRunner } from './earth';
import { buildFireRunner } from './fire';
import { buildIceRunner } from './ice';
import { buildLightRunner } from './light';
import { buildLightningRunner } from './electricity';
import { buildNullRunner } from './null';
import { buildPlantRunner } from './plant';
import { buildSteelRunner } from './steel';
import { buildWaterRunner } from './water';
import { buildWindRunner } from './wind';

export const RUNNERS: Record<AnimatedElement, RunnerBuilder> = {
  fire: buildFireRunner,
  water: buildWaterRunner,
  plant: buildPlantRunner,
  ice: buildIceRunner,
  electricity: buildLightningRunner,
  earth: buildEarthRunner,
  steel: buildSteelRunner,
  wind: buildWindRunner,
  light: buildLightRunner,
  dark: buildDarkRunner,
  null: buildNullRunner,
};

export {
  buildDarkRunner,
  buildEarthRunner,
  buildFireRunner,
  buildIceRunner,
  buildLightRunner,
  buildLightningRunner,
  buildNullRunner,
  buildPlantRunner,
  buildSteelRunner,
  buildWaterRunner,
  buildWindRunner,
};
export type { AnimatedElement, RunnerBuilder };
