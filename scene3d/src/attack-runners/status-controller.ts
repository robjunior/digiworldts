import * as THREE from 'three';
import type { SpriteRigApi } from '../sprite-rig';
import { Pool } from './html-fx/pool';
import { buildStatusEffect, cleanseStatuses, type StatusEffect, type StatusFxEnv } from './status-fx';

export type AilmentKind = string;

/** The `hit()`/screen-shake amplitude sink surface the env exposes. */
export type StatusFxTarget = {
  /** Raise the global arena screen-shake amplitude (curse/bleed/para jitter). */
  readonly shake: (s: number) => void;
};

type ActiveStatus = {
  readonly effect: StatusEffect;
  elapsed: number;
};

const MAX_PARTICLES = 4096;

/** Icon sprites hovering above the unit, one slot each; fanned horizontally. */
const ICON_SPACING = 0.62;
const ICON_BASE_Y = 3.15;
const ICON_SIZE = 0.55;

/**
 * Drives the persistent 3D status-effect visuals for one unit. Holds a
 * `StatusEffect` per currently-active ailment, recreated only when the unit's
 * ailment set changes; each effect emits into the shared additive / normal
 * pools and accumulates a body tint which the scene applies to the unit's
 * billboard via `illuminate` (the flat-sprite analog of the reference's
 * dummy emissive tint).
 *
 * The reference anchored everything at a fixed spot on the enemy dummy; here
 * `anchor()` returns the unit's live foot position so the status follows the
 * unit as it moves/lunges. Statuses persist until the ailment is removed, at
 * which point `end()` fires (freeze shatter burst, curse ring removal) and the
 * effect is dropped.
 */
export class StatusFxController {
  private active = new Map<AilmentKind, ActiveStatus>();
  private readonly icons: THREE.Sprite[] = [];
  private readonly tint = new THREE.Color();
  private readonly env: StatusFxEnv;
  private readonly anchorOffset: THREE.Vector3 = new THREE.Vector3();
  private readonly flash: THREE.PointLight;
  private disposedFlag = false;
  private elapsed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pool: Pool,
    private readonly dPool: Pool,
    private readonly sprite: SpriteRigApi,
    private readonly canvas2d: (() => CanvasRenderingContext2D | null) | null,
    private readonly target: StatusFxTarget,
  ) {
    // Tracking light for the statuses' `flash()`; holds the last requested
    // intensity and decays to zero so repeated flashes layer like the original.
    this.flash = new THREE.PointLight(0xffffff, 0, 32, 1.5);
    scene.add(this.flash);
    this.env = {
      scene,
      pool,
      dPool,
      tint: this.tint,
      addTint: (r, g, b) => {
        this.tint.r = Math.max(0, this.tint.r + r);
        this.tint.g = Math.max(0, this.tint.g + g);
        this.tint.b = Math.max(0, this.tint.b + b);
      },
      shake: (s) => this.target.shake(s),
      lean: (_amount) => undefined, // flat billboard: body lean is represented by icon tilt only
      dim: (_v) => undefined, // arena-wide dim is skipped on the fixed arena; curse reads via tint/rings
      flash: (c, i, x, y, z) => {
        this.flash.position.set(x, y, z);
        if (i >= this.flash.intensity) {
          this.flash.color.setHex(c);
          this.flash.intensity = i;
        }
      },
      anchor: () => {
        const p = this.sprite.worldPosition;
        const footY = p.y - this.sprite.spriteSize.y / 2;
        return this.anchorOffset.set(p.x, footY, p.z);
      },
      icon: (face) => this.spawnIcon(face),
    };
  }

  /** Reconcile the active statuses to the passed ailment kinds. */
  sync(kinds: readonly AilmentKind[]): void {
    if (this.disposedFlag) return;
    const want = new Map<AilmentKind, boolean>();
    for (const k of kinds) want.set(k, true);

    // Remove statuses no longer present (fires end()).
    for (const [kind, act] of [...this.active.entries()]) {
      if (!want.has(kind)) {
        this.active.delete(kind);
        act.effect.end?.();
      }
    }
    // Add new statuses.
    for (const kind of kinds) {
      if (!this.active.has(kind)) {
        const effect = buildStatusEffect(this.env, kind as never);
        if (effect) this.active.set(kind, { effect, elapsed: 0 });
      }
    }
  }

  /** Drop every status effect immediately (unit downed / removed). */
  clearAll(): void {
    for (const act of this.active.values()) act.effect.end?.();
    this.active.clear();
    for (const sp of this.icons) {
      this.scene.remove(sp);
      sp.material.dispose();
    }
    this.icons.length = 0;
  }

  /** The HTML's cleanse(): clear all + one white burst at the anchor. */
  cleanse(): void {
    cleanseStatuses(this.env);
    this.clearAll();
  }

  tick(dt: number): void {
    if (this.disposedFlag) return;
    this.elapsed += dt;
    // Rebuild accumulated tint from scratch each frame (each status contributes).
    this.tint.set(0, 0, 0);
    for (const act of this.active.values()) {
      act.effect.upd(dt, this.elapsed);
    }

    // Map accumulated tint onto the unit billboard (emissive-tint analog).
    const mag = this.tint.r + this.tint.g + this.tint.b;
    if (mag > 0.001) {
      this.sprite.illuminate(this.tint, Math.min(1, mag));
    }

    // Decay the tracking flash light toward zero each frame (fireball pattern).
    this.flash.intensity *= Math.max(0, 1 - dt * 3);
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.scene.remove(this.flash);
    this.clearAll();
  }

  private spawnIcon(face: string): void {
    if (this.canvas2d === null) return;
    const ctx = this.canvas2d();
    if (ctx === null) return;
    const c = ctx.canvas;
    c.width = c.height = 128;
    ctx.font = '96px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sp.renderOrder = 10;
    sp.scale.set(ICON_SIZE, ICON_SIZE, 1);
    // Position above+behind existing icons; latest icon sits right of the pack.
    const slot = this.icons.length;
    const A = this.env.anchor();
    sp.position.set(
      A.x + (slot - (this.icons.length - 1) / 2) * ICON_SPACING,
      A.y + ICON_BASE_Y,
      0,
    );
    this.scene.add(sp);
    this.icons.push(sp);
  }

  /** Keep floating icons hovering over the (moving) unit each frame. */
  tickIcons(): void {
    if (this.icons.length === 0) return;
    const A = this.env.anchor();
    const n = this.icons.length;
    for (let i = 0; i < n; i++) {
      const sp = this.icons[i]!;
      sp.position.set(
        A.x + (i - (n - 1) / 2) * ICON_SPACING,
        A.y + ICON_BASE_Y,
        sp.position.z,
      );
    }
  }
}

/** Build the shared additive + normal particle pools used by all status FX. */
export function createStatusPools(scene: THREE.Scene): [Pool, Pool] {
  const pool = new Pool(scene, MAX_PARTICLES); // additive (default)
  const dPool = new Pool(scene, MAX_PARTICLES, THREE.NormalBlending);
  return [pool, dPool];
}