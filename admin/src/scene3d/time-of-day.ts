import type { TimeOfDayConfig, TimePhase } from '@digiworld/shared/weather';
import * as THREE from 'three';

const DEFAULT_CYCLE_DURATION_MS = 24 * 60 * 1000;
const FIRST_PHASE: TimePhase = 'dawn';

export type PhasePreset = {
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientTint: number;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  exposureMultiplier: number;
};

type CycleSample = { currentPhase: TimePhase; nextPhase: TimePhase; blend: number };
type PhaseResult = { current: PhasePreset; nextPhase: TimePhase; blend: number };

class UnreachablePhaseError extends Error {
  constructor(value: never) {
    super(`Unhandled time-of-day value: ${String(value)}`);
    this.name = 'UnreachablePhaseError';
  }
}

// Canonical day/night phase cycle order.
export const TIME_PHASE_ORDER = [
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
  'evening',
  'night',
  'midnight',
] as const satisfies readonly TimePhase[];

// Physically-plausible lighting presets for each day/night phase.
export const PHASE_PRESETS: Readonly<Record<TimePhase, PhasePreset>> = {
  dawn: { sunColor: 0xff9a5b, sunIntensity: 1.15, sunPosition: [-8, 2, 8], hemiSky: 0xffc18a, hemiGround: 0x5d4a3a, hemiIntensity: 0.65, ambientTint: 0xffb07a, skyTop: 0x5b78a8, skyHorizon: 0xff9a5b, fogColor: 0xffb58a, exposureMultiplier: 1.18 },
  morning: { sunColor: 0xffd98a, sunIntensity: 1.45, sunPosition: [-4, 8, 6], hemiSky: 0xaecfff, hemiGround: 0x7a6542, hemiIntensity: 0.78, ambientTint: 0xffd7a0, skyTop: 0x75a8df, skyHorizon: 0xffd6a0, fogColor: 0xcfd8c9, exposureMultiplier: 1.05 },
  noon: { sunColor: 0xfff8e0, sunIntensity: 1.75, sunPosition: [0, 12, 0], hemiSky: 0xb8d8ff, hemiGround: 0x8a7a5a, hemiIntensity: 0.88, ambientTint: 0xf4f1dc, skyTop: 0x68aee8, skyHorizon: 0xbddfff, fogColor: 0xdce7df, exposureMultiplier: 1 },
  afternoon: { sunColor: 0xffc46b, sunIntensity: 1.5, sunPosition: [4, 8, 6], hemiSky: 0xa8c8ef, hemiGround: 0x80603e, hemiIntensity: 0.8, ambientTint: 0xffc88a, skyTop: 0x6fa0d0, skyHorizon: 0xffbd75, fogColor: 0xd8c7a8, exposureMultiplier: 1.03 },
  dusk: { sunColor: 0xff6a2a, sunIntensity: 0.95, sunPosition: [8, 2, 8], hemiSky: 0xd08a66, hemiGround: 0x4d3648, hemiIntensity: 0.58, ambientTint: 0xff8250, skyTop: 0x3f4a78, skyHorizon: 0xff6a2a, fogColor: 0xb87866, exposureMultiplier: 1.12 },
  evening: { sunColor: 0x6a5aa0, sunIntensity: 0.32, sunPosition: [8, -2, 8], hemiSky: 0x505a92, hemiGround: 0x24243a, hemiIntensity: 0.35, ambientTint: 0x6a5aa0, skyTop: 0x202b55, skyHorizon: 0x7a5888, fogColor: 0x4a4268, exposureMultiplier: 0.82 },
  night: { sunColor: 0x8fa0d0, sunIntensity: 0.18, sunPosition: [-4, 8, -6], hemiSky: 0x223a68, hemiGround: 0x101522, hemiIntensity: 0.22, ambientTint: 0x7588b8, skyTop: 0x101a38, skyHorizon: 0x28365f, fogColor: 0x1e2c4d, exposureMultiplier: 0.68 },
  midnight: { sunColor: 0x4a5878, sunIntensity: 0.1, sunPosition: [0, 7, -8], hemiSky: 0x111f3f, hemiGround: 0x080b13, hemiIntensity: 0.14, ambientTint: 0x4a5878, skyTop: 0x080d22, skyHorizon: 0x172341, fogColor: 0x111a30, exposureMultiplier: 0.58 },
};

