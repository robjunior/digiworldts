import * as THREE from 'three';

import type { AnimatedElement, AttackEffect3D, Runner3D, RunnerBuilder } from './types';
import { Pool, burst, ringOut, slash, makePath, draw, rand, rnd, cnt, V, C, C2 } from './html-fx/pool';

/**
 * Melee (basic attack) — faithful port of the reference HTML `melee()` + `MEL`
 * map + `slash()`.
 *
 * The attacker's lunge/advance is driven by an external movement system, so this
 * runner only plays the FX on a fixed timeline anchored to the source and target
 * positions:
 *
 *   DASH   (T < DA      ): dash trail flows from the caster toward the receiver.
 *   STRIKE (DA..DA+ST   ): once — driver slash arc + per-element impact burst at
 *                          the receiver + onImpact() + a light flash; per-element
 *                          `ext` sustained trail may emit each tick.
 *   RETURN (DA+ST..+RT  ): scene returns the sprite; runner just keeps ticking.
 *
 * Two pools are always allocated: the additive `pool` for the primary FX and a
 * normal-blend `dPool` reused by the dark/rock debris that the HTML spawned
 * inline. Both are disposed with the runner.
 */

/** Dash-up time (approach) before the strike begins. */
const DA = 0.3;
/** Strike window over which the impact/trails play. */
const ST = 0.55;
/** Return time after the strike. */
const RT = 0.4;
/** Full effect duration. */
const TOTAL = DA + ST + RT;

/** The HTML's `dashY` — a small lift arc during the approach. */
const dashArc = (t: number): number => Math.sin(Math.min(t / DA, 1) * Math.PI) * 0.35;

type MeleeConfig = {
  readonly c0: readonly [number, number, number];
  readonly c1: readonly [number, number, number];
  readonly col: number;
  /** One-shot impact burst at the receiver. q is the receiver position. */
  readonly imp: (pool: Pool, dPool: Pool, q: THREE.Vector3) => void;
  /** Optional sustained trail emitted each strike tick. t is strike-local time. */
  readonly ext?: (pool: Pool, dt: number, q: THREE.Vector3, t: number) => void;
};

