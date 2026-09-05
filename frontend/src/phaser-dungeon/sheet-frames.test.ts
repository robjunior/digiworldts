/**
 * Regression test for the digimon sheet-frame math (run: `npx tsx sheet-frames.test.ts`).
 *
 * The cell size must be DERIVED from the sheet's actual dimensions, never a
 * hardcoded 32px cell. A user-supplied 32x32 sheet (4 frames of 16x16) must
 * slice into 4 frames and animate; previously a hardcoded FRAME=32 collapsed it
 * to a single 32x32 frame (floor(32/32)=1 col) and froze the walk cycle.
 *
 * This file imports ONLY the pure `sheet-frames.ts` module (no Phaser), so it
 * runs under Node without a browser/WebGL runtime.
 */
import {
  computeSheetFrames,
  SHEET_COLS,
  SHEET_ROWS,
} from "./sheet-frames";

let failures = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL- ${label}`);
  }
}

// --- User-supplied 32x32 sheet (16x16 cells) ---
{
  const L = computeSheetFrames(32, 32);
  check("32x32: grid is 2x2", L.cols === SHEET_COLS && L.rows === SHEET_ROWS);
  check("32x32: cell size is 16x16", L.cellW === 16 && L.cellH === 16);
  check("32x32: exactly 4 frames", L.frames.length === 4);
  const at = (i: number) => L.frames[i]!;
  check("32x32: frame0 at (0,0,16,16)", at(0).x === 0 && at(0).y === 0 && at(0).w === 16 && at(0).h === 16);
  check("32x32: frame1 at (16,0,16,16)", at(1).x === 16 && at(1).y === 0 && at(1).w === 16 && at(1).h === 16);
  check("32x32: frame2 (take-hit) at (0,16,16,16)", at(2).x === 0 && at(2).y === 16 && at(2).w === 16 && at(2).h === 16);
  check("32x32: frame3 (attack) at (16,16,16,16)", at(3).x === 16 && at(3).y === 16 && at(3).w === 16 && at(3).h === 16);
  check("32x32: walk cycle = all four cells [0,1,2,3]", L.walkFrameIndices.join(",") === "0,1,2,3");
  check("32x32: takeHit index = 2", L.takeHitFrameIndex === 2);
  check("32x32: attack index = 3", L.attackFrameIndex === 3);
}

// --- Authored 64x64 sheet (32x32 cells) still works ---
{
  const L = computeSheetFrames(64, 64);
  check("64x64: cell size is 32x32", L.cellW === 32 && L.cellH === 32);
  check("64x64: exactly 4 frames", L.frames.length === 4);
  const at = (i: number) => L.frames[i]!;
  check("64x64: frame0 at (0,0,32,32)", at(0).x === 0 && at(0).y === 0 && at(0).w === 32 && at(0).h === 32);
  check("64x64: frame3 (attack) at (32,32,32,32)", at(3).x === 32 && at(3).y === 32 && at(3).w === 32 && at(3).h === 32);
}

// --- Odd sizes round down gracefully (48x48 -> 24x24 cells) ---
{
  const L = computeSheetFrames(48, 48);
  check("48x48: cell size is 24x24", L.cellW === 24 && L.cellH === 24);
  check("48x48: exactly 4 frames", L.frames.length === 4);
  const at = (i: number) => L.frames[i]!;
  check("48x48: frame1 at (24,0,24,24)", at(1).x === 24 && at(1).y === 0);
  check("48x48: frame3 at (24,24,24,24)", at(3).x === 24 && at(3).y === 24);
}

if (failures > 0) {
  throw new Error(`${failures} sheet-frame check(s) FAILED`);
}
console.log("\nAll sheet-frame regression checks passed.");
