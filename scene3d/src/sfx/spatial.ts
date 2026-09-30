/**
 * Isometric-camera spatialization, pure math.
 *
 * An isometric view means distance-to-camera is a terrible spatialization
 * proxy (everything is roughly equidistant), so we derive a stereo image from
 * the SCREEN projection instead: a unit's screen X decides pan (StereoPanner
 * pan ≈ ±0.7 at the edges), and its distance from screen center + on-screen
 * status decides gain. Off-screen sounds are heavily attenuated rather than
 * silent so you always keep situational awareness.
 *
 * All functions are deterministic and side-effect free → unit-testable
 * headlessly. `screenX` is in pixels relative to a viewport of `viewportWidth`;
 * both are supplied by the caller from the projection step.
 */

/** StereoPanner pan from a screen X. Center = 0 (dead centre), edges = ±0.7
 *  (near-hard left/right; capped so nothing inverts). */
export function panFromScreenX(screenXC: number): number {
  const clamped = Math.max(-1, Math.min(1, screenXC));
  return clamped * 0.7;
}

/** Normalized distance of a screen X from center, in 0..1. */
function centerDist(screenXC: number): number {
  return Math.abs(screenXC);
}

/** Gain multiplier from screen placement: full at center, ~0.55 at the edges,
 *  ~0.2 when fully off-screen. Smoothly continuous — no step pops. */
export function gainFromScreen(screenXC: number, onScreen: boolean): number {
  const d = centerDist(screenXC);
  if (!onScreen) return Math.max(0.12, 0.55 - d * 0.2);
  const edgeFall = 1 - 0.45 * d;
  return Math.max(0.3, edgeFall);
}

/** Combine the on-screen gain with an explicit distance fade the caller may
 *  want (e.g. very far projectiles). Returns a 0..1 envelope. */
export function combinedGain(base: number, distanceFactor: number): number {
  return base * Math.max(0, Math.min(1, distanceFactor));
}

/** Convenience: build a `position` for `play()` from a raw projected point. */
export type ScreenProjection = {
  screenX: number;
  viewportWidth: number;
  onScreen: boolean;
};

export function normalizePosition(screenX: number, viewportWidth: number, onScreen: boolean): ScreenProjection {
  const center = viewportWidth > 0 ? screenX / viewportWidth - 0.5 : 0;
  return { screenX: Math.max(-1, Math.min(1, center * 2)), viewportWidth, onScreen };
}

/**
 * Pan a position into StereoPanner terms (what the playing code applies).
 * This hoists the two derived curves (=pan, =gain) from one call.
 */
export function spatialize(position: ScreenProjection): { pan: number; gain: number } {
  return {
    pan: panFromScreenX(position.screenX),
    gain: gainFromScreen(position.screenX, position.onScreen),
  };
}