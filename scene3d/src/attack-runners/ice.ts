import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const ICE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ICE_FRAGMENT = `
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

  float voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 pt = neighbor + vec2(
          hash(i + neighbor),
          hash(i + neighbor + vec2(7.3, 11.7))
        );
        minDist = min(minDist, length(f - pt));
      }
    }
    return minDist;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float dist = 1.0 - r;

    vec2 crystalUv = uv * 3.8 + uSeed * 0.07;
    float cell = voronoi(crystalUv);
    float crystal = 1.0 - smoothstep(0.0, 0.38, cell);

    float bloomP = uProgress * 2.0;
    float bloomEnv = bloomP < 1.0 ? bloomP : 2.0 - bloomP;
    bloomEnv = clamp(bloomEnv, 0.0, 1.0);

    float shape = smoothstep(0.04, 0.62, dist * (crystal * 1.35 + 0.25)) * bloomEnv;
    float rim = smoothstep(0.05, 0.45, dist);

    vec3 col = mix(uColorEdge, uColorMid, smoothstep(0.0, 0.5, crystal));
    col = mix(col, uColorCore, smoothstep(0.45, 1.0, crystal + rim * 0.2));

    float sparkle = step(0.96, hash(crystalUv + uTime * 0.1));
    col = mix(col, vec3(1.0), sparkle * 0.5);

    float lifecycle = smoothstep(0.0, 0.18, uProgress) * (1.0 - smoothstep(0.65, 1.0, uProgress));
    float alpha = shape * lifecycle * 1.25;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const ICE_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly yOffset: number;
  readonly zOffset: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.0, growScale: 1.8, yOffset: 0.3, zOffset: 0, opacity: 1.0, delayS: 0.0 },
  { baseScale: 1.5, growScale: 1.4, yOffset: 0.55, zOffset: 0.07, opacity: 0.7, delayS: 0.04 },
  { baseScale: 0.8, growScale: 2.0, yOffset: 0.12, zOffset: -0.07, opacity: 0.55, delayS: 0.07 },
];

const ICE_SHARDS: ReadonlyArray<{
  readonly xOff: number;
  readonly yOff: number;
  readonly zOff: number;
  readonly maxScale: number;
  readonly delayS: number;
}> = [
  { xOff: 0.28, yOff: 0.12, zOff: 0.10, maxScale: 0.16, delayS: 0.0 },
  { xOff: -0.22, yOff: 0.22, zOff: -0.06, maxScale: 0.13, delayS: 0.04 },
  { xOff: 0.06, yOff: 0.38, zOff: 0.09, maxScale: 0.19, delayS: 0.02 },
  { xOff: -0.10, yOff: 0.06, zOff: 0.13, maxScale: 0.11, delayS: 0.06 },
  { xOff: 0.18, yOff: 0.30, zOff: -0.10, maxScale: 0.15, delayS: 0.03 },
];

const CORE_COLOR = new THREE.Color(0xedf8ff);
const MID_COLOR = new THREE.Color(0x9adcff);
const EDGE_COLOR = new THREE.Color(0x4cb8e8);

type FrostLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type IceShard = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly geometry: THREE.BufferGeometry;
  readonly maxScale: number;
  readonly delayS: number;
};

export function buildIceRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const frostGeometry = new THREE.PlaneGeometry(1, 1);
  const seed = Math.random() * 1000;

  const layers: FrostLayer[] = ICE_LAYERS.map((cfg, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: ICE_VERTEX,
      fragmentShader: ICE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uSeed: { value: seed + index * 23.11 },
        uColorCore: { value: CORE_COLOR.clone() },
        uColorMid: { value: MID_COLOR.clone().multiplyScalar(cfg.opacity) },
        uColorEdge: { value: EDGE_COLOR.clone().multiplyScalar(cfg.opacity) },
      },
    });
    const mesh = new THREE.Mesh(frostGeometry, material);
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
    ELEMENT_LIGHT_COLOR.ice,
    ELEMENT_LIGHT_INTENSITY.ice,
    ELEMENT_LIGHT_DISTANCE.ice,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  const shards: IceShard[] = ICE_SHARDS.map((cfg) => {
    const geometry = new THREE.OctahedronGeometry(1, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0xc8eeff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      effect.targetPosition.x + cfg.xOff,
      effect.targetPosition.y + cfg.yOff,
      effect.targetPosition.z + cfg.zOff,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.scale.setScalar(0);
    scene.add(mesh);
    return { mesh, material, geometry, maxScale: cfg.maxScale, delayS: cfg.delayS };
  });

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
      const bloomP = layerP * 2.0;
      const bloomEnv = bloomP < 1.0 ? bloomP : 2.0 - bloomP;
      const scale = layer.baseScale + Math.max(0, bloomEnv) * layer.growScale;
      layer.mesh.scale.set(scale, scale, 1);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    for (const shard of shards) {
      const shardP = Math.max(0, Math.min(1, (elapsed - shard.delayS) / (dur * 0.65 - shard.delayS)));
      const formP = Math.min(1, shardP * 2.5);
      const shatterP = Math.max(0, (shardP - 0.6) / 0.4);
      const scaleEnv = formP * (1.0 - shatterP * shatterP);
      shard.mesh.scale.setScalar(shard.maxScale * Math.max(0, scaleEnv));
      shard.material.opacity = Math.max(0, 1.0 - shatterP * 1.5) * 0.8;
      shard.mesh.rotation.y += dtS * 1.2;
    }

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.ice * lightPulse;

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
    frostGeometry.dispose();
    for (const shard of shards) {
      scene.remove(shard.mesh);
      shard.material.dispose();
      shard.geometry.dispose();
    }
    scene.remove(light);
  };

  return { tick, dispose };
}
