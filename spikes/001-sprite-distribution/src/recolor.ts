/**
 * SPIKE 001 — runtime pixel-recolor layer for digimon sprites.
 *
 * The point of the spike: prove we can MANIPULATE PIXELS at runtime to show
 * skill tints and status effects WITHOUT baking them into the sheet (so the
 * sheet stays semantic + the runtime stays flexible). This module operates on
 * a flat RGBA buffer (what `CanvasRenderingContext2D.getImageData().data`
 * returns) — no DOM/Canvas dependency, so it is unit-testable in node.
 *
 * Rule that matters: recolor ONLY opaque digimon pixels. Transparent bg pixels
 * must be left at alpha 0 so the silhouette (and its bbox) never changes.
 */

export type StatusState =
  | "none"
  | "frozen"
  | "poisoned"
  | "burning"
  | "downed";

export type SkillTint = "none" | "fire" | "ice" | "thunder" | "heal";

/** Multiply-RGB wash — same math as the python `tint()`. */
function rgbWash(
  data: Uint8ClampedArray,
  r: number,
  g: number,
  b: number,
): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! <= 24) continue; // skip transparent bg
    data[i] = Math.min(255, data[i]! * r);
    data[i + 1] = Math.min(255, data[i + 1]! * g);
    data[i + 2] = Math.min(255, data[i + 2]! * b);
  }
}

/** Additive lighten — same math as python `add_glow()`. */
function lighten(data: Uint8ClampedArray, amount: number): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! <= 24) continue;
    data[i] = Math.min(255, data[i]! + (255 - data[i]!) * amount);
    data[i + 1] = Math.min(255, data[i + 1]! + (255 - data[i + 1]!) * amount);
    data[i + 2] = Math.min(255, data[i + 2]! + (255 - data[i + 2]!) * amount);
  }
}

const STATUS_WASH: Record<StatusState, [number, number, number] | null> = {
  none: null,
  frozen: [0.6, 0.85, 1.0],
  poisoned: [0.7, 1.0, 0.6],
  burning: [1.2, 0.8, 0.6],
  downed: [0.6, 0.6, 0.8],
};

const SKILL_WASH: Record<SkillTint, [number, number, number] | null> = {
  none: null,
  fire: [1.3, 0.9, 0.9],
  ice: [0.7, 0.95, 1.2],
  thunder: [1.1, 1.1, 0.7],
  heal: [0.8, 1.2, 0.8],
};

/**
 * Apply status + skill recolor in place on an RGBA buffer.
 * Returns the count of opaque pixels that actually changed — used by tests to
 * assert the recolor did (and only did) something to the silhouette.
 */
export function applySpriteState(
  data: Uint8ClampedArray,
  opts: { status?: StatusState; skill?: SkillTint; skillGlow?: boolean } = {},
): number {
  const status = opts.status ?? "none";
  const skill = opts.skill ?? "none";
  const before = data.slice();
  const statusWash = STATUS_WASH[status];
  if (statusWash) rgbWash(data, statusWash[0], statusWash[1], statusWash[2]);
  const skillWash = SKILL_WASH[skill];
  if (skillWash) {
    rgbWash(data, skillWash[0], skillWash[1], skillWash[2]);
    if (opts.skillGlow) lighten(data, 0.3);
  }
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! <= 24) continue; // only count opaque digimon pixels
    if (
      data[i] !== before[i] ||
      data[i + 1] !== before[i + 1] ||
      data[i + 2] !== before[i + 2]
    ) {
      changed++;
    }
  }
  return changed;
}

/** Count opaque ("digimon") pixels — used to prove bg leaks are impossible. */
export function opaqueCount(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 24) n++;
  return n;
}
