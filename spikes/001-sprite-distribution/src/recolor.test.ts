/**
 * SPIKE 001 — runtime recolor test. Exercises the real `recolor.ts` module
 * against a synthetic 32x32 sprite (silhouette + transparent bg) and asserts:
 *   1. status recolor changes opaque pixels
 *   2. recolor NEVER touches the transparent background (alpha stays 0)
 *   3. opaque count is invariant (no bg leak, no silhouette growth)
 *   4. skill tint + glow accumulates on top of status
 */
import {
  applySpriteState,
  opaqueCount,
  type StatusState,
  type SkillTint,
} from "./recolor.ts";

const W = 32;
const H = 32;

/** Build a 32x32 RGBA buffer: a 16x16 opaque block centered, rest transparent. */
function makeSprite(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      const i = (y * W + x) * 4;
      buf[i] = 200;
      buf[i + 1] = 100;
      buf[i + 2] = 50;
      buf[i + 3] = 255; // opaque red-ish digimon
    }
  }
  return buf;
}

/** Count transparent (bg) pixels whose RGB was altered by a recolor. */
function bgLeaked(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i + 3]! <= 24) {
      // was transparent
      if (
        after[i] !== before[i] ||
        after[i + 1] !== before[i + 1] ||
        after[i + 2] !== before[i + 2] ||
        after[i + 3] !== before[i + 3]
      ) {
        n++;
      }
    }
  }
  return n;
}

const STATUSES: StatusState[] = ["frozen", "poisoned", "burning", "downed"];
const SKILLS: SkillTint[] = ["fire", "ice", "thunder", "heal"];

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok  -", msg);
  }
}

for (const st of STATUSES) {
  const before = makeSprite();
  const after = before.slice();
  const changed = applySpriteState(after, { status: st });
  assert(changed > 0, `status '${st}' recolored opaque pixels (${changed})`);
  assert(bgLeaked(before, after) === 0, `status '${st}' did NOT touch transparent bg`);
  assert(
    opaqueCount(before) === opaqueCount(after),
    `status '${st}' kept opaque count invariant (${opaqueCount(before)} -> ${opaqueCount(after)})`,
  );
}

// skill tint + glow on top of status
const base = makeSprite();
const sk = base.slice();
const changed = applySpriteState(sk, { status: "frozen", skill: "fire", skillGlow: true });
assert(changed > 0, `skill 'fire'+glow on frozen recolored pixels (${changed})`);
assert(bgLeaked(base, sk) === 0, "skill recolor did NOT touch transparent bg");
assert(opaqueCount(base) === opaqueCount(sk), "skill recolor kept opaque count invariant");

// 'none' is a no-op
const noneBefore = makeSprite();
const noneAfter = noneBefore.slice();
const noneChanged = applySpriteState(noneAfter, { status: "none", skill: "none" });
assert(noneChanged === 0, "'none' status/skill is a true no-op");

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nSPIKE 001 RECOLOR TESTS PASSED — runtime pixel manipulation is safe + silhouette-only");