const MEL: Record<AnimatedElement, MeleeConfig> = {
  fire: {
    c0: C.yel, c1: C.org, col: 0xff7a20,
    imp: (pool, _dPool, q) => {
      burst(pool, q.x, q.y, q.z, 220, 5, 0.8, 1, 0.15, C.yel, C.red, 1.5, 2, 1.5);
    },
    ext: (pool, dt, q, t) => {
      const TX = q.x;
      for (let i = cnt(160 * (1 - t / ST), dt); i--;) {
        pool.emit(TX + rnd() * 0.6, 0.2, rnd() * 0.6, rnd() * 0.3, rand(1.5, 3), rnd() * 0.3, rand(0.5, 0.9), 0.8, 0.1, C.org, C.red, 1.5, 1);
      }
    },
  },
  ice: {
    c0: [1, 1, 1], c1: C.ice2, col: 0x66ccff,
    imp: (pool, _dPool, q) => {
      burst(pool, q.x, q.y, q.z, 160, 5, 0.8, 0.3, 0.04, [1, 1, 1], C.ice2, -3, 1.5);
    },
    ext: (pool, dt, q) => {
      const TX = q.x;
      for (let i = cnt(50, dt); i--;) {
        pool.emit(TX + rnd() * 1.2, rand(0.2, 2), rnd() * 1.2, 0, 0.2, 0, 1, 1, 1.8, C.mist, C.mist, 0, 0.5);
      }
    },
  },
  wind: {
    c0: C.wind, c1: C.wind2, col: 0x88ffcc,
    imp: (pool, _dPool, q) => {
      ringOut(pool, q, 1, 70, 7, 0.5, 0.35, C.wind, C.wind2);
      burst(pool, q.x, q.y, q.z, 50, 5, 0.5, 0.3, 0.05, C.wind, C.wind2, 0, 2);
    },
  },
  electricity: {
    c0: [1, 1, 1], c1: C.el, col: 0x8fb4ff,
    imp: (pool, _dPool, q) => {
      const TX = q.x;
      for (let k = 0; k < 5; k++) {
        draw(pool, makePath(q, V(TX + rnd() * 2.2, rand(0.2, 3), rnd() * 2.2), 6, 0.4), 0.16, 0.1, [1, 1, 1], C.el);
      }
      burst(pool, q.x, q.y, q.z, 60, 7, 0.5, 0.1, 0.03, C.spark, C.el2, -9, 0.6, 2);
    },
    ext: (pool, dt, q) => {
      const TX = q.x;
      if (Math.random() < dt * 25) {
        draw(pool, makePath(V(TX, 1.4, 0), V(TX + rnd() * 1.8, rand(0.2, 3), rnd() * 1.8), 5, 0.3), 0.14, 0.07, [1, 1, 1], C.el);
      }
    },
  },
  dark: {
    c0: C2.pur, c1: C2.pur2, col: 0x8a3cff,
    imp: (pool, dPool, q) => {
      for (let i = 0; i < 150; i++) {
        const d = V(rnd(), rnd(), rnd()).normalize().multiplyScalar(rand(2, 6));
        dPool.emit(q.x, q.y, q.z, d.x, d.y, d.z, rand(0.6, 1.2), 0.9, 1.5, C2.dks, [0, 0, 0], 0, 1.5);
      }
      dPool.update(0);
      burst(pool, q.x, q.y, q.z, 80, 6, 0.7, 0.16, 0.03, C2.pur, C2.pur2, -2, 1);
    },
    ext: () => {},
  },
  light: {
    c0: [1, 1, 1], c1: C2.gd, col: 0xfff0c0,
    imp: (pool, _dPool, q) => {
      const TX = q.x;
      for (let i = 0; i < 130; i++) {
        pool.emit(TX + rnd() * 0.5, rand(0, 1), rnd() * 0.5, 0, rand(4, 9), 0, 0.7, 0.25, 0.03, [1, 1, 1], C2.gd);
      }
      burst(pool, q.x, q.y, q.z, 80, 6, 0.6, 0.2, 0.03, [1, 1, 1], C2.gd2, 0, 2);
    },
  },
  water: {
    c0: C2.wt0, c1: C2.wt1, col: 0x66aaff,
    imp: (pool, _dPool, q) => {
      burst(pool, q.x, q.y, q.z, 240, 7, 1, 0.3, 0.08, C2.wt0, C2.wt1, -9, 0.5, 3);
    },
    ext: (pool, dt, q) => {
      const TX = q.x;
      for (let i = cnt(40, dt); i--;) {
        pool.emit(TX + rnd() * 1.1, rand(0.5, 2), rnd() * 1.1, 0, 0, 0, 0.5, 0.2, 0.08, C2.wt0, C2.wt1, -9);
      }
    },
  },
  steel: {
    c0: C2.st0, c1: C2.st1, col: 0xffe8b0,
    imp: (pool, _dPool, q) => {
      const TX = q.x;
      burst(pool, q.x, q.y, q.z, 60, 5, 0.5, 0.14, 0.02, C.spark, C.org, -9, 0.8);
      for (const sg of [1, -1]) {
        for (let j = 0; j <= 16; j++) {
          const u = j / 16 - 0.5;
          pool.emit(TX + u * 1.9, 1.4 + u * 1.9 * sg, 0.3, 0, 0, 0, 0.2, 0.16, 0.02, [1, 1, 1], C2.st0);
        }
      }
    },
  },
  earth: {
    c0: C2.rd0, c1: C2.rd1, col: 0xffc080,
    imp: (pool, dPool, q) => {
      for (let j = 0; j < 50; j++) {
        const an = Math.random() * 6.28;
        const sp = rand(1, 3.5) * 1.2;
        dPool.emit(q.x, 0.2, q.z, Math.cos(an) * sp, rand(0.3, 1.5), Math.sin(an) * sp, rand(0.8, 1.5), 0.7, 2, C2.rk, C2.rk1, 0, 1.5);
      }
      dPool.update(0);
      burst(pool, q.x, q.y, q.z, 50, 5, 0.7, 0.09, 0.02, C2.rd0, C2.rd1, -10, 0.5, 3);
    },
  },
  null: {
    c0: C2.nl0, c1: C2.nl1, col: 0xffffff,
    imp: (pool, _dPool, q) => {
      ringOut(pool, q, 0.3, 60, 6, 0.45, 0.4, C2.nl0, C2.nl1);
      burst(pool, q.x, q.y, q.z, 140, 6, 0.7, 0.25, 0.04, C2.nl0, C2.nl1, 0, 2);
    },
  },
  plant: {
    c0: C2.gr0, c1: C2.gr1, col: 0x6fff5a,
    imp: (pool, _dPool, q) => {
      burst(pool, q.x, q.y, q.z, 90, 4, 1.3, 0.14, 0.04, C2.gr0, C2.gr1, -2, 1.5, 1.5);
      burst(pool, q.x, q.y, q.z, 60, 4, 1.3, 0.14, 0.04, C2.pk, C.yel, -2, 1.5, 1.5);
    },
    ext: (pool, dt, q) => {
      const TX = q.x;
      for (let i = cnt(40, dt); i--;) {
        pool.emit(TX + rnd(), rand(0.3, 2.5), rnd(), rnd(), rnd(), rnd(), 0.8, 0.14, 0.04, C2.gr0, C2.gr1, -1.5, 0.8);
      }
    },
  },
};

