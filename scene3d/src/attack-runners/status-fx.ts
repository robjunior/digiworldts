import * as THREE from 'three';
import type { Ailment } from '@digiworld/shared/digimon';
import { Pool, burst, cnt, rand, rnd, makePath, draw, V, C, C2, rgb } from './html-fx/pool';

/**
 * Accumulated per-unit body tint; the unit tint overlay reads it each frame.
 * The ENV's own `tint`/`addTint` are what the runtime drives (this module-level
 * singleton mirrors the reference HTML's `tint` for parity / future wiring).
 */
const tint = new THREE.Color();

export type StatusFxEnv = {
  readonly scene: THREE.Scene;
  /** Additive pool shared by status particles. */
  readonly pool: Pool;
  /** Normal-blend pool (bleed droplets, spill). */
  readonly dPool: Pool;
  /** Accumulated tint; the caller reads .r/.g/.b each frame. */
  readonly tint: THREE.Color;
  readonly addTint: (r: number, g: number, b: number) => void;
  /** Push the unit's screen-shake amplitude up (0..1). */
  readonly shake: (s: number) => void;
  /** Lean the unit (used by sleep tilt, confusion sway). */
  readonly lean: (amount: number) => void;
  /** Set/raise a global 'dim' scalar (curse darkens the arena). */
  readonly dim: (v: number) => void;
  /** Point-light flash helper mirroring the HTML flash(). */
  readonly flash: (c: number, i: number, x: number, y: number, z: number) => void;
  /** Live anchor position that follows the unit each frame (replaces the HTML's hardcoded TX=4.2). */
  readonly anchor: () => THREE.Vector3;
  /** Spawn a floating emoji icon above the unit. */
  readonly icon: (face: string) => void;
};

export type StatusEffect = {
  upd(dt: number, t: number): void;
  end?(): void;
};

export type StatusKind = Ailment;

/**
 * Emoji face per built status. `bleed` is not a member of this system's `Ailment`
 * union (it is ported for fidelity), so it is attached after the strict-typed map.
 */
export const STATUS_IMAGES: Partial<Record<Ailment, string>> = {
  burn: '🔥',
  stun: '⚡',
  freeze: '🧊',
  poison: '☠️',
  sleep: '💤',
  confusion: '💫',
  curse: '👿',
};
(STATUS_IMAGES as Record<string, string | undefined>)['bleed'] = '🩸';

// Reference palettes for the status section (verbatim from the HTML).
const WH = C2.wh; // [1,1,1]
const PUR = C2.pur; // rgb(0xb060ff)
const PUR2 = C2.pur2; // rgb(0x4a10a0)
const PG0: [number, number, number] = [0.5, 1, 0.2];
const PG1: [number, number, number] = [0.1, 0.3, 0.1];
const BL0: [number, number, number] = [0.75, 0.02, 0.05];
const BL1: [number, number, number] = [0.3, 0, 0.02];

type StatusBuilder = (env: StatusFxEnv) => StatusEffect;

