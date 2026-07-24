import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const WIND_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WIND_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  uniform float uSpin;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float ang = atan(uv.y, uv.x) + uTime * uSpin;
    float arcs = 0.5 + 0.5 * sin(ang * 3.0 + r * 4.0);
    float band = smoothstep(0.35, 0.65, r) * (1.0 - smoothstep(0.75, 1.0, r));
    float shape = arcs * band;
    vec3 col = mix(uColorCool, uColorHot, shape);
    float lifecycle = smoothstep(0.05, 0.3, uProgress) * (1.0 - smoothstep(0.65, 1.0, uProgress));
    float alpha = shape * lifecycle * 1.1;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const ARC_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly spin: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.8, growScale: 1.4, spin: 1.6, opacity: 1.0, delayS: 0.0 },
  { baseScale: 2.4, growScale: 1.6, spin: -1.2, opacity: 0.75, delayS: 0.08 },
  { baseScale: 1.3, growScale: 1.2, spin: 2.4, opacity: 0.85, delayS: 0.16 },
];

const HOT_COLOR = new THREE.Color(0xffffff);
const COOL_COLOR = new THREE.Color(0x7ec48c);

type ArcLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type Slash = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly angle: number;
};

export function buildWindRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const arcGeometry = new THREE.PlaneGeometry(1, 1);

  const layers: ArcLayer[] = ARC_LAYERS.map((cfg) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: WIND_VERTEX,
      fragmentShader: WIND_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uColorHot: { value: HOT_COLOR.clone() },
        uColorCool: { value: COOL_COLOR.clone().multiplyScalar(cfg.opacity) },
        uSpin: { value: cfg.spin },
      },
    });
    const mesh = new THREE.Mesh(arcGeometry, material);
    mesh.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.6, effect.targetPosition.z);
    mesh.scale.setScalar(cfg.baseScale);
    scene.add(mesh);
    return { mesh, material, baseScale: cfg.baseScale, growScale: cfg.growScale, delayS: cfg.delayS };
  });

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.wind,
    ELEMENT_LIGHT_INTENSITY.wind,
    ELEMENT_LIGHT_DISTANCE.wind,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  const slashCount = 4;
  const slashes: Slash[] = [];
  const slashGeometry = new THREE.PlaneGeometry(3, 0.08);
  const angles = [Math.PI * 0.15, -Math.PI * 0.35, Math.PI * 0.55, -Math.PI * 0.7];
  for (let i = 0; i < slashCount; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xd6ffe4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(slashGeometry, material);
    mesh.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.5, effect.targetPosition.z);
    scene.add(mesh);
    slashes.push({ mesh, material, angle: angles[i] ?? 0 });
  }

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };
  const slashRotQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  const tick: Runner3D['tick'] = (dtS, elapsedTimeS, cameraQuat) => {
    if (disposed.value) return;
    elapsed += dtS;
    const p = Math.min(1, elapsed / dur);

    for (const layer of layers) {
      const layerP = Math.max(0, Math.min(1, (elapsed - layer.delayS) / (dur - layer.delayS)));
      const uTime = layer.material.uniforms.uTime;
      const uProgress = layer.material.uniforms.uProgress;
      if (uTime !== undefined) uTime.value = elapsedTimeS;
      if (uProgress !== undefined) uProgress.value = layerP;
      const scale = layer.baseScale + layerP * layer.growScale;
      layer.mesh.scale.set(scale, scale, 1);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    for (let i = 0; i < slashes.length; i += 1) {
      const slash = slashes[i]!;
      const delay = i * 0.06;
      const slashP = Math.max(0, Math.min(1, (elapsed - delay) / 0.38));
      if (slashP <= 0 || slashP >= 1) {
        slash.material.opacity = 0;
        continue;
      }
      slashRotQ.setFromAxisAngle(zAxis, slash.angle);
      slash.mesh.quaternion.copy(cameraQuat).multiply(slashRotQ);
      const envelope = Math.sin(slashP * Math.PI);
      slash.material.opacity = envelope * 0.85;
      slash.mesh.scale.set(1 + slashP * 0.6, 1, 1);
    }

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.wind * lightPulse;

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
      layer.material.dispose();
    }
    arcGeometry.dispose();
    for (const slash of slashes) {
      scene.remove(slash.mesh);
      slash.material.dispose();
    }
    slashGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
