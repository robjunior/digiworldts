import * as THREE from 'three';

import type { AnimatedElement } from './types';
import {
  ELEMENT_LIGHT_COLOR,
  ELEMENT_LIGHT_DISTANCE,
  ELEMENT_LIGHT_INTENSITY,
} from './types';

/**
 * Centralized ability-impact polish.
 *
 * Every skill cast funnels through `SceneManager.playEffect`, and every runner
 * (the 11 per-element shader runners AND the SkillVfxPreset runner) fires its
 * hit through the single `wrappedEffect.onImpact` callback. This module gives
 * that moment a shared, element-aware upgrade so the improvement lands on ALL
 * abilities at once, instead of being copy-pasted into each runner:
 *
 *   1. an expanding additive RING that reads as the kinetic "pop" of the hit,
 *   2. a short-lived burst of element-colored SPARKS (small camera-facing
 *      quads) that scatter along the surface — the "secondary burst",
 *   3. a brief POINT-LIGHT pulse (reusing the element-tuned color/intensity),
 *   4. a one-shot camera SCREEN-SHAKE on impact (added to the render loop).
 *
 * The ring + sparks are billboarded (quaternion-copied from the camera) so they
 * read as flat decals facing the viewer, matching the existing flame/streak
 * convention in `fire.ts`. Everything is disposed by the owning `ImpactController`
 * when its lifetime elapses, and the map entry is dropped by the render loop
 * exactly like a normal runner.
 */

/** Per-element visual tuning for the impact polish. */
type ImpactTuning = {
  /** Ring max radius in world units. */
  ringRadius: number;
  /** Spark count in the secondary burst. */
  sparkCount: number;
  /** Spark scatter speed (world units / second). */
  sparkSpeed: number;
  /** How hard the camera shakes on this element's hit (0 = no shake). */
  shake: number;
};

const IMPACT_TUNING: Record<AnimatedElement, ImpactTuning> = {
  fire: { ringRadius: 1.15, sparkCount: 14, sparkSpeed: 2.6, shake: 0.05 },
  water: { ringRadius: 1.0, sparkCount: 10, sparkSpeed: 2.0, shake: 0.03 },
  ice: { ringRadius: 1.05, sparkCount: 16, sparkSpeed: 3.0, shake: 0.04 },
  electricity: { ringRadius: 0.9, sparkCount: 18, sparkSpeed: 3.6, shake: 0.045 },
  earth: { ringRadius: 1.2, sparkCount: 12, sparkSpeed: 1.6, shake: 0.06 },
  steel: { ringRadius: 0.95, sparkCount: 14, sparkSpeed: 2.8, shake: 0.05 },
  plant: { ringRadius: 0.95, sparkCount: 12, sparkSpeed: 1.8, shake: 0.025 },
  wind: { ringRadius: 1.1, sparkCount: 10, sparkSpeed: 2.4, shake: 0.03 },
  light: { ringRadius: 1.05, sparkCount: 14, sparkSpeed: 2.8, shake: 0.04 },
  dark: { ringRadius: 1.0, sparkCount: 12, sparkSpeed: 2.2, shake: 0.05 },
  null: { ringRadius: 0.85, sparkCount: 8, sparkSpeed: 1.8, shake: 0.02 },
};

/** Lifetime of the whole impact flourish (seconds). */
const IMPACT_LIFETIME_S = 0.5;
/** How long the ring takes to expand + fade (seconds). */
const RING_DURATION_S = 0.34;

const RING_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A thin hollow ring: bright at the rim, transparent in the middle, discarding
// the outer falloff. Additive blending makes the rim read as a flash of light.
const RING_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float rim = smoothstep(0.55, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
    float alpha = rim * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const SPARK_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float a = (1.0 - r) * (1.0 - r);
    float alpha = a * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

type Spark = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly velocity: THREE.Vector3;
};

export type ImpactRunner = {
  tick(dtS: number, elapsedS: number, cameraQuat: THREE.Quaternion): void;
  dispose(): void;
};

export type ImpactController = {
  readonly id: string;
  readonly runner: ImpactRunner;
  /** Total lifetime, so the render loop drops it like a normal effect. */
  readonly duration: number;
};

export type ImpactOptions = {
  readonly element: AnimatedElement;
  /** World position of the target sprite's impact point. */
  readonly position: THREE.Vector3;
};

/**
 * Build a one-shot impact flourish. Returns null when the element is unknown
 * (defensive — callers always pass an AnimatedElement, but never hard-fail).
 */
