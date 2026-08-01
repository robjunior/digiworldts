import type { ThunderFlashConfig } from '@digiworld/shared/weather';
import * as THREE from 'three';

const RAMP_UP_FRACTION = 0.2;
const HOLD_FRACTION = 0.2;
const HEMI_FLASH_MULTIPLIER = 1.5;
const STUTTER_DARK_GAP_FRACTION = 0.28;

type FlashState = 'idle' | 'ramping-up' | 'holding' | 'ramping-down';

export class ThunderFlashController {
  private config: ThunderFlashConfig;
  private pendingConfig: ThunderFlashConfig | null = null;
  private state: FlashState = 'idle';
  private elapsedMs = 0;
  private nextFireAt = Number.POSITIVE_INFINITY;
  private intensityMult = 1;

  private readonly baseKeyIntensity: number;
  private readonly baseHemiIntensity: number;
  private readonly baseKeyColorR: number;
  private readonly baseKeyColorG: number;
  private readonly baseKeyColorB: number;

  constructor(
    config: ThunderFlashConfig,
    private readonly keyLight: THREE.DirectionalLight,
    private readonly hemiLight: THREE.HemisphereLight,
  ) {
    this.config = config;
    this.baseKeyIntensity = keyLight.intensity;
    this.baseHemiIntensity = hemiLight.intensity;
    this.baseKeyColorR = keyLight.color.r;
    this.baseKeyColorG = keyLight.color.g;
    this.baseKeyColorB = keyLight.color.b;

    if (config.enabled) {
      this.nextFireAt = this.sampleNextFireAt(Date.now(), config);
    }
  }

  tick(dt: number, nowMs: number): void {
    if (this.state === 'idle') {
      this.applyPendingConfig(nowMs);
      if (!this.config.enabled || nowMs < this.nextFireAt) {
        return;
      }
      this.beginFlash(this.config, 1);
    }

    this.elapsedMs += dt * 1000;
    this.advanceState();
    this.applyFlashLights();

    if (this.state === 'idle') {
      this.restoreLights();
      this.applyPendingConfig(nowMs);
      this.nextFireAt = this.config.enabled
        ? this.sampleNextFireAt(nowMs, this.config)
        : Number.POSITIVE_INFINITY;
    }
  }

  fireFlash(intensityMult = 1): void {
    if (!this.config.enabled) {
      return;
    }
    this.beginFlash(this.config, intensityMult);
  }

  setConfig(config: ThunderFlashConfig): void {
    if (this.state === 'idle') {
      this.config = config;
      this.restoreLights();
      this.nextFireAt = config.enabled
        ? this.sampleNextFireAt(Date.now(), config)
        : Number.POSITIVE_INFINITY;
      return;
    }

    this.pendingConfig = config;
    if (this.state !== 'ramping-down') {
      this.forceRampDownFromCurrentStrength();
    }
  }

  dispose(): void {
    this.pendingConfig = null;
    this.state = 'idle';
    this.elapsedMs = 0;
    this.nextFireAt = Number.POSITIVE_INFINITY;
    this.restoreLights();
  }

  private beginFlash(config: ThunderFlashConfig, intensityMult: number): void {
    this.config = config;
    this.intensityMult = Math.max(0, intensityMult);
    this.elapsedMs = 0;
    this.state = 'ramping-up';
  }

  private advanceState(): void {
    const durationMs = this.safeDurationMs(this.config);
    if (this.elapsedMs >= durationMs) {
      this.state = 'idle';
      this.elapsedMs = 0;
      return;
    }

    const rampUpEndMs = durationMs * RAMP_UP_FRACTION;
    const holdEndMs = durationMs * (RAMP_UP_FRACTION + HOLD_FRACTION);
    if (this.elapsedMs < rampUpEndMs) {
      this.state = 'ramping-up';
      return;
    }
    this.state = this.elapsedMs < holdEndMs ? 'holding' : 'ramping-down';
  }

  private applyFlashLights(): void {
    const envelope = this.envelopeStrength();
    const stutter = this.stutterStrength();
    const strength = envelope * stutter;
    const keyPeakIntensity = this.config.flashIntensity * this.intensityMult;
    const hemiPeakIntensity = this.baseHemiIntensity * HEMI_FLASH_MULTIPLIER;

    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.baseKeyIntensity,
      keyPeakIntensity,
      strength,
    );
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      this.baseHemiIntensity,
      hemiPeakIntensity,
      strength,
    );
    this.keyLight.color.setRGB(
      THREE.MathUtils.lerp(
        this.baseKeyColorR,
        ((this.config.flashColor >> 16) & 255) / 255,
        strength,
      ),
      THREE.MathUtils.lerp(
        this.baseKeyColorG,
        ((this.config.flashColor >> 8) & 255) / 255,
        strength,
      ),
      THREE.MathUtils.lerp(this.baseKeyColorB, (this.config.flashColor & 255) / 255, strength),
    );
  }

  private envelopeStrength(): number {
    const durationMs = this.safeDurationMs(this.config);
    const rampUpMs = durationMs * RAMP_UP_FRACTION;
    const holdMs = durationMs * HOLD_FRACTION;
    const rampDownStartMs = rampUpMs + holdMs;

    switch (this.state) {
      case 'idle':
        return 0;
      case 'ramping-up':
        return THREE.MathUtils.clamp(this.elapsedMs / rampUpMs, 0, 1);
      case 'holding':
        return 1;
      case 'ramping-down':
        return 1 - THREE.MathUtils.clamp(
          (this.elapsedMs - rampDownStartMs) / (durationMs - rampDownStartMs),
          0,
          1,
        );
    }
  }

  private stutterStrength(): number {
    const stutterCount = Math.max(1, Math.floor(this.config.stutterCount));
    if (stutterCount <= 1) {
      return 1;
    }

    const durationMs = this.safeDurationMs(this.config);
    const segmentMs = durationMs / stutterCount;
    const segmentElapsedMs = this.elapsedMs % segmentMs;
    const litMs = segmentMs * (1 - STUTTER_DARK_GAP_FRACTION);
    if (segmentElapsedMs <= litMs) {
      return 1;
    }
    return 0.12;
  }

  private applyPendingConfig(nowMs: number): void {
    if (this.pendingConfig === null) {
      return;
    }

    this.config = this.pendingConfig;
    this.pendingConfig = null;
    this.nextFireAt = this.config.enabled
      ? this.sampleNextFireAt(nowMs, this.config)
      : Number.POSITIVE_INFINITY;
  }

  private restoreLights(): void {
    this.keyLight.intensity = this.baseKeyIntensity;
    this.hemiLight.intensity = this.baseHemiIntensity;
    this.keyLight.color.setRGB(this.baseKeyColorR, this.baseKeyColorG, this.baseKeyColorB);
  }

  private sampleNextFireAt(nowMs: number, config: ThunderFlashConfig): number {
    const [minMs, maxMs] = config.intervalMs;
    const lowMs = Math.min(minMs, maxMs);
    const highMs = Math.max(minMs, maxMs);
    return nowMs + lowMs + Math.random() * (highMs - lowMs);
  }

  private safeDurationMs(config: ThunderFlashConfig): number {
    return Math.max(1, config.durationMs);
  }

  private rampDownStartMs(config: ThunderFlashConfig): number {
    return this.safeDurationMs(config) * (RAMP_UP_FRACTION + HOLD_FRACTION);
  }

  private forceRampDownFromCurrentStrength(): void {
    const durationMs = this.safeDurationMs(this.config);
    const rampDownStartMs = this.rampDownStartMs(this.config);
    const rampDownDurationMs = durationMs - rampDownStartMs;
    this.elapsedMs = rampDownStartMs + (1 - this.envelopeStrength()) * rampDownDurationMs;
    this.state = 'ramping-down';
  }
}
