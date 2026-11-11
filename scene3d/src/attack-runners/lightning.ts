import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C, V } from './html-fx/pool';

/**
 * Lightning — faithful port of the reference HTML `bolt()` effect.
 *
 * Three sequential lightning strikes from the sky land on the target over
 * ~1.7 s. Each strike fires a ground impact burst, an expanding radial flash
 * of electric sparks, and draws jagged bolt paths (main trunk + 2 branches)
 * plus secondary play arcs across the target area.
 */
export function buildLightningRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const pool = new Pool(scene, 2600);
  const b = effect.targetPosition.clone();

  const light = new THREE.PointLight(0xaac4ff, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0xaac4ff);
      light.intensity = i;
    }
  };

  /** Jagged path from a→b with per-segment jitter (HTML `makePath`). */
  const makePath = (a: THREE.Vector3, bb: THREE.Vector3, segs: number, jit: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const p = a.clone().lerp(bb, u);
      const amp = jit * Math.sin(Math.PI * u) + (i > 0 && i < segs ? 0.05 : 0);
      if (i > 0 && i < segs) {
        p.x += rnd() * amp;
        p.z += rnd() * amp;
        p.y += rnd() * amp * 0.3;
      }
      pts.push(p);
    }
    return pts;
  };

  /** Emit a particle-drawn line along a path (HTML `draw`). */
  const draw = (
    pts: readonly THREE.Vector3[], size: number, life: number,
    c0: readonly [number, number, number], c1: readonly [number, number, number],
  ): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const bb = pts[i + 1]!;
      const n = Math.max(1, Math.ceil(a.distanceTo(bb) / 0.14));
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(bb, k / n);
        pool.emit(p.x, p.y, p.z, 0, 0, 0, life, size, size * 0.3, c0, c1);
      }
    }
  };

  let T = 0;
  let acc = 0;
  let arc = 0;
  let started = 0;
  const ts = [0, 0.3, 0.6];
  let impactFired = false;
  const disposed = { value: false };

  const drawBolt = (): void => {
    const bot = V(b.x, b.y + 2.1, b.z);
    const top = V(b.x + rnd() * 3, b.y + 13, b.z + rnd() * 3);
    const main = makePath(top, bot, 16, 1.1);
    draw(main, 0.5, 0.09, C.el, C.el2);
    draw(main, 0.18, 0.09, C.white, C.el);
    for (let br = 0; br < 2; br++) {
      const s = main[4 + Math.floor(Math.random() * 8)]!;
      const e = s.clone().add(V(rnd() * 3, -rand(2, 5), rnd() * 3));
      const branch = makePath(s, e, 6, 0.5);
      draw(branch, 0.28, 0.08, C.el, C.el2);
      draw(branch, 0.1, 0.08, C.white, C.el);
    }
  };

  const strike = (): void => {
    burst(pool, b.x, b.y + 0.5, b.z, 70, 7, 0.6, 0.12, 0.03, C.spark, C.el2, -9, 0.6, 2);
    for (let i = 0; i < 40; i++) {
      const an = (i / 40) * 6.28;
      pool.emit(b.x, 0.1, b.z, Math.cos(an) * 6, 0, Math.sin(an) * 6, 0.35, 0.4, 0.1, C.el, C.el2, 0, 2);
    }
    flashLight(14, b.x, 3, 0);
    if (!impactFired) {
      impactFired = true;
      effect.onImpact?.();
    }
  };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;
    acc += dtS;
    arc += dtS;

    while (started < 3 && T >= ts[started]!) { started++; strike(); }
    const k = started - 1;
    if (started > 0 && T < ts[k]! + 0.24 && acc > 0.045) {
      acc = 0;
      drawBolt();
      flashLight(5 + Math.random() * 6, b.x, 3, 0);
    }
    if (T < 1.6 && arc > 0.05) {
      arc = 0;
      const e = V(b.x + rnd() * 1.3, rand(0.3, 3), b.z + rnd() * 1.3);
      const play = makePath(V(b.x, b.y + 0.2, b.z), e, 5, 0.35);
      draw(play, 0.16, 0.07, C.white, C.el);
    }

    pool.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    scene.remove(light);
    pool.dispose();
  };

  return { tick, dispose };
}