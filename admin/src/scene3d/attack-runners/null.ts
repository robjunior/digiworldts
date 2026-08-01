import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const NULL_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NULL_RING_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uRingR;
  uniform float uOpacity;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    float dist = abs(r - uRingR);
    float ring = 1.0 - smoothstep(0.0, 0.028, dist);
    float alpha = ring * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(0.87, 0.88, 0.92, alpha);
  }
`;

const NULL_BURST_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uOpacity;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;
    float rim = 1.0 - smoothstep(0.2, 1.0, r);
    float alpha = rim * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(0.9, 0.9, 0.94, alpha);
  }
`;

const NULL_GROUND_RINGS: ReadonlyArray<{
  readonly worldScale: number;
  readonly delayS: number;
  readonly peakOpacity: number;
}> = [
  { worldScale: 3.2, delayS: 0.0, peakOpacity: 0.85 },
  { worldScale: 2.4, delayS: 0.1, peakOpacity: 0.55 },
];

type GroundRing = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly delayS: number;
  readonly peakOpacity: number;
};

type BurstLayer = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
};

export function buildNullRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;
  const groundGeometry = new THREE.PlaneGeometry(1, 1);
  const burstGeometry = new THREE.PlaneGeometry(1, 1);

  const rings: GroundRing[] = NULL_GROUND_RINGS.map(cfg => {
    const material = new THREE.ShaderMaterial({
      vertexShader: NULL_VERTEX,
      fragmentShader: NULL_RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uRingR: { value: 0 },
        uOpacity: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(groundGeometry, material);
    mesh.position.set(effect.targetPosition.x, effect.targetPosition.y, effect.targetPosition.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(cfg.worldScale);
    scene.add(mesh);
    return { mesh, material, delayS: cfg.delayS, peakOpacity: cfg.peakOpacity };
  });

  const burstMaterial = new THREE.ShaderMaterial({
    vertexShader: NULL_VERTEX,
    fragmentShader: NULL_BURST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
    },
  });
  const burstMesh = new THREE.Mesh(burstGeometry, burstMaterial);
  burstMesh.position.set(
    effect.targetPosition.x,
    effect.targetPosition.y + 0.8,
    effect.targetPosition.z,
  );
  burstMesh.scale.setScalar(1.2);
  scene.add(burstMesh);
  const burst: BurstLayer = { mesh: burstMesh, material: burstMaterial };

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR['null'],
    ELEMENT_LIGHT_INTENSITY['null'],
    ELEMENT_LIGHT_DISTANCE['null'],
    2,
  );
  light.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.8, effect.targetPosition.z);
  scene.add(light);

  let impactFired = false;
  let elapsed = 0;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS, _elapsedS, cameraQuat) => {
    if (disposed.value) return;
    elapsed += dtS;
    const p = Math.min(1, elapsed / dur);

    for (const ring of rings) {
      const ringP = Math.max(0, Math.min(1, (elapsed - ring.delayS) / (dur - ring.delayS)));
      const eased = 1 - Math.pow(1 - ringP, 2);
      const uRingR = ring.material.uniforms.uRingR;
      const uOpacity = ring.material.uniforms.uOpacity;
      if (uRingR !== undefined) uRingR.value = eased * 0.46;
      if (uOpacity !== undefined) uOpacity.value = (1 - ringP) * ring.peakOpacity;
    }

    const burstT = Math.min(1, elapsed / 0.35);
    const uBurstOpacity = burst.material.uniforms.uOpacity;
    if (uBurstOpacity !== undefined) uBurstOpacity.value = (1 - burstT) * 0.75;
    burst.mesh.scale.setScalar(0.6 + burstT * 1.4);
    burst.mesh.quaternion.copy(cameraQuat);

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY['null'] * lightPulse;

    if (!impactFired && elapsed >= 0.18) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const ring of rings) {
      scene.remove(ring.mesh);
      ring.material.dispose();
    }
    groundGeometry.dispose();
    scene.remove(burst.mesh);
    burst.material.dispose();
    burstGeometry.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
