import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const SLASH_CONFIGS: ReadonlyArray<{
  readonly angle: number;
  readonly width: number;
  readonly height: number;
  readonly haloColor: number;
  readonly coreColor: number;
  readonly startAt: number;
}> = [
  { angle: Math.PI * 0.15,  width: 1.40, height: 0.050, haloColor: 0xc8d0d8, coreColor: 0xffffff, startAt: 0.12 },
  { angle: Math.PI * -0.20, width: 1.30, height: 0.050, haloColor: 0xb8c4d4, coreColor: 0xe8f0ff, startAt: 0.16 },
  { angle: Math.PI * 0.55,  width: 1.20, height: 0.045, haloColor: 0xa0b0c8, coreColor: 0xd0e4ff, startAt: 0.20 },
];

type Slash = {
  readonly haloMesh: THREE.Mesh;
  readonly haloMaterial: THREE.MeshBasicMaterial;
  readonly coreMesh: THREE.Mesh;
  readonly coreMaterial: THREE.MeshBasicMaterial;
  readonly rotQ: THREE.Quaternion;
  readonly startAt: number;
};

type SparkState = {
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
};

const SPARK_COUNT = 28;

export function buildSteelRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;

  const slashHaloGeometry = new THREE.PlaneGeometry(1, 1);
  const slashCoreGeometry = new THREE.PlaneGeometry(1, 1);

  const slashCenter = effect.targetPosition.clone().add(new THREE.Vector3(0, 0.6, 0));

  const slashes: Slash[] = SLASH_CONFIGS.map((cfg) => {
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: cfg.haloColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const haloMesh = new THREE.Mesh(slashHaloGeometry, haloMaterial);
    haloMesh.scale.set(cfg.width, cfg.height, 1);
    haloMesh.position.copy(slashCenter);
    scene.add(haloMesh);

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: cfg.coreColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(slashCoreGeometry, coreMaterial);
    coreMesh.scale.set(cfg.width, cfg.height * 0.4, 1);
    coreMesh.position.copy(slashCenter);
    scene.add(coreMesh);

    const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), cfg.angle);

    return { haloMesh, haloMaterial, coreMesh, coreMaterial, rotQ, startAt: cfg.startAt };
  });

  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkStates: SparkState[] = [];

  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
    const speed = 1.0 + Math.random() * 2.5;
    sparkStates.push({
      vx: Math.cos(angle) * Math.cos(pitch) * speed,
      vy: Math.abs(Math.sin(pitch)) * speed,
      vz: Math.sin(angle) * Math.cos(pitch) * speed,
      age: Math.random() * 0.3,
      life: 0.3 + Math.random() * 0.25,
    });
    sparkPositions[i * 3]     = slashCenter.x;
    sparkPositions[i * 3 + 1] = slashCenter.y;
    sparkPositions[i * 3 + 2] = slashCenter.z;
  }

  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPosAttr = new THREE.BufferAttribute(sparkPositions, 3);
  sparkGeometry.setAttribute('position', sparkPosAttr);

  const sparkMaterial = new THREE.PointsMaterial({
    color: 0xffe0a8,
    size: 0.06,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
  scene.add(sparkPoints);

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.steel,
    ELEMENT_LIGHT_INTENSITY.steel,
    ELEMENT_LIGHT_DISTANCE.steel,
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
    const fade = 1 - Math.pow(p, 1.5);

    for (const slash of slashes) {
      const slashElapsed = Math.max(0, elapsed - slash.startAt);
      const flashP = Math.min(1, slashElapsed / 0.26);
      const falloff = Math.max(0, 1 - Math.max(0, slashElapsed - 0.26) / 0.4);
      const alpha = flashP * falloff * fade;
      slash.haloMaterial.opacity = alpha * 0.7;
      slash.coreMaterial.opacity = alpha;
      slash.haloMesh.quaternion.copy(cameraQuat).multiply(slash.rotQ);
      slash.coreMesh.quaternion.copy(cameraQuat).multiply(slash.rotQ);
    }

    for (let i = 0; i < SPARK_COUNT; i++) {
      const s = sparkStates[i]!;
      s.age += dtS;
      if (s.age >= s.life) {
        const angle = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
        const speed = 1.0 + Math.random() * 2.5;
        s.vx = Math.cos(angle) * Math.cos(pitch) * speed;
        s.vy = Math.abs(Math.sin(pitch)) * speed;
        s.vz = Math.sin(angle) * Math.cos(pitch) * speed;
        s.age = 0;
        s.life = 0.3 + Math.random() * 0.25;
        sparkPositions[i * 3]     = slashCenter.x;
        sparkPositions[i * 3 + 1] = slashCenter.y;
        sparkPositions[i * 3 + 2] = slashCenter.z;
      } else {
        sparkPositions[i * 3]     = (sparkPositions[i * 3]     ?? 0) + s.vx * dtS;
        sparkPositions[i * 3 + 1] = (sparkPositions[i * 3 + 1] ?? 0) + s.vy * dtS;
        sparkPositions[i * 3 + 2] = (sparkPositions[i * 3 + 2] ?? 0) + s.vz * dtS;
      }
    }
    sparkPosAttr.needsUpdate = true;

    const sparkGate = Math.max(0, Math.min(1, (p - 0.15) / 0.15));
    sparkMaterial.opacity = sparkGate * fade * 0.9;

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.steel * lightPulse;

    if (!impactFired && elapsed >= 0.15) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const slash of slashes) {
      scene.remove(slash.haloMesh);
      slash.haloMaterial.dispose();
      scene.remove(slash.coreMesh);
      slash.coreMaterial.dispose();
    }
    slashHaloGeometry.dispose();
    slashCoreGeometry.dispose();
    scene.remove(sparkPoints);
    sparkGeometry.dispose();
    sparkMaterial.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