export function buildImpactController(
  scene: THREE.Scene,
  opts: ImpactOptions,
): ImpactController | null {
  const tuning = IMPACT_TUNING[opts.element];
  if (tuning === undefined) return null;

  const id = `impact-${opts.element}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const colorHex = ELEMENT_LIGHT_COLOR[opts.element];
  const color = new THREE.Color(colorHex);

  const sharedGeometry = new THREE.PlaneGeometry(1, 1);
  const ringGeometry = sharedGeometry;
  const sparkGeometry = sharedGeometry;

  // --- Ring ----------------------------------------------------------------
  const ringMaterial = new THREE.ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: 0 },
    },
  });
  const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
  ringMesh.position.copy(opts.position);
  ringMesh.scale.setScalar(0.1);

  // --- Sparks (secondary burst) -------------------------------------------
  const sparks: Spark[] = [];
  for (let i = 0; i < tuning.sparkCount; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sparkGeometry, material);
    mesh.position.copy(opts.position);
    const ang = (i / tuning.sparkCount) * Math.PI * 2 + Math.random() * 0.6;
    const elevation = (Math.random() - 0.5) * 1.1;
    const dir = new THREE.Vector3(Math.cos(ang), elevation, Math.sin(ang)).normalize();
    const speed = tuning.sparkSpeed * (0.6 + Math.random() * 0.8);
    const spark: Spark = {
      mesh,
      material,
      velocity: dir.multiplyScalar(speed),
    };
    sparks.push(spark);
  }

  // --- Light pulse ----------------------------------------------------------
  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR[opts.element],
    0,
    ELEMENT_LIGHT_DISTANCE[opts.element],
    2,
  );
  light.position.copy(opts.position);

  let elapsed = 0;
  const disposed = { value: false };

  const tick: ImpactRunner['tick'] = (dtS, _elapsedS, cameraQuat) => {
    if (disposed.value) return;
    elapsed += dtS;
    const t = Math.min(1, elapsed / IMPACT_LIFETIME_S);

    // Ring expands quickly then fades; caps at the element radius.
    const ringP = Math.min(1, elapsed / RING_DURATION_S);
    const radius = 0.1 + ringP * tuning.ringRadius;
    ringMesh.scale.setScalar(radius);
    ringMesh.quaternion.copy(cameraQuat);
    const uOpacity = ringMaterial.uniforms.uOpacity;
    if (uOpacity !== undefined) {
      const tailFade = 1 - Math.max(0, (elapsed - RING_DURATION_S) / 0.2);
      uOpacity.value = (1 - ringP) * 0.9 * tailFade;
    }

    // Sparks fly out, decelerate, and fade.
    const sparkFade = Math.max(0, 1 - elapsed / (IMPACT_LIFETIME_S * 0.9));
    for (const spark of sparks) {
      spark.mesh.position.addScaledVector(spark.velocity, dtS);
      spark.velocity.multiplyScalar(1 - 2.2 * dtS); // drag
      spark.velocity.y -= 1.5 * dtS; // light gravity
      spark.mesh.quaternion.copy(cameraQuat);
      spark.material.opacity = sparkFade * 0.95;
      const s = 0.12 + (1 - sparkFade) * 0.18;
      spark.mesh.scale.set(s, s, 1);
    }

    // Light pulses and decays.
    light.intensity = ELEMENT_LIGHT_INTENSITY[opts.element] * (1 - t) * 1.1;
  };

  const dispose: ImpactRunner['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    scene.remove(ringMesh);
    ringMaterial.dispose();
    for (const spark of sparks) {
      scene.remove(spark.mesh);
      spark.material.dispose();
    }
    sharedGeometry.dispose();
    scene.remove(light);
  };

  scene.add(ringMesh);
  scene.add(light);
  for (const spark of sparks) scene.add(spark.mesh);

  return {
    id,
    duration: IMPACT_LIFETIME_S,
    runner: { tick, dispose },
  };
}

/** Decay a screen-shake amplitude over time and return the current offset. */
export function nextShakeOffset(
  amplitude: number,
  elapsedS: number,
  durationS: number,
): { x: number; y: number } {
  if (amplitude <= 0 || elapsedS >= durationS) return { x: 0, y: 0 };
  const decay = 1 - elapsedS / durationS;
  const k = amplitude * decay;
  return {
    x: (Math.random() - 0.5) * 2 * k,
    y: (Math.random() - 0.5) * 2 * k,
  };
}

export const IMPACT_SHAKE_DURATION_S = 0.28;

/** Translate an element's tuning into the shake amplitude to request. */
export function shakeForElement(element: AnimatedElement): number {
  return IMPACT_TUNING[element]?.shake ?? 0;
}
