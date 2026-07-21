import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const FIRE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FIRE_FRAGMENT = `
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

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 5; i++) {
      v += amp * noise(p);
      p *= 2.05;
      amp *= 0.55;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float dist = 1.0 - r;
    vec2 flowUv = vec2(uv.x * 2.0, uv.y * 2.5 - uTime * 1.6);
    float n = fbm(flowUv);
    float shape = smoothstep(0.05, 0.8, dist * n * 1.4);
    float rim = smoothstep(0.15, 0.55, dist);
    vec3 col = mix(uColorCool, uColorMid, smoothstep(0.0, 0.6, shape));
    col = mix(col, uColorHot, smoothstep(0.5, 1.0, shape + rim * 0.2));
    float lifecycle = smoothstep(0.0, 0.25, uProgress) * (1.0 - smoothstep(0.6, 1.0, uProgress));
    float alpha = shape * rim * lifecycle * 1.2;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const FIRE_LAYERS: ReadonlyArray<{
  readonly baseScale: number;
  readonly growScale: number;
  readonly yOffset: number;
  readonly zOffset: number;
  readonly opacity: number;
  readonly delayS: number;
}> = [
  { baseScale: 1.6, growScale: 1.3, yOffset: 0.4, zOffset: 0, opacity: 1.0, delayS: 0.0 },
  { baseScale: 2.2, growScale: 1.4, yOffset: 0.9, zOffset: 0.08, opacity: 0.7, delayS: 0.05 },
  { baseScale: 1.2, growScale: 1.2, yOffset: 0.2, zOffset: -0.08, opacity: 0.9, delayS: 0.1 },
];

const HOT_COLOR = new THREE.Color(0xfff2b8);
const MID_COLOR = new THREE.Color(0xff8a3a);
const COOL_COLOR = new THREE.Color(0xd23028);

type FlameLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly baseScale: number;
  readonly growScale: number;
  readonly delayS: number;
};

type Streak = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
};

export function buildFireRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const flameGeometry = new THREE.PlaneGeometry(1, 1);
  const seed = Math.random() * 1000;
  const layers: FlameLayer[] = FIRE_LAYERS.map((cfg, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERTEX,
      fragmentShader: FIRE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uSeed: { value: seed + index * 17.31 },
        uColorHot: { value: HOT_COLOR.clone() },
        uColorMid: { value: MID_COLOR.clone().multiplyScalar(cfg.opacity) },
        uColorCool: { value: COOL_COLOR.clone().multiplyScalar(cfg.opacity) },
      },
    });
    const mesh = new THREE.Mesh(flameGeometry, material);
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
    ELEMENT_LIGHT_COLOR.fire,
    ELEMENT_LIGHT_INTENSITY.fire,
    ELEMENT_LIGHT_DISTANCE.fire,
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  const streakCount = 4;
  const streaks: Streak[] = [];
  const streakGeometry = new THREE.PlaneGeometry(1, 0.06);
  for (let i = 0; i < streakCount; i += 1) {
    const start = effect.sourcePosition.clone();
    start.y += 0.9 + Math.random() * 0.4;
    const end = effect.targetPosition.clone();
    end.y += 0.5 + Math.random() * 0.6;
    end.x += (Math.random() - 0.5) * 0.6;
    end.z += (Math.random() - 0.5) * 0.6;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffb060,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(streakGeometry, material);
    scene.add(mesh);
    streaks.push({ mesh, material, start, end });
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
      layer.mesh.scale.set(scale, scale * 1.4, 1);
      layer.mesh.quaternion.copy(cameraQuat);
    }

    for (let i = 0; i < streaks.length; i += 1) {
      const streak = streaks[i]!;
      const delay = 0.02 + i * 0.05;
      const streakP = Math.max(0, Math.min(1, (elapsed - delay) / 0.35));
      if (streakP <= 0 || streakP >= 1) {
        streak.material.opacity = 0;
        continue;
      }
      const head = new THREE.Vector3().lerpVectors(streak.start, streak.end, Math.min(1, streakP * 1.2));
      const tail = new THREE.Vector3().lerpVectors(streak.start, streak.end, Math.max(0, streakP - 0.2));
      const mid = tail.clone().add(head).multiplyScalar(0.5);
      const dir = head.clone().sub(tail);
      const length = dir.length();
      streak.mesh.position.copy(mid);
      streak.mesh.scale.set(length, 1, 1);
      streak.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
      streak.material.opacity = (1 - streakP) * 0.85;
    }

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.fire * lightPulse;

    if (!impactFired && elapsed >= 0.15) {
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
    flameGeometry.dispose();
    for (const streak of streaks) {
      scene.remove(streak.mesh);
      streak.material.dispose();
    }
    streakGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
