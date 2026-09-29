import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C } from './html-fx/pool';

/**
 * Ice Lance — faithful port of the reference HTML `lance()` effect.
 *
 * An icy spear flies source→target (0.35 s), pierces, and encases the target
 * in a large growing ice crystal (an additive icosahedron). A block of
 * swirling mist + motes hangs for ~2 s, then the crystal shatters.
 */
export function buildIceLanceRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const pool = new Pool(scene, 2400);
  const a = effect.sourcePosition.clone();
  const b = effect.targetPosition.clone();

  const light = new THREE.PointLight(0x66ccff, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0x66ccff);
      light.intensity = i;
    }
  };

  // --- Flying spear (a cone pointing toward the target) ---
  const spearGeo = new THREE.ConeGeometry(0.12, 1.2, 6);
  spearGeo.rotateZ(-Math.PI / 2);
  const spear = new THREE.Mesh(spearGeo, new THREE.MeshBasicMaterial({ color: 0xcff4ff }));
  scene.add(spear);

  let stage: 0 | 1 = 0;
  let t = 0;
  let bt = 0;
  let block: THREE.Mesh | null = null;
  let blockMat: THREE.MeshStandardMaterial | null = null;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;

    if (stage === 0) {
      t += dtS;
      const u = Math.min(t / 0.35, 1);
      const p = a.clone().lerp(b, u);
      spear.position.copy(p);
      for (let i = cnt(220, dtS); i--;) {
        pool.emit(p.x + rnd() * 0.1, p.y + rnd() * 0.1, p.z + rnd() * 0.1,
          rnd() * 0.5, rnd() * 0.5, rnd() * 0.5, 0.5, 0.35, 0.05, C.white, C.ice2, 0, 2);
      }
      flashLight(3, p.x, p.y, p.z);
      if (u >= 1) {
        stage = 1;
        scene.remove(spear);
        spearGeo.dispose();
        burst(pool, b.x, b.y, b.z, 120, 5, 0.7, 0.3, 0.05, C.white, C.ice2, -2, 1.5);
        flashLight(9, b.x, 1.5, 0);
        if (!impactFired) {
          impactFired = true;
          effect.onImpact?.();
        }
        block = new THREE.Mesh(
                  new THREE.IcosahedronGeometry(1.2, 0),
                  new THREE.MeshStandardMaterial({
                    color: 0x9be7ff,
                    emissive: 0x2a9dff,
                    emissiveIntensity: 0.6,
                    transparent: true,
                    opacity: 0.6,
                    flatShading: true,
                    roughness: 0.1,
                  }),
                );
                blockMat = block.material as THREE.MeshStandardMaterial;
        block.position.set(b.x, b.y + 0.2, b.z);
        block.scale.set(0, 0, 0);
        scene.add(block);
      }
      pool.update(dtS);
      light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
      return;
    }

    // Freeze phase: crystal scales in, mist + motes swirl around it.
    bt += dtS;
    const k = Math.min(1, bt / 0.2);
    const e = 1 - Math.pow(1 - k, 3);
    if (block !== null) block.scale.set(e, 1.4 * e, e);
    for (let i = cnt(70, dtS); i--;) {
      const an = Math.random() * 6.28;
      const r = rand(0.5, 1.4);
      pool.emit(b.x + Math.cos(an) * r, rand(0.1, 2.6), b.z + Math.sin(an) * r,
        rnd() * 0.3, rand(-0.3, 0.3), rnd() * 0.3, rand(0.6, 1.2), 0.6, 1.2, C.mist, C.mist, 0, 0.5);
    }
    for (let i = cnt(25, dtS); i--;) {
      pool.emit(b.x + rnd() * 0.9, rand(0.2, 2.8), b.z + rnd() * 0.9,
        0, rand(0.1, 0.4), 0, 0.8, 0.08, 0.02, C.white, C.ice);
    }
    if (bt > 2 && !disposed.value) {
      burst(pool, b.x, b.y + 0.8, b.z, 160, 6, 0.9, 0.16, 0.03, C.white, C.ice2, -7, 0.8, 1);
      flashLight(8, b.x, 1.5, 0);
      if (block !== null) {
        scene.remove(block);
        block.geometry.dispose();
        blockMat?.dispose();
      }
      disposed.value = true;
      pool.dispose();
      scene.remove(light);
      return;
    }

    pool.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    scene.remove(spear);
    spearGeo.dispose();
    if (block !== null) {
      scene.remove(block);
      block.geometry.dispose();
      blockMat?.dispose();
    }
    scene.remove(light);
    pool.dispose();
  };

  return { tick, dispose };
}