// ---------------------------------------------------------------------------
// burn
// ---------------------------------------------------------------------------
function buildBurn(env: StatusFxEnv): StatusEffect {
  return {
    upd(dt, t) {
      const A = env.anchor();
      env.addTint(0.45 * (0.6 + 0.4 * Math.sin(t * 20)), 0.12, 0);
      for (let i = cnt(60, dt); i--; ) {
        env.pool.emit(
          A.x + rnd() * 0.5, rand(0.2, 2.2), rnd() * 0.5,
          rnd() * 0.3, rand(1, 2.2), rnd() * 0.3,
          rand(0.4, 0.8), 0.45, 0.05,
          i % 4 ? C.org : C.yel, C.red, 1, 1,
        );
      }
      env.flash(0xff7a20, 1.2, A.x, 1.2, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// freeze
// ---------------------------------------------------------------------------
function buildFreeze(env: StatusFxEnv): StatusEffect {
  const A0 = env.anchor();
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.3, 0),
    new THREE.MeshStandardMaterial({
      color: 0x9be7ff,
      emissive: 0x2a9dff,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.55,
      flatShading: true,
      roughness: 0.1,
    }),
  );
  m.position.set(A0.x, 1.25, 0);
  m.scale.set(0, 0, 0);
  env.scene.add(m);
  return {
    upd(dt, t) {
      const A = env.anchor();
      m.position.x = A.x;
      const e = 1 - Math.pow(1 - Math.min(1, t / 0.25), 3);
      m.scale.set(e, 1.45 * e, e);
      env.addTint(0.05, 0.25, 0.5);
      for (let i = cnt(30, dt); i--; ) {
        env.pool.emit(A.x + rnd() * 0.9, rand(0.2, 2.8), rnd() * 0.9, 0, rand(0.1, 0.4), 0, 0.8, 0.08, 0.02, WH, C.ice);
      }
      for (let i = cnt(30, dt); i--; ) {
        env.pool.emit(A.x + rnd() * 1.2, 0.15, rnd() * 1.2, rnd() * 0.4, rand(0.1, 0.4), rnd() * 0.4, 1, 1, 1.8, C.mist, C.mist, 0, 0.5);
      }
    },
    end() {
      const A = env.anchor();
      burst(env.pool, A.x, 1.3, 0, 120, 6, 0.9, 0.16, 0.03, WH, C.ice2, -7, 0.8, 1);
      env.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// para -> stun
// ---------------------------------------------------------------------------
function buildPara(env: StatusFxEnv): StatusEffect {
  return {
    upd(dt) {
      const A = env.anchor();
      const f = Math.random() > 0.5 ? 1 : 0.2;
      env.addTint(0.4 * f, 0.35 * f, 0);
      env.shake(Math.random() < 0.5 ? 0.7 : 0.15);
      if (Math.random() < dt * 14) {
        draw(
          env.pool,
          makePath(V(A.x, rand(0.3, 2.4), 0), V(A.x + rnd() * 1.2, rand(0, 2.8), rnd() * 1.2), 4, 0.25),
          0.12, 0.07, C.spark, C.org,
        );
      }
      for (let i = cnt(20, dt); i--; ) {
        env.pool.emit(
          A.x + rnd() * 0.5, rand(0.2, 2.4), rnd() * 0.5,
          rnd() * 3, rnd() * 3, rnd() * 3,
          0.2, 0.1, 0.02, C.spark, C.org, -4,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// poison
// ---------------------------------------------------------------------------
function buildPoison(env: StatusFxEnv): StatusEffect {
  return {
    upd(dt, t) {
      const A = env.anchor();
      env.addTint(0, 0.3 * (0.6 + 0.4 * Math.sin(t * 4)), 0);
      for (let i = cnt(40, dt); i--; ) {
        env.pool.emit(A.x + rnd() * 0.5, rand(0.2, 2), rnd() * 0.5, rnd() * 0.2, rand(0.4, 1), rnd() * 0.2, rand(0.7, 1.2), 0.16, 0.04, PG0, PG1, 0, 0.3);
      }
      for (let i = cnt(12, dt); i--; ) {
        env.pool.emit(A.x + rnd() * 0.6, rand(0.6, 1.8), rnd() * 0.6, 0, 0, 0, 0.6, 0.14, 0.05, PG0, PG1, -6);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------
function buildSleep(env: StatusFxEnv): StatusEffect {
  const zs: { sp: THREE.Sprite; a: number }[] = [];
  let acc = 0;
  let tex: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    if (x) {
      x.font = 'bold 56px sans-serif';
      x.fillStyle = '#bfe0ff';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('Z', 32, 34);
      tex = new THREE.CanvasTexture(c);
    }
  }
  return {
    upd(dt) {
      const A = env.anchor();
      env.lean(0.32);
      env.addTint(0, 0.03, 0.1);
      acc += dt;
      if (acc > 0.9) {
        acc = 0;
        if (tex) {
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
          );
          sp.renderOrder = 10;
          env.scene.add(sp);
          zs.push({ sp, a: 0 });
        }
      }
      for (let i = zs.length - 1; i >= 0; i--) {
        const z = zs[i]!;
        z.a += dt;
        z.sp.position.set(A.x + 0.5 + Math.sin(z.a * 3) * 0.15 + z.a * 0.2, 2.5 + z.a * 0.8, 0);
        z.sp.scale.setScalar(0.35 + z.a * 0.25);
        (z.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - z.a / 2);
        if (z.a > 2) {
          env.scene.remove(z.sp);
          (z.sp.material as THREE.Material).dispose();
          zs.splice(i, 1);
        }
      }
    },
    end() {
      for (const z of zs) {
        env.scene.remove(z.sp);
        (z.sp.material as THREE.Material).dispose();
      }
      tex?.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// confuse -> confusion
// ---------------------------------------------------------------------------
function buildConfuse(env: StatusFxEnv): StatusEffect {
  return {
    upd(dt, t) {
      const A = env.anchor();
      env.lean(Math.sin(t * 3) * 0.18);
      for (let i = 0; i < 4; i++) {
        const a = t * 5 + i * 1.57;
        env.pool.emit(
          A.x + Math.cos(a) * 0.65, 2.55 + 0.08 * Math.sin(t * 8 + i), Math.sin(a) * 0.65,
          0, 0, 0, 0.12, 0.22, 0.05, C.yel, C.org,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// bleed (no Ailment alias on this system; ported for fidelity / reachable via 'bleed')
// ---------------------------------------------------------------------------
function buildBleed(env: StatusFxEnv): StatusEffect {
  let acc = 0;
  return {
    upd(dt) {
      const A = env.anchor();
      acc += dt;
      env.addTint(0.12, 0, 0);
      for (let i = cnt(30, dt); i--; ) {
        env.dPool.emit(
          A.x + rnd() * 0.5, rand(0.4, 1.8), rnd() * 0.5,
          rnd() * 0.3, rand(0, 0.8), rnd() * 0.3,
          rand(0.5, 0.9), 0.14, 0.05, BL0, BL1, -9, 0,
        );
      }
      if (acc > 0.9) {
        acc = 0;
        // HTML `hit(.15)` map to a small screen-shake nudge.
        env.shake(0.15);
        env.addTint(0.3, 0, 0);
        for (let i = 0; i < 25; i++) {
          env.dPool.emit(
            A.x + rnd() * 0.4, rand(0.8, 1.6), rnd() * 0.4,
            rnd() * 2, rand(0, 2), rnd() * 2,
            0.7, 0.16, 0.06, BL0, BL1, -9, 0,
          );
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// curse
// ---------------------------------------------------------------------------
function buildCurse(env: StatusFxEnv): StatusEffect {
  const A0 = env.anchor();
  const mk = (a: number, b: number, n: number): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(a, b, n),
      new THREE.MeshBasicMaterial({
        color: 0xb060ff,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(A0.x, 0.06, 0);
    env.scene.add(m);
    return m;
  };
  const r1 = mk(0.95, 1.05, 48);
  const r2 = mk(0.55, 0.62, 6);
  const r3 = mk(1.2, 1.24, 48);
  const rings: THREE.Mesh[] = [r1, r2, r3];
  return {
    upd(dt, t) {
      const A = env.anchor();
      const g = Math.min(1, t / 0.4);
      for (const m of rings) m.scale.setScalar(g);
      r2.rotation.z += dt * 1.5;
      r1.rotation.z -= dt * 0.8;
      for (const m of rings) m.position.x = A.x;
      env.addTint(0.2, 0, 0.3);
      env.dim(0.35);
      for (let i = cnt(35, dt); i--; ) {
        const a = Math.random() * 6.28;
        const r = rand(0.3, 1);
        env.pool.emit(
          A.x + Math.cos(a) * r, 0.1, Math.sin(a) * r,
          0, rand(0.8, 1.8), 0,
          rand(0.8, 1.4), 0.2, 0.04, PUR, PUR2, 0, 0.3,
        );
      }
    },
    end() {
      for (const m of rings) {
        env.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Neutral placeholder for ailments with no dedicated visual (must not throw).
// ---------------------------------------------------------------------------
function buildPlaceholder(env: StatusFxEnv): StatusEffect {
  return {
    upd(dt) {
      const A = env.anchor();
      for (let i = cnt(8, dt); i--; ) {
        env.pool.emit(
          A.x + rnd() * 0.8, rand(0.4, 2.2), rnd() * 0.8,
          0, rand(0.1, 0.4), 0,
          rand(0.8, 1.4), 0.1, 0.02, C2.nl0, C2.nl1, 0, 0.3,
        );
      }
    },
  };
}

const BUILDERS: Record<string, StatusBuilder> = {
  burn: buildBurn,
  freeze: buildFreeze,
  stun: buildPara,
  poison: buildPoison,
  sleep: buildSleep,
  confusion: buildConfuse,
  curse: buildCurse,
  // 'bleed' has no Ailment alias on this system; kept reachable for fidelity.
  bleed: buildBleed,
};

/**
 * Build a persistent status effect for an ailment, or a neutral placeholder for
 * ailments that have no dedicated visual. Never throws.
 */
export function buildStatusEffect(env: StatusFxEnv, kind: Ailment): StatusEffect | null {
  const face = STATUS_IMAGES[kind];
  if (face) env.icon(face);
  const builder = BUILDERS[kind];
  return builder ? builder(env) : buildPlaceholder(env);
}

/** The HTML's cleanse(): clear all + a rising white/gold burst. */
export function cleanseStatuses(env: StatusFxEnv): void {
  const A = env.anchor();
  for (let i = 0; i < 120; i++) {
    env.pool.emit(
      A.x + rnd() * 0.7, rand(0, 1), rnd() * 0.7,
      0, rand(2, 5), 0,
      rand(0.8, 1.3), 0.2, 0.03, WH, C2.gd, 0, 0.3,
    );
  }
  env.flash(0xfff0c0, 6, A.x, 2, 0);
}

// Re-export the module tint for parity with the reference (the runtime reads the
// env's own tint; this stands in as the canonical accumulated-tint object).
void tint;