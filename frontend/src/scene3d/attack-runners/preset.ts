import * as THREE from 'three';

import type { SkillVfxPreset, SkillVfxTrajectory } from '@digiworld/shared/skill-vfx';

import type { AttackEffect3D, Runner3D } from './types';
import { ParticleEmitter } from '../particles/ParticleEmitter';

/**
 * Preset-driven runner — plays a `SkillVfxPreset` once from source→target and
 * disposes itself. Composes:
 *   1) up to 3 particle emitters, each with independent `startAtMs` + optional
 *      `followTrajectory` so a spark (following the projectile) and a smoke
 *      trail (static at source) can be scripted from the same preset.
 *   2) an optional `PointLight` whose intensity decays from full to 0 over
 *      `light.decayMs`. Light tracks the projectile when any emitter follows.
 *   3) a single `onImpact` fire at `impactAtMs`.
 *   4) auto-dispose at `totalDurationMs`.
 *
 * Runs in parallel with the 11 element shader runners; the SceneManager
 * chooses between preset vs element runner based on the skill's `vfxPresetId`.
 */

type EmitterSlot = {
  readonly emitter: ParticleEmitter;
  readonly startAtS: number;
  readonly followTrajectory: boolean;
  spawned: boolean;
};

/**
 * Compute the projectile position along the trajectory at normalized time t
 * (0 = source, 1 = target). Writes into `out` to avoid per-tick allocation.
 *
 *   `instant`  — teleport to target (t=0 already positioned there)
 *   `straight` — linear lerp source→target
 *   `arc`      — quadratic bezier peaking 1.5 units above the midpoint
 *   `homing`   — ease-out (t' = 1 - (1-t)²), lerps faster early then slows in
 */
function interpolatePosition(
  trajectory: SkillVfxTrajectory,
  source: THREE.Vector3,
  target: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): void {
  if (trajectory === 'instant') {
    out.copy(target);
    return;
  }
  if (trajectory === 'straight') {
    out.copy(source).lerp(target, t);
    return;
  }
  if (trajectory === 'arc') {
    const oneT = 1 - t;
    const twoT = 2 * oneT * t;
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2 + 1.5;
    const midZ = (source.z + target.z) / 2;
    out.set(
      oneT * oneT * source.x + twoT * midX + t * t * target.x,
      oneT * oneT * source.y + twoT * midY + t * t * target.y,
      oneT * oneT * source.z + twoT * midZ + t * t * target.z,
    );
    return;
  }
  const tPrime = 1 - (1 - t) * (1 - t);
  out.copy(source).lerp(target, tPrime);
}

export function buildPresetRunner(
  scene: THREE.Scene,
  effect: AttackEffect3D,
  preset: SkillVfxPreset,
): Runner3D {
  const totalDurationS = preset.totalDurationMs / 1000;
  const impactAtS = preset.impactAtMs / 1000;
  const source = effect.sourcePosition.clone();
  const target = effect.targetPosition.clone();
  const currentPos = new THREE.Vector3();

  const slots: EmitterSlot[] = preset.emitters.map((slotCfg) => ({
    emitter: new ParticleEmitter(scene, slotCfg.emitter),
    startAtS: slotCfg.startAtMs / 1000,
    followTrajectory: slotCfg.followTrajectory,
    spawned: false,
  }));

  const hasFollower = preset.emitters.some((slot) => slot.followTrajectory);

  const light = preset.light !== undefined
    ? new THREE.PointLight(preset.light.color, preset.light.intensity, preset.light.distance, 2)
    : null;
  const lightConfig = preset.light ?? null;
  const lightDecayS = lightConfig !== null ? lightConfig.decayMs / 1000 : 0;
  if (light !== null) {
    light.position.copy(source);
    scene.add(light);
  }

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const slot of slots) slot.emitter.dispose();
    if (light !== null) scene.remove(light);
  };

  const tick: Runner3D['tick'] = (dtS, _elapsedTimeS, _cameraQuat) => {
    if (disposed.value) return;
    elapsed += dtS;
    const t = Math.min(1, elapsed / totalDurationS);

    interpolatePosition(preset.trajectory, source, target, t, currentPos);

    for (const slot of slots) {
      if (!slot.spawned && elapsed >= slot.startAtS) slot.spawned = true;
      if (!slot.spawned) continue;
      if (slot.followTrajectory) {
        slot.emitter.setSpawnCenter(currentPos.x, currentPos.y, currentPos.z);
      }
      slot.emitter.tick(dtS);
    }

    if (light !== null && lightConfig !== null) {
      if (hasFollower) light.position.copy(currentPos);
      const lightT = lightDecayS > 0 ? Math.min(1, elapsed / lightDecayS) : 1;
      light.intensity = lightConfig.intensity * Math.max(0, 1 - lightT);
    }

    if (!impactFired && elapsed >= impactAtS) {
      impactFired = true;
      effect.onImpact?.();
    }

    if (elapsed >= totalDurationS) dispose();
  };

  return { tick, dispose };
}
