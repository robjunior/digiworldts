import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR, ELEMENT_LIGHT_DISTANCE, ELEMENT_LIGHT_INTENSITY } from './types';

const ROCK_PALETTE: readonly THREE.Color[] = [
  new THREE.Color(0x8b5a3c),
  new THREE.Color(0x6b4020),
  new THREE.Color(0x4a2c14),
  new THREE.Color(0x7a4a30),
];

const ROCK_CONFIGS: ReadonlyArray<{
  readonly scale: number;
  readonly spreadX: number;
  readonly spreadZ: number;
  readonly riseHeight: number;
  readonly colorIdx: number;
  readonly delayS: number;
  readonly spinX: number;
  readonly spinZ: number;
}> = [
  { scale: 0.22, spreadX:  0.00, spreadZ:  0.00, riseHeight: 1.00, colorIdx: 0, delayS: 0.00, spinX:  1.8, spinZ:  2.1 },
  { scale: 0.16, spreadX:  0.28, spreadZ:  0.10, riseHeight: 0.82, colorIdx: 1, delayS: 0.04, spinX: -2.4, spinZ:  1.5 },
  { scale: 0.19, spreadX: -0.30, spreadZ:  0.15, riseHeight: 0.90, colorIdx: 2, delayS: 0.06, spinX:  2.0, spinZ: -1.8 },
  { scale: 0.13, spreadX:  0.48, spreadZ: -0.20, riseHeight: 0.70, colorIdx: 3, delayS: 0.08, spinX: -1.5, spinZ:  2.8 },
  { scale: 0.15, spreadX: -0.46, spreadZ:  0.28, riseHeight: 0.75, colorIdx: 0, delayS: 0.10, spinX:  3.0, spinZ: -2.2 },
  { scale: 0.20, spreadX:  0.14, spreadZ: -0.32, riseHeight: 0.88, colorIdx: 1, delayS: 0.12, spinX: -1.2, spinZ:  1.6 },
  { scale: 0.11, spreadX: -0.20, spreadZ: -0.14, riseHeight: 0.62, colorIdx: 2, delayS: 0.14, spinX:  2.5, spinZ: -3.0 },
];

type Rock = {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshLambertMaterial;
  readonly startY: number;
  readonly riseHeight: number;
  readonly delayS: number;
  readonly spinX: number;
  readonly spinZ: number;
};

export function buildEarthRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const dur = effect.durationS > 0 ? effect.durationS : DEFAULT_EFFECT_DURATION_S;

  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);

  const rocks: Rock[] = ROCK_CONFIGS.map((cfg) => {
    const color = ROCK_PALETTE[cfg.colorIdx]!;
    const material = new THREE.MeshLambertMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(rockGeometry, material);
    const startY = effect.targetPosition.y - 0.18;
    mesh.scale.setScalar(cfg.scale);
    mesh.position.set(
      effect.targetPosition.x + cfg.spreadX,
      startY,
      effect.targetPosition.z + cfg.spreadZ,
    );
    mesh.rotation.x = Math.random() * Math.PI * 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    scene.add(mesh);
    return { mesh, material, startY, riseHeight: cfg.riseHeight, delayS: cfg.delayS, spinX: cfg.spinX, spinZ: cfg.spinZ };
  });

  const dustGeometry = new THREE.PlaneGeometry(1.4, 0.4);
  const dustMaterial = new THREE.MeshBasicMaterial({
    color: 0xa88060,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const dustMesh = new THREE.Mesh(dustGeometry, dustMaterial);
  dustMesh.position.set(effect.targetPosition.x, effect.targetPosition.y + 0.08, effect.targetPosition.z);
  scene.add(dustMesh);

  const light = new THREE.PointLight(
    ELEMENT_LIGHT_COLOR.earth,
    ELEMENT_LIGHT_INTENSITY.earth,
    ELEMENT_LIGHT_DISTANCE.earth,
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

    for (const rock of rocks) {
      const rockP = Math.max(0, Math.min(1, (elapsed - rock.delayS) / (dur * 0.55)));
      const rise = 1 - Math.pow(1 - rockP, 3);
      rock.mesh.position.y = rock.startY + rock.riseHeight * rise;
      rock.mesh.rotation.x += rock.spinX * dtS;
      rock.mesh.rotation.z += rock.spinZ * dtS;
      const fade = 1 - Math.pow(Math.max(0, (p - 0.45) / 0.55), 1.6);
      rock.material.opacity = Math.min(1, rise * 1.5) * Math.max(0, fade);
    }

    const dustGate = Math.max(0, Math.min(1, (p - 0.15) / 0.15));
    const dustFade = 1 - Math.pow(p, 1.4);
    dustMaterial.opacity = dustGate * dustFade * 0.62;
    dustMesh.quaternion.copy(cameraQuat);

    const lightPulse = Math.sin(Math.min(1, p * 2.5) * Math.PI);
    light.intensity = ELEMENT_LIGHT_INTENSITY.earth * lightPulse;

    if (!impactFired && elapsed >= 0.2) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const rock of rocks) {
      scene.remove(rock.mesh);
      rock.material.dispose();
    }
    rockGeometry.dispose();
    scene.remove(dustMesh);
    dustGeometry.dispose();
    dustMaterial.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}
