/**
 * CameraDirector — pure, headless camera tweening for the combat scene.
 *
 * The SceneManager owns a `CameraDirector` and feeds it a stream of target
 * framings (idle / focus-a-unit / follow-a-cast) each tick. The director eases
 * the live camera basis (`CameraTarget`) toward the latest target with an
 * ease-in-out cubic; callers read `.target` every frame to position the
 * camera. Kept independent of THREE so it can be unit-tested with no DOM/WebGL.
 */
export type CamVector = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type CameraTarget = {
  /** World-space point the camera looks at. */
  lookX: number;
  lookY: number;
  lookZ: number;
  /** Orbit distance (radius) from the look point. */
  dist: number;
  /** Elevation above horizontal, degrees. */
  elevDeg: number;
  /** Azimuth around the look point, degrees. */
  yawDeg: number;
  /** Zoom multiplier — INVERSE of the frustum: <1 zooms in, >1 zooms out. */
  zoom: number;
};

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;

export function clampZoom(v: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function copyTarget(t: CameraTarget): CameraTarget {
  return {
    lookX: t.lookX,
    lookY: t.lookY,
    lookZ: t.lookZ,
    dist: t.dist,
    elevDeg: t.elevDeg,
    yawDeg: t.yawDeg,
    zoom: t.zoom,
  };
}

/** Build a target framing a point at a given zoom (keeps dist/elev/yaw caller-set). */
export function framePoint(
  look: CamVector,
  zoom: number,
  dist: number,
  elevDeg: number,
  yawDeg: number,
): CameraTarget {
  return {
    lookX: look.x,
    lookY: look.y,
    lookZ: look.z,
    dist,
    elevDeg,
    yawDeg,
    zoom: clampZoom(zoom),
  };
}

export function targetsEqual(a: CameraTarget, b: CameraTarget, eps = 1e-3): boolean {
  return (
    Math.abs(a.lookX - b.lookX) < eps &&
    Math.abs(a.lookY - b.lookY) < eps &&
    Math.abs(a.lookZ - b.lookZ) < eps &&
    Math.abs(a.dist - b.dist) < eps &&
    Math.abs(a.elevDeg - b.elevDeg) < eps &&
    Math.abs(a.yawDeg - b.yawDeg) < eps &&
    Math.abs(a.zoom - b.zoom) < eps
  );
}

type Tween = {
  readonly from: CameraTarget;
  readonly to: CameraTarget;
  readonly dur: number;
  elapsed: number;
};

export class CameraDirector {
  target: CameraTarget;
  private tween: Tween | null = null;

  constructor(init: CameraTarget) {
    this.target = copyTarget(init);
  }

  /** True while an easing tween is in flight. */
  get active(): boolean {
    return this.tween !== null;
  }

  /** Jump straight to a target (no easing). */
  snapTo(t: CameraTarget): void {
    this.tween = null;
    this.target = copyTarget(t);
  }

  /** Start easing from the current target toward `t` over `dur` seconds. */
  easeTo(t: CameraTarget, dur: number): void {
    this.tween = {
      from: copyTarget(this.target),
      to: copyTarget(t),
      dur: Math.max(0.0001, dur),
      elapsed: 0,
    };
  }

  /** Whether the director has settled at (or very near) a target. */
  isSettled(t: CameraTarget, eps = 1e-3): boolean {
    return targetsEqual(this.target, t, eps) && this.tween === null;
  }

  /** Advance the active tween; writes into `.target`. */
  tick(dtS: number): void {
    if (this.tween === null) return;
    this.tween.elapsed += dtS;
    const t = Math.min(1, this.tween.elapsed / this.tween.dur);
    const f = easeInOutCubic(t);
    const { from, to } = this.tween;
    this.target.lookX = lerp(from.lookX, to.lookX, f);
    this.target.lookY = lerp(from.lookY, to.lookY, f);
    this.target.lookZ = lerp(from.lookZ, to.lookZ, f);
    this.target.dist = lerp(from.dist, to.dist, f);
    this.target.elevDeg = lerp(from.elevDeg, to.elevDeg, f);
    this.target.yawDeg = lerp(from.yawDeg, to.yawDeg, f);
    this.target.zoom = clampZoom(lerp(from.zoom, to.zoom, f));
    if (t >= 1) {
      this.target = copyTarget(to);
      this.tween = null;
    }
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}