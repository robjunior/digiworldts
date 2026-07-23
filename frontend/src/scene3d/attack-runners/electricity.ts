import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const BOLT_LAYERS: ReadonlyArray<{
  readonly radius0: number;
  readonly minRadius: number;
  readonly maxIterations: number;
  readonly color: number;
  readonly opacity: number;
}> = [
  { radius0: 0.05, minRadius: 0.012, maxIterations: 7, color: 0xffffff, opacity: 1.0 },
  { radius0: 0.08, minRadius: 0.018, maxIterations: 5, color: 0xfff880, opacity: 0.7 },
  { radius0: 0.11, minRadius: 0.028, maxIterations: 4, color: 0xffe040, opacity: 0.45 },
];

type BoltLayer = {
  readonly geometry: LightningStrike;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
};

export function buildLightningRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const source = effect.sourcePosition.clone();
  source.y += 0.8;
  const dest = effect.targetPosition.clone();
  dest.y += 0.8;

  const layers: BoltLayer[] = BOLT_LAYERS.map((cfg) => {
    const geometry = new LightningStrike({
      sourceOffset: source.clone(),
      destOffset: dest.clone(),
      radius0: cfg.radius0,
      radius1: cfg.radius0 * 0.6,
      minRadius: cfg.minRadius,
      maxIterations: cfg.maxIterations,
      isEternal: true,
      timeScale: 0.6,
      propagationTimeFactor: 0.06,
      vanishingTimeFactor: 0.05,
      subrayPeriod: 0.08,
      subrayDutyCycle: 0.7,
      maxSubrayRecursion: 3,
      ramification: 4,
      recursionProbability: 0.55,
      roughness: 0.9,
      straightness: 0.7,
    });
    const material = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    return { geometry, mesh, material };
  });

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.electricity,
    ELEMENT_LIGHT_INTENSITY.electricity,
    ELEMENT_LIGHT_DISTANCE.electricity,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS, elapsedTimeS) => {
    if (disposed.value) return;
    elapsed += dtS;
    const p = Math.min(1, elapsed / dur);
    const fade = 1 - Math.pow(p, 2);

    for (const layer of layers) {
      layer.geometry.update(elapsedTimeS);
      layer.material.opacity = (BOLT_LAYERS[layers.indexOf(layer)]?.opacity ?? 1) * fade;
    }

    const flicker = 0.3 + 0.7 * Math.random();
    light.intensity = ELEMENT_LIGHT_INTENSITY.electricity * fade * flicker;

    if (!impactFired && elapsed >= 0.18) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const layer of layers) {
      scene.remove(layer.mesh);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    scene.remove(light);
  };

  return { tick, dispose };
}