const phaseIndexes: Readonly<Record<TimePhase, number>> = {
  dawn: 0,
  morning: 1,
  noon: 2,
  afternoon: 3,
  dusk: 4,
  evening: 5,
  night: 6,
  midnight: 7,
};

const scratchColorA = new THREE.Color();
const scratchColorB = new THREE.Color();

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerpNumber = (a: number, b: number, t: number): number => a + (b - a) * t;
const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;
const phaseAt = (index: number): TimePhase => TIME_PHASE_ORDER[modulo(index, TIME_PHASE_ORDER.length)] ?? FIRST_PHASE;
const phaseIndex = (phase: TimePhase): number => phaseIndexes[phase];
const durationMs = (config: TimeOfDayConfig): number => {
  const configuredDuration = config.cycleDurationMs ?? DEFAULT_CYCLE_DURATION_MS;
  return configuredDuration > 0 ? configuredDuration : DEFAULT_CYCLE_DURATION_MS;
};
const startPhase = (config: TimeOfDayConfig): TimePhase => config.startPhase ?? FIRST_PHASE;
const fixedPhase = (config: TimeOfDayConfig): TimePhase => config.fixedPhase ?? startPhase(config);
const lerpHex = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const writeHex = (a: number, b: number, t: number): number => scratchColorA.set(a).lerp(scratchColorB.set(b), t).getHex();

const writeCycleSample = (target: CycleSample, config: TimeOfDayConfig, nowMs: number): void => {
  switch (config.mode) {
    case 'fixed': {
      const phase = fixedPhase(config);
      target.currentPhase = phase;
      target.nextPhase = phase;
      target.blend = 0;
      return;
    }
    case 'auto':
    case 'server': {
      const duration = durationMs(config);
      const position = (modulo(nowMs, duration) / duration) * TIME_PHASE_ORDER.length;
      const phase = phaseAt(phaseIndex(startPhase(config)) + Math.floor(position));
      target.currentPhase = phase;
      target.nextPhase = phaseAt(phaseIndex(phase) + 1);
      target.blend = clamp01(position - Math.floor(position));
      return;
    }
    default:
      throw new UnreachablePhaseError(config.mode);
  }
};

const sampleCycle = (config: TimeOfDayConfig, nowMs: number): CycleSample => {
  const sample: CycleSample = { currentPhase: FIRST_PHASE, nextPhase: FIRST_PHASE, blend: 0 };
  writeCycleSample(sample, config, nowMs);
  return sample;
};

const makePresetSlot = (source: PhasePreset): PhasePreset => ({ ...source, sunPosition: [...source.sunPosition] });

const copyPreset = (target: PhasePreset, source: PhasePreset): void => {
  target.sunColor = source.sunColor;
  target.sunIntensity = source.sunIntensity;
  target.sunPosition[0] = source.sunPosition[0];
  target.sunPosition[1] = source.sunPosition[1];
  target.sunPosition[2] = source.sunPosition[2];
  target.hemiSky = source.hemiSky;
  target.hemiGround = source.hemiGround;
  target.hemiIntensity = source.hemiIntensity;
  target.ambientTint = source.ambientTint;
  target.skyTop = source.skyTop;
  target.skyHorizon = source.skyHorizon;
  target.fogColor = source.fogColor;
  target.exposureMultiplier = source.exposureMultiplier;
};

const samePreset = (a: PhasePreset, b: PhasePreset): boolean =>
  a.sunColor === b.sunColor &&
  a.sunIntensity === b.sunIntensity &&
  a.sunPosition[0] === b.sunPosition[0] &&
  a.sunPosition[1] === b.sunPosition[1] &&
  a.sunPosition[2] === b.sunPosition[2] &&
  a.hemiSky === b.hemiSky &&
  a.hemiGround === b.hemiGround &&
  a.hemiIntensity === b.hemiIntensity &&
  a.ambientTint === b.ambientTint &&
  a.skyTop === b.skyTop &&
  a.skyHorizon === b.skyHorizon &&
  a.fogColor === b.fogColor &&
  a.exposureMultiplier === b.exposureMultiplier;

const writeInterpolatedPreset = (target: PhasePreset, a: PhasePreset, b: PhasePreset, t: number): void => {
  const blend = clamp01(t);
  target.sunColor = writeHex(a.sunColor, b.sunColor, blend);
  target.sunIntensity = lerpNumber(a.sunIntensity, b.sunIntensity, blend);
  target.sunPosition[0] = lerpNumber(a.sunPosition[0], b.sunPosition[0], blend);
  target.sunPosition[1] = lerpNumber(a.sunPosition[1], b.sunPosition[1], blend);
  target.sunPosition[2] = lerpNumber(a.sunPosition[2], b.sunPosition[2], blend);
  target.hemiSky = writeHex(a.hemiSky, b.hemiSky, blend);
  target.hemiGround = writeHex(a.hemiGround, b.hemiGround, blend);
  target.hemiIntensity = lerpNumber(a.hemiIntensity, b.hemiIntensity, blend);
  target.ambientTint = writeHex(a.ambientTint, b.ambientTint, blend);
  target.skyTop = writeHex(a.skyTop, b.skyTop, blend);
  target.skyHorizon = writeHex(a.skyHorizon, b.skyHorizon, blend);
  target.fogColor = writeHex(a.fogColor, b.fogColor, blend);
  target.exposureMultiplier = lerpNumber(a.exposureMultiplier, b.exposureMultiplier, blend);
};

// Linearly blends two phase presets, including THREE.Color hex interpolation.
export const interpolatePhases = (a: PhasePreset, b: PhasePreset, t: number): PhasePreset => {
  const blend = clamp01(t);
  return {
    sunColor: lerpHex(a.sunColor, b.sunColor, blend),
    sunIntensity: lerpNumber(a.sunIntensity, b.sunIntensity, blend),
    sunPosition: [lerpNumber(a.sunPosition[0], b.sunPosition[0], blend), lerpNumber(a.sunPosition[1], b.sunPosition[1], blend), lerpNumber(a.sunPosition[2], b.sunPosition[2], blend)],
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, blend),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, blend),
    hemiIntensity: lerpNumber(a.hemiIntensity, b.hemiIntensity, blend),
    ambientTint: lerpHex(a.ambientTint, b.ambientTint, blend),
    skyTop: lerpHex(a.skyTop, b.skyTop, blend),
    skyHorizon: lerpHex(a.skyHorizon, b.skyHorizon, blend),
    fogColor: lerpHex(a.fogColor, b.fogColor, blend),
    exposureMultiplier: lerpNumber(a.exposureMultiplier, b.exposureMultiplier, blend),
  };
};

// Samples the active preset for a fixed, auto, or server-driven time-of-day config.
export const phaseForCycle = (config: TimeOfDayConfig, nowMs: number): PhaseResult => {
  const sample = sampleCycle(config, nowMs);
  return { current: interpolatePhases(PHASE_PRESETS[sample.currentPhase], PHASE_PRESETS[sample.nextPhase], sample.blend), nextPhase: sample.nextPhase, blend: sample.blend };
};

// Zero-allocation per-frame driver for applying the current phase preset.
export class TimeOfDayDriver {
  readonly #config: TimeOfDayConfig;
  readonly #currentPreset: PhasePreset;
  readonly #nextPreset: PhasePreset;
  readonly #sample: CycleSample = { currentPhase: FIRST_PHASE, nextPhase: FIRST_PHASE, blend: 0 };
  #observedVersion = 0;
  #phase: TimePhase;
  #version = 0;

  constructor(config: TimeOfDayConfig) {
    const initialPhase = fixedPhase(config);
    this.#config = config;
    this.#phase = initialPhase;
    this.#currentPreset = makePresetSlot(PHASE_PRESETS[initialPhase]);
    this.#nextPreset = makePresetSlot(PHASE_PRESETS[initialPhase]);
    this.tick(0);
    this.#observedVersion = this.#version;
  }

  get currentPreset(): PhasePreset {
    return this.#currentPreset;
  }

  get phase(): TimePhase {
    return this.#phase;
  }

  tick(nowMs: number): void {
    writeCycleSample(this.#sample, this.#config, nowMs);
    this.#phase = this.#sample.currentPhase;
    writeInterpolatedPreset(this.#nextPreset, PHASE_PRESETS[this.#sample.currentPhase], PHASE_PRESETS[this.#sample.nextPhase], this.#sample.blend);
    if (!samePreset(this.#currentPreset, this.#nextPreset)) {
      copyPreset(this.#currentPreset, this.#nextPreset);
      this.#version += 1;
    }
  }

  hasChanged(): boolean {
    const changed = this.#observedVersion !== this.#version;
    this.#observedVersion = this.#version;
    return changed;
  }
}
