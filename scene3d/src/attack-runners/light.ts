import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const LIGHT_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LIGHT_BEAM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uReach;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;

  void main() {
    float horiz = abs(vUv.x - 0.5) * 2.0;
    float col = 1.0 - smoothstep(0.0, 1.0, horiz);
    float beamTop = 1.0 - uReach;
    float vertGate = 1.0 - smoothstep(beamTop, beamTop + 0.08, vUv.y);
    float shape = col * vertGate;
    vec3 color = mix(uColorCool, uColorHot, col);
    float lifecycle = smoothstep(0.0, 0.15, uProgress) * (1.0 - smoothstep(0.55, 1.0, uProgress));
    float alpha = shape * lifecycle * 1.4;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const BEAM_LAYERS: ReadonlyArray<{
  readonly widthScale: number;
  readonly heightScale: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { widthScale: 0.9, heightScale: 5.5, opacity: 1.0, delayS: 0.0 },
  { widthScale: 1.6, heightScale: 5.5, opacity: 0.55, delayS: 0.04 },
  { widthScale: 0.5, heightScale: 5.5, opacity: 0.9, delayS: 0.08 },
];

const HOT_COLOR = new THREE.Color(0xffffff);
const COOL_COLOR = new THREE.Color(0xffd670);

type BeamLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly widthScale: number;
  readonly heightScale: number;
  readonly delayS: number;
};

type RayPlane = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly dir: THREE.Vector3;
};

const REACH_DURATION_S = 0.28;

export function buildLightRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const beamGeometry = new THREE.PlaneGeometry(1, 1);

  const beamCenter = new THREE.Vector3(effect.targetPosition.x, effect.targetPosition.y + 2.75, effect.targetPosition.z);

  const layers: BeamLayer[] = BEAM_LAYERS.map((cfg) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: LIGHT_VERTEX,
      fragmentShader: LIGHT_BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uReach: { value: 0 },
        uColorHot: { value: HOT_COLOR.clone() },
        uColorCool: { value: COOL_COLOR.clone().multiplyScalar(cfg.opacity) },
      },
    });
    const mesh = new THREE.Mesh(beamGeometry, material);
    mesh.position.copy(beamCenter);
    mesh.scale.set(cfg.widthScale, cfg.heightScale, 1);
    scene.add(mesh);
    return { mesh, material, widthScale: cfg.widthScale, heightScale: cfg.heightScale, delayS: cfg.delayS };
  });

  const rayCount = 12;
  const rays: RayPlane[] = [];
  const rayGeometry = new THREE.PlaneGeometry(2.6, 0.06);
  const worldX = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < rayCount; i += 1) {
    const angle = (i / rayCount) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe8b0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(rayGeometry, material);
    mesh.quaternion.setFromUnitVectors(worldX, dir);
    scene.add(mesh);
    rays.push({ mesh, material, dir });
  }

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.light,
    ELEMENT_LIGHT_INTENSITY.light,
    ELEMENT_LIGHT_DISTANCE.light,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 1.0, effect.targetPosition.z);
  scene.add(light);

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };
  const rayCenter = new THREE.Vector3();

  const tick: Runner3D['tick'] = (dtS, elapsedTimeS) => {
    if (disposed.value) return;
    elapsed += dtS;
    const p = Math.min(1, elapsed / dur);

    for (const layer of layers) {
      const layerP = Math.max(0, Math.min(1, (elapsed - layer.delayS) / Math.max(0.05, dur - layer.delayS)));
      const reach = Math.min(1, Math.max(0, (elapsed - layer.delayS) / REACH_DURATION_S));
      const uTime = layer.material.uniforms.uTime;
      const uProgress = layer.material.uniforms.uProgress;
      const uReach = layer.material.uniforms.uReach;
      if (uTime !== undefined) uTime.value = elapsedTimeS;
      if (uProgress !== undefined) uProgress.value = layerP;
      if (uReach !== undefined) uReach.value = reach;
    }

    const rayGate = Math.max(0, Math.min(1, (elapsed - 0.22) / 0.4));
    rayCenter.set(effect.targetPosition.x, effect.targetPosition.y + 0.05, effect.targetPosition.z);
    for (let i = 0; i < rays.length; i += 1) {
      const ray = rays[i]!;
      const radius = 0.4 + rayGate * 2.6;
      ray.mesh.position.copy(rayCenter).addScaledVector(ray.dir, radius);
      const fade = Math.sin(rayGate * Math.PI);
      ray.material.opacity = fade * 0.9;
      const scale = 0.4 + rayGate * 1.4;
      ray.mesh.scale.set(scale, 1, 1);
    }

    const initial = Math.exp(-Math.max(0, elapsed - 0.15) * 6);
    const pulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.light * (pulse * 0.6 + initial * 0.8);

    if (!impactFired && elapsed >= 0.22) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const layer of layers) {
      scene.remove(layer.mesh);
      layer.material.dispose();
    }
    beamGeometry.dispose();
    for (const ray of rays) {
      scene.remove(ray.mesh);
      ray.material.dispose();
    }
    rayGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
