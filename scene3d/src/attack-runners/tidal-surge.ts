import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C2 } from './html-fx/pool';

/**
 * Tidal Surge — faithful port of the reference HTML `water()`.
 *
 * A water orb flies from the caster to the target (~0.5 s) trailing splash
 * motes, then erupts into a standing translucent surge-sphere with expanding
 * rings, collapsing at the end.
 */
export function buildTidalSurgeRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const P = new Pool(scene, 3600);
  const a = effect.sourcePosition.clone();
  const b = effect.targetPosition.clone();

  const light = new THREE.PointLight(0x3388ff, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (col: number, i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(col);
      light.intensity = i;
    }
  };

  const B0 = C2.wt0;
  const B1 = C2.wt1;
  const W = C2.wh;

  let t = 0;
  let stage = 0;
  let bt = 0;
  let sphGeo: THREE.SphereGeometry | null = null;
  let sphMat: THREE.MeshStandardMaterial | null = null;
  let sph: THREE.Mesh | null = null;
  const rings: Array<{ m: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  let impactFired = false;
  let done = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;

    if (stage === 0) {
      t += dtS;
      const u = Math.min(t / 0.5, 1);
      const h = a.clone().lerp(b, u);
      h.y += Math.sin(u * Math.PI) * 0.8;
      for (let i = cnt(520, dtS); i--;) {
        P.emit(h.x + rnd() * 0.15, h.y + rnd() * 0.15, h.z + rnd() * 0.15,
          rnd(), rnd() * 0.6, rnd(), 0.45, 0.35, 0.12, i % 5 ? B0 : W, B1, -3, 0.5);
      }
      flashLight(0x3388ff, 2.5, h.x, h.y, h.z);
      if (u >= 1) {
        stage = 1;
        burst(P, b.x, b.y, b.z, 220, 6, 0.9, 0.3, 0.08, B0, B1, -9, 0.6, 3);
        if (!impactFired) {
          impactFired = true;
          effect.onImpact?.();
        }
        flashLight(0x66aaff, 8, b.x, b.y, b.z);
        sphGeo = new THREE.SphereGeometry(1.35, 24, 16);
        sphMat = new THREE.MeshStandardMaterial({
          color: 0x3fa0ff,
          emissive: 0x0a3a80,
          emissiveIntensity: 0.5,
          roughness: 0.05,
          transparent: true,
          opacity: 0.42,
        });
        sph = new THREE.Mesh(sphGeo, sphMat);
        sph.position.set(b.x, b.y, b.z);
        sph.scale.setScalar(0.01);
        scene.add(sph);
        for (let i = 0; i < 2; i++) {
          const mat = new THREE.MeshBasicMaterial({
            color: 0x5cb8ff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(b.x, b.y, b.z);
          scene.add(m);
          rings.push({ m, mat });
        }
      }
    } else if (!done) {
      bt += dtS;
      const g = Math.min(1, bt / 0.25);
      const e = 1 - Math.pow(1 - g, 3);
      sph!.scale.set(
        e * (1 + 0.08 * Math.sin(bt * 14)),
        e * (1.15 - 0.08 * Math.sin(bt * 14)),
        e * (1 + 0.08 * Math.cos(bt * 11)),
      );
      rings.forEach(({ m, mat }, i) => {
        const ph = Math.max(0, (bt - i * 0.25) / 0.8);
        m.scale.setScalar(0.5 + ph * 4);
        mat.opacity = ph > 0 && ph < 1 ? 0.7 * (1 - ph) : 0;
      });
      for (let i = cnt(45, dtS); i--;) {
        P.emit(b.x + rnd() * 0.9, b.y + rand(0.5, 2), b.z + rnd() * 0.9,
          0, rand(0.5, 1.5), 0, 0.9, 0.12, 0.05, W, B0);
      }
      for (let i = cnt(30, dtS); i--;) {
        P.emit(b.x + rnd() * 1.1, b.y + 0.4, b.z + rnd() * 1.1,
          0, 0, 0, 0.5, 0.2, 0.08, B0, B1, -9);
      }
      if (bt > 1.3) {
        done = true;
        burst(P, b.x, b.y, b.z, 260, 7, 1, 0.3, 0.08, B0, B1, -9, 0.5, 3);
        if (!impactFired) {
          impactFired = true;
          effect.onImpact?.();
        }
        flashLight(0x66aaff, 9, b.x, b.y, b.z);
        if (sph) scene.remove(sph);
        if (sphGeo) sphGeo.dispose();
        if (sphMat) sphMat.dispose();
        sphGeo = null;
        sphMat = null;
        sph = null;
        rings.forEach(({ m, mat }) => {
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
    if (sph && sph.parent) scene.remove(sph);
    if (sphGeo) sphGeo.dispose();
    if (sphMat) sphMat.dispose();
    rings.forEach(({ m, mat }) => {
      if (m.parent) scene.remove(m);
      m.geometry.dispose();
      mat.dispose();
    });
    scene.remove(light);
    P.dispose();
  };

  return { tick, dispose };
}