export function buildMeleeRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const sp = MEL[effect.element];
  const pool = new Pool(scene, 2500);
  const dPool = new Pool(scene, 1000, THREE.NormalBlending);

  const source = effect.sourcePosition;
  const target = effect.targetPosition;

  // Horiz direction (source -> target) for the dash trail flow.
  const fwd = target.clone().sub(source);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();

  // Tracking flash of the strike color (sp.col); decays each frame.
  const light = new THREE.PointLight(sp.col, 0, 9, 1.5);
  light.position.set(target.x, target.y + 0.8, target.z);
  scene.add(light);

  let t = 0;
  let struck = false;
  const disposed = { value: false };

  const dashTrail = (dt: number, dashY: number): void => {
    for (let i = cnt(220, dt); i--;) {
      pool.emit(
        source.x - 0.3 + rnd() * 0.3, rand(0.2, 2) + dashY, source.z + rnd() * 0.4,
        fwd.x * 2, rnd() * 0.5, fwd.z * 2,
        0.35, 0.4, 0.05, sp.c0, sp.c1, 0, 2,
      );
    }
  };

  const strike = (): void => {
    // Driver slash arc anchored at the receiver. `slash` already applies the
    // `-0.9` x offset from the HTML (`TX-.9+u*1.5`), so pass the raw target x.
    slash(pool, target.x, sp.c0, sp.c1, 1.5, target.y, target.z);
    // Per-element impact burst at the receiver.
    sp.imp(pool, dPool, target);
    effect.onImpact?.();
    light.intensity = 9;
  };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    t += dtS;
    if (t < DA) {
      dashTrail(dtS, dashArc(t));
    } else if (t < DA + ST) {
      if (!struck) {
        struck = true;
        strike();
      }
      const strikeT = Math.min(t - DA, ST);
      sp.ext?.(pool, dtS, target, strikeT);
    }
    pool.update(dtS);
    dPool.update(dtS);
    light.intensity = light.intensity > 0.03 ? light.intensity * Math.exp(-8 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    pool.dispose();
    dPool.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}

export const MELEE_RUNNERS: Record<AnimatedElement, RunnerBuilder> = {
  fire: buildMeleeRunner,
  water: buildMeleeRunner,
  plant: buildMeleeRunner,
  ice: buildMeleeRunner,
  electricity: buildMeleeRunner,
  earth: buildMeleeRunner,
  steel: buildMeleeRunner,
  wind: buildMeleeRunner,
  light: buildMeleeRunner,
  dark: buildMeleeRunner,
  null: buildMeleeRunner,
};