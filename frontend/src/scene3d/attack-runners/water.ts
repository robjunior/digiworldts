import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const WATER_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WATER_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uSeed;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorEdge;

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

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * noise(p);
      p *= 2.1;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float dist = 1.0 - r;
    vec2 flowUv = vec2(
      uv.x * 2.5 + sin(uTime * 1.1 + uv.y * 3.5) * 0.18,
      uv.y * 2.5 - uTime * 0.9
    );
    float n = fbm(flowUv);
    float ripple = sin(r * 7.5 - uTime * 5.5) * 0.5 + 0.5;
    float shape = smoothstep(0.05, 0.72, dist * (n * 1.25 + ripple * 0.28));
    float rim = smoothstep(0.1, 0.5, dist);
    vec3 col = mix(uColorEdge, uColorMid, smoothstep(0.0, 0.5, shape));
    col = mix(col, uColorCore, smoothstep(0.4, 1.0, shape + rim * 0.15));
    float lifecycle = smoothstep(0.0, 0.2, uProgress) * (1.0 - smoothstep(0.55, 1.0, uProgress));
    float alpha = shape * rim * lifecycle * 1.1;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const WATER_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly yOffset: number;
  readonly zOffset: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.3, growScale: 1.7, yOffset: 0.25, zOffset: 0, opacity: 1.0, delayS: 0.0 },
  { baseScale: 1.8, growScale: 1.3, yOffset: 0.55, zOffset: 0.07, opacity: 0.7, delayS: 0.05 },
  { baseScale: 1.0, growScale: 2.0, yOffset: 0.1, zOffset: -0.07, opacity: 0.6, delayS: 0.09 },
];

const CORE_COLOR = new THREE.Color(0xf0faff);
const MID_COLOR = new THREE.Color(0x50a5e0);
const EDGE_COLOR = new THREE.Color(0x1a4a90);

type WaterLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type Tendril = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
};

export function buildWaterRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const blobGeometry = new THREE.PlaneGeometry(1, 1);
  const seed = Math.random() * 1000;

  const layers: WaterLayer[] = WATER_LAYERS.map((cfg, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uSeed: { value: seed + index * 19.47 },
        uColorCore: { value: CORE_COLOR.clone() },
        uColorMid: { value: MID_COLOR.clone().multiplyScalar(cfg.opacity) },
        uColorEdge: { value: EDGE_COLOR.clone().multiplyScalar(cfg.opacity) },
      },
    });
    const mesh = new THREE.Mesh(blobGeometry, material);
    mesh.position.set(
      effect.targetPosition.x + cfg.zOffset,
      effect.targetPosition.y + cfg.yOffset,
      effect.targetPosition.z,
    );
    mesh.scale.setScalar(cfg.baseScale);
    scene.add(mesh);
    return { mesh, material, baseScale: cfg.baseScale, growScale: cfg.growScale, delayS: cfg.delayS };
  });

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.water,
    ELEMENT_LIGHT_INTENSITY.water,
    ELEMENT_LIGHT_DISTANCE.water,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  const tendrilCount = 3;
  const tendrils: Tendril[] = [];
  const tendrilGeometry = new THREE.PlaneGeometry(1, 0.05);
  for (let i = 0; i < tendrilCount; i += 1) {
    const start = effect.sourcePosition.clone();
    start.y += 0.85 + Math.random() * 0.4;
    const end = effect.targetPosition.clone();
    end.y += 0.4 + Math.random() * 0.5;
    end.x += (Math.random() - 0.5) * 0.5;
    end.z += (Math.random() - 0.5) * 0.5;
    const material = new THREE.MeshBasicMaterial({
      color: 0x5ab8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(tendrilGeometry, material);
    scene.add(mesh);
    tendrils.push({ mesh, material, start, end });
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
      layer.mesh.scale.set(scale, scale, 1);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    for (let i = 0; i < tendrils.length; i += 1) {
      const tendril = tendrils[i]!;
      const delay = i * 0.04;
      const tendrilP = Math.max(0, Math.min(1, (elapsed - delay) / 0.3));
      if (tendrilP <= 0 || tendrilP >= 1) {
        tendril.material.opacity = 0;
        continue;
      }
      const head = new THREE.Vector3().lerpVectors(tendril.start, tendril.end, Math.min(1, tendrilP * 1.2));
      const tail = new THREE.Vector3().lerpVectors(tendril.start, tendril.end, Math.max(0, tendrilP - 0.2));
      const mid = tail.clone().add(head).multiplyScalar(0.5);
      const dir = head.clone().sub(tail);
      const len = dir.length();
      tendril.mesh.position.copy(mid);
      tendril.mesh.scale.set(len, 1, 1);
      tendril.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
      tendril.material.opacity = (1 - tendrilP) * 0.75;
    }

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.water * lightPulse;

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
    blobGeometry.dispose();
    for (const tendril of tendrils) {
      scene.remove(tendril.mesh);
      tendril.material.dispose();
    }
    tendrilGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
