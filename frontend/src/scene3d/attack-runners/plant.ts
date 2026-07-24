import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const PLANT_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLANT_LEAF_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uSeed;
  uniform vec3 uColorHot;
  uniform vec3 uColorMid;
  uniform vec3 uColorCool;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float dist = 1.0 - r;
    float ang = atan(uv.y, uv.x);
    float petals = 0.5 + 0.5 * sin(ang * 6.0 + uSeed);
    float noiseSample = noise(uv * 5.0 + vec2(uTime * 0.6, 0.0));
    float shape = smoothstep(0.1, 0.85, dist * (0.55 + petals * 0.6) * (0.7 + noiseSample * 0.6));
    vec3 col = mix(uColorCool, uColorMid, smoothstep(0.0, 0.55, shape));
    col = mix(col, uColorHot, smoothstep(0.5, 1.0, shape));
    float lifecycle = smoothstep(0.05, 0.35, uProgress) * (1.0 - smoothstep(0.7, 1.0, uProgress));
    float alpha = shape * lifecycle * 1.15;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const LEAF_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly yOffset: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.6, growScale: 1.4, yOffset: 0.4, opacity: 1.0, delayS: 0.0 },
  { baseScale: 2.2, growScale: 1.5, yOffset: 0.9, opacity: 0.7, delayS: 0.08 },
  { baseScale: 1.1, growScale: 1.3, yOffset: 0.2, opacity: 0.9, delayS: 0.14 },
];

const HOT_COLOR = new THREE.Color(0xd8ffb0);
const MID_COLOR = new THREE.Color(0x54c26a);
const COOL_COLOR = new THREE.Color(0x226e3a);

type LeafLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type Vine = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
};

export function buildPlantRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  const seed = Math.random() * 1000;

  const layers: LeafLayer[] = LEAF_LAYERS.map((cfg, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: PLANT_VERTEX,
      fragmentShader: PLANT_LEAF_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uSeed: { value: seed + index * 23.7 },
        uColorHot: { value: HOT_COLOR.clone() },
        uColorMid: { value: MID_COLOR.clone().multiplyScalar(cfg.opacity) },
        uColorCool: { value: COOL_COLOR.clone().multiplyScalar(cfg.opacity) },
      },
    });
    const mesh = new THREE.Mesh(leafGeometry, material);
    mesh.position.set(effect.targetPosition.x, effect.targetPosition.y + cfg.yOffset, effect.targetPosition.z);
    mesh.scale.setScalar(cfg.baseScale);
    scene.add(mesh);
    return { mesh, material, baseScale: cfg.baseScale, growScale: cfg.growScale, delayS: cfg.delayS };
  });

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.plant,
    ELEMENT_LIGHT_INTENSITY.plant,
    ELEMENT_LIGHT_DISTANCE.plant,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  const vineCount = 3;
  const vines: Vine[] = [];
  const vineGeometry = new THREE.PlaneGeometry(1, 0.14);
  for (let i = 0; i < vineCount; i += 1) {
    const start = effect.sourcePosition.clone();
    start.y += 0.6 + Math.random() * 0.6;
    const end = effect.targetPosition.clone();
    end.y += 0.4 + Math.random() * 0.7;
    end.x += (Math.random() - 0.5) * 0.6;
    end.z += (Math.random() - 0.5) * 0.6;
    const material = new THREE.MeshBasicMaterial({
      color: 0x66d05a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(vineGeometry, material);
    scene.add(mesh);
    vines.push({ mesh, material, start, end });
  }

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };

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
      layer.mesh.scale.set(scale, scale * 1.15, 1);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    for (let i = 0; i < vines.length; i += 1) {
      const vine = vines[i]!;
      const delay = i * 0.04;
      const vineP = Math.max(0, Math.min(1, (elapsed - delay) / 0.32));
      if (vineP <= 0 || vineP >= 1) {
        vine.material.opacity = 0;
        continue;
      }
      const head = new THREE.Vector3().lerpVectors(vine.start, vine.end, Math.min(1, vineP * 1.25));
      const tail = new THREE.Vector3().lerpVectors(vine.start, vine.end, Math.max(0, vineP - 0.25));
      const mid = tail.clone().add(head).multiplyScalar(0.5);
      const dir = head.clone().sub(tail);
      const length = dir.length();
      if (length < 0.001) {
        vine.material.opacity = 0;
        continue;
      }
      vine.mesh.position.copy(mid);
      vine.mesh.scale.set(length, 1, 1);
      vine.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.divideScalar(length));
      vine.material.opacity = (1 - vineP) * 0.9;
    }

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.plant * lightPulse;

    if (!impactFired && elapsed >= 0.2) {
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
    leafGeometry.dispose();
    for (const vine of vines) {
      scene.remove(vine.mesh);
      vine.material.dispose();
    }
    vineGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
