import type { SkillSeed } from './types.js';
import { FIRE_SKILLS } from './fire.js';
import { FIRE_SIGNATURES } from './fire-signatures.js';
import { WATER_SKILLS } from './water.js';
import { WATER_SIGNATURES } from './water-signatures.js';
import { PLANT_SKILLS } from './plant.js';
import { PLANT_SIGNATURES } from './plant-signatures.js';
import { ICE_SKILLS } from './ice.js';
import { ICE_SIGNATURES } from './ice-signatures.js';
import { ELECTRICITY_SKILLS } from './electricity.js';
import { ELECTRICITY_SIGNATURES } from './electricity-signatures.js';
import { EARTH_SKILLS } from './earth.js';
import { EARTH_SIGNATURES } from './earth-signatures.js';
import { STEEL_SKILLS } from './steel.js';
import { STEEL_SIGNATURES } from './steel-signatures.js';
import { WIND_SKILLS } from './wind.js';
import { LIGHT_SKILLS } from './light.js';
import { LIGHT_SIGNATURES } from './light-signatures.js';
import { DARK_SKILLS } from './dark.js';
import { DARK_SIGNATURES } from './dark-signatures.js';
import { NULL_SKILLS } from './nullelem.js';
import { WIND_SIGNATURES } from './wind-signatures.js';
import { NULL_SIGNATURES } from './null-signatures.js';

export const ALL_SKILL_SEEDS: readonly SkillSeed[] = [
  ...FIRE_SKILLS,
  ...FIRE_SIGNATURES,
  ...WATER_SKILLS,
  ...WATER_SIGNATURES,
  ...PLANT_SKILLS,
  ...PLANT_SIGNATURES,
  ...ICE_SKILLS,
  ...ICE_SIGNATURES,
  ...ELECTRICITY_SKILLS,
  ...ELECTRICITY_SIGNATURES,
  ...EARTH_SKILLS,
  ...EARTH_SIGNATURES,
  ...STEEL_SKILLS,
  ...STEEL_SIGNATURES,
  ...WIND_SKILLS,
  ...WIND_SIGNATURES,
  ...LIGHT_SKILLS,
  ...LIGHT_SIGNATURES,
  ...DARK_SKILLS,
  ...DARK_SIGNATURES,
  ...NULL_SKILLS,
  ...NULL_SIGNATURES,
];

export { FIRE_SKILLS, FIRE_SIGNATURES, WATER_SKILLS, WATER_SIGNATURES, PLANT_SKILLS, ICE_SKILLS, ICE_SIGNATURES, ELECTRICITY_SKILLS,
  EARTH_SKILLS, EARTH_SIGNATURES, STEEL_SKILLS, STEEL_SIGNATURES, WIND_SKILLS, WIND_SIGNATURES, LIGHT_SKILLS, LIGHT_SIGNATURES, DARK_SKILLS, DARK_SIGNATURES, NULL_SKILLS, NULL_SIGNATURES };
export type { SkillSeed, SlotRole } from './types.js';
