import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C2 } from './html-fx/pool';

/**
 * Holy Smite — faithful port of the reference HTML `smite()`.
 *
 * A divine light-fall phase (~0.35 s) showers motes from above, then a white-
 * gold beam + core thrams descending and ground rings expand with rising
 * motes, ending at T >= 1.9 s.
 */
export function buildHolySmiteRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const P = new Pool(scene, 2500);
  const b = effect.targetPosition.clone();

  const light = new THREE.PointLight(0xfff0c0, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0xfff0c0);
      light.intensity = i;
    }
  };

  const G = C2.gd;
  const G2 = C2.gd2;
  const W = C2.wh;

  const mk = (col: number, r: number): { m: THREE.Mesh; mat: THREE.MeshBasicMaterial } => {
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 16, 32, 1, true), mat);
    m.position.set(b.x, b.y + 8, b.z);
    scene.add(m);
    return { m, mat };
  };
  const beam = mk(0xffe9a0, 0.9);
  const core = mk(0xffffff, 0.35);

  const ringMatA = new THREE.MeshBasicMaterial({
    color: 0xffe9a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ringMatB = new THREE.MeshBasicMaterial({
    color: 0xffe9a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rings: Array<{ m: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  const ringMats = [ringMatA, ringMatB];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), ringMats[i]!);
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.x, b.y, b.z);
    scene.add(m);
    rings.push({ m, mat: ringMats[i]! });
  }

  let T = 0;
  let fired = false;
  let done = false;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;

    if (T < 0.35) {
      for (let i = cnt(120, dtS); i--;) {
        P.emit(b.x + rnd() * 0.8, b.y + rand(6, 12), b.z + rnd() * 0.8,
          0, -14, 0, 0.4, 0.15, 0.05, W, G);
      }
      flashLight(2, b.x, b.y + 3, b.z);
    }
    if (T >= 0.35 && !fired) {
      fired = true;
      if (!impactFired) {
        impactFired = true;
        effect.onImpact?.();
      }
      burst(P, b.x, b.y + 0.3, b.z, 90, 6, 0.8, 0.2, 0.03, W, G2, -2, 1, 3);
    }

    if (!done) {
      const on = T < 0.35 ? 0 : Math.min(1, (T - 0.35) / 0.08);
      const off = T > 1.2 ? Math.max(0, 1 - (T - 1.2) / 0.7) : 1;
      const k = on * off;
      const w = (0.5 + 0.5 * on) * (1 - 0.4 * (1 - off)) * (1 + 0.06 * Math.sin(T * 35));
      beam.m.scale.set(w, 1, w);
      core.m.scale.set(w, 1, w);
      beam.mat.opacity = 0.55 * k;
      core.mat.opacity = 0.9 * k;
      rings.forEach(({ m, mat }, i) => {
        const ph = Math.max(0, (T - 0.35 - i * 0.2) / 0.8);
        m.scale.setScalar(0.5 + ph * 4.5);
        mat.opacity = ph > 0 && ph < 1 ? 0.8 * (1 - ph) : 0;
      });
      for (let i = cnt(150 * k, dtS); i--;) {
        const an = Math.random() * 6.28;
        const r = Math.random() * 0.9;
        P.emit(b.x + Math.cos(an) * r, b.y + rand(0, 0.5), b.z + Math.sin(an) * r,
          rnd() * 0.3, rand(2, 5), rnd() * 0.3, rand(0.8, 1.4), rand(0.15, 0.3), 0.02, W, G, 0, 0.3);
      }
      if (k > 0) flashLight(14 * k, b.x, b.y + 3, b.z);
      if (T >= 1.9) {
        done = true;
        [beam, core, ...rings].forEach(({ m, mat }) => {
          scene.remove(m);
          m.geometry.dispose();
          mat.dispose();
        });
      }
    }

    light.intensity = light.intensity > 0.02
      ? light.intensity * Math.exp(-7 * dtS)
      : 0;
    P.update(dtS);
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    if (!done) {
      [beam, core, ...rings].forEach(({ m, mat }) => {
        if (m.parent) scene.remove(m);
        m.geometry.dispose();
        mat.dispose();
      });
    }
    scene.remove(light);
    P.dispose();
  };

  return { tick, dispose };
}