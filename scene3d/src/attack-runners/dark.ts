import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const DARK_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DARK_TENDRIL_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uSeed;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    float angle = atan(uv.y, uv.x);
    float dist = r * 2.0;
    vec2 warpUv = vec2(angle / 3.14159 + uTime * 0.25, dist * 2.5 - uTime * 0.85);
    float n = fbm(warpUv * 2.4);
    float arms = abs(sin(angle * 3.0 + uTime * 1.0 + n * 3.0));
    float tendril = smoothstep(0.1, 0.7, arms * (1.15 - dist) * n * 2.5);
    float glow = smoothstep(0.5, 0.0, dist) * 0.35;
    vec3 col = mix(uColorEdge, uColorCore, tendril + glow);
    float lifecycle = smoothstep(0.0, 0.2, uProgress) * (1.0 - smoothstep(0.5, 1.0, uProgress));
    float alpha = (tendril * 0.85 + glow) * lifecycle;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const DARK_AURA_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uOpacity;
  uniform vec3 uColor;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float rim = 1.0 - smoothstep(0.55, 1.0, r);
    float core = 1.0 - smoothstep(0.0, 0.65, r);
    float alpha = (rim * 0.6 + core * 0.4) * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const DARK_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly yOffset: number;
  readonly xOffset: number;
  readonly zOffset: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.8, growScale: 0.6, yOffset: 0.6,  xOffset:  0.0,  zOffset:  0.0,  opacity: 1.0,  delayS: 0.0  },
  { baseScale: 1.4, growScale: 0.5, yOffset: 1.1,  xOffset:  0.12, zOffset:  0.1,  opacity: 0.75, delayS: 0.06 },
  { baseScale: 2.0, growScale: 0.7, yOffset: 0.35, xOffset: -0.1,  zOffset: -0.08, opacity: 0.6,  delayS: 0.1  },
];

const CORE_COLOR = new THREE.Color(0xe0c8ff);
const EDGE_COLOR = new THREE.Color(0x200840);
const AURA_COLOR = new THREE.Color(0x6020a0);

type DarkLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type AuraLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
};

export function buildDarkRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const seed = Math.random() * 1000;
  const collapseEndS = dur * 0.4;

  const layers: DarkLayer[] = DARK_LAYERS.map((cfg, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: DARK_VERTEX,
      fragmentShader: DARK_TENDRIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uSeed: { value: seed + index * 23.17 },
        uColorCore: { value: CORE_COLOR.clone().multiplyScalar(cfg.opacity) },
        uColorEdge: { value: EDGE_COLOR.clone() },
      },
    });
    const mesh = new THREE.Mesh(planeGeometry, material);
    mesh.position.set(
      effect.targetPosition.x + cfg.xOffset,
      effect.targetPosition.y + cfg.yOffset,
      effect.targetPosition.z + cfg.zOffset,
    );
    mesh.scale.setScalar(cfg.baseScale);
    scene.add(mesh);
    return { mesh, material, baseScale: cfg.baseScale, growScale: cfg.growScale, delayS: cfg.delayS };
  });

  const auraMaterial = new THREE.ShaderMaterial({
    vertexShader: DARK_VERTEX,
    fragmentShader: DARK_AURA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: AURA_COLOR.clone() },
    },
  });
  const auraMesh = new THREE.Mesh(planeGeometry, auraMaterial);
  auraMesh.position.set(
    effect.targetPosition.x,
    effect.targetPosition.y + 0.6,
    effect.targetPosition.z,
  );
  auraMesh.scale.setScalar(2.4);
  scene.add(auraMesh);
  const aura: AuraLayer = { mesh: auraMesh, material: auraMaterial };

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.dark,
    ELEMENT_LIGHT_INTENSITY.dark,
    ELEMENT_LIGHT_DISTANCE.dark,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

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
      layer.mesh.scale.setScalar(scale);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    const uOpacity = aura.material.uniforms.uOpacity;
    if (elapsed < collapseEndS) {
      const cp = elapsed / collapseEndS;
      aura.mesh.scale.setScalar(Math.max(0.05, 2.4 - cp * 2.1));
      if (uOpacity !== undefined) uOpacity.value = (1 - cp) * 0.55;
    } else {
      const bp = Math.min(1, (elapsed - collapseEndS) / (dur - collapseEndS));
      aura.mesh.scale.setScalar(0.3 + bp * 3.8);
      if (uOpacity !== undefined) uOpacity.value = (1 - bp) * 0.65;
    }
    aura.mesh.quaternion.copy(cameraQuat);

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.dark * lightPulse;

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
    scene.remove(aura.mesh);
    aura.material.dispose();
    planeGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
