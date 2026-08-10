import type { SkillSeed } from './types.js';
import { FIRE_SKILLS } from './fire.js';
import { WATER_SKILLS } from './water.js';
import { WATER_SIGNATURES } from './water-signatures.js';
import { PLANT_SKILLS } from './plant.js';
import { PLANT_SIGNATURES } from './plant-signatures.js';
import { ICE_SKILLS } from './ice.js';
import { ICE_SIGNATURES } from './ice-signatures.js';
import { ELECTRICITY_SKILLS } from './electricity.js';
import { ELECTRICITY_SIGNATURES } from './electricity-signatures.js';
import { EARTH_SKILLS } from './earth.js';
import { STEEL_SKILLS } from './steel.js';
import { WIND_SKILLS } from './wind.js';
import { LIGHT_SKILLS } from './light.js';
import { DARK_SKILLS } from './dark.js';
import { NULL_SKILLS } from './nullelem.js';

export const ALL_SKILL_SEEDS: readonly SkillSeed[] = [
  ...FIRE_SKILLS,
  ...WATER_SKILLS,
  ...WATER_SIGNATURES,
  ...PLANT_SKILLS,
  ...PLANT_SIGNATURES,
  ...ICE_SKILLS,
  ...ICE_SIGNATURES,
  ...ELECTRICITY_SKILLS,
  ...ELECTRICITY_SIGNATURES,
  ...EARTH_SKILLS,
  ...STEEL_SKILLS,
  ...WIND_SKILLS,
  ...LIGHT_SKILLS,
  ...DARK_SKILLS,
  ...NULL_SKILLS,
];

export { FIRE_SKILLS, WATER_SKILLS, WATER_SIGNATURES, PLANT_SKILLS, ICE_SKILLS, ICE_SIGNATURES, ELECTRICITY_SKILLS,
  EARTH_SKILLS, STEEL_SKILLS, WIND_SKILLS, LIGHT_SKILLS, DARK_SKILLS, NULL_SKILLS };
export type { SkillSeed, SlotRole } from './types.js';
