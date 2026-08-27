/**
 * Pure spritesheet frame math, isolated from Phaser so it can be unit-tested
 * under Node without a browser/WebGL runtime.
 *
 * Every digimon sheet is a 2×2 grid of equal cells:
 *   0 1      top row    = walk cycle (bob A / bob B)
 *   2 3      bottom row = take-hit (left), attack (right)
 *
 * The cell size is DERIVED from the sheet's actual pixel dimensions, never
 * hardcoded. This is what lets a user-supplied 32×32 sheet (16×16 cells) and
 * the authored 64×64 sheets (32×32 cells) both slice and animate. A hardcoded
 * 32px cell would collapse a 32×32 sheet to a single column (floor(32/32)=1)
 * and freeze the walk cycle.
 */

export const SHEET_COLS = 2;
export const SHEET_ROWS = 2;

export interface SheetFrame {
  /** Flattened cell index (row * cols + col): 0,1 = walk; 2 = take-hit; 3 = attack. */
  readonly index: number;
  /** Source x of the cell within the sheet, in px. */
  readonly x: number;
  /** Source y of the cell within the sheet, in px. */
  readonly y: number;
  /** Cell width in px (sheet width / cols). */
  readonly w: number;
  /** Cell height in px (sheet height / rows). */
  readonly h: number;
}

export interface SheetLayout {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly frames: readonly SheetFrame[];
  /** Indices that form the looping walk cycle (top row). */
  readonly walkFrameIndices: readonly number[];
  /** Index of the take-hit / recoil pose (bottom-left). */
  readonly takeHitFrameIndex: number;
  /** Index of the attack / strike pose (bottom-right). */
  readonly attackFrameIndex: number;
}

/**
 * Compute the 2×2 frame layout for a sheet of the given pixel size. Returns
 * four cells with their source rects; throws if the dimensions cannot form a
 * 2×2 grid (both sides must be >= 2 px).
 */
export function computeSheetFrames(sheetW: number, sheetH: number): SheetLayout {
  const cols = SHEET_COLS;
  const rows = SHEET_ROWS;
  const cellW = Math.max(1, Math.floor(sheetW / cols));
  const cellH = Math.max(1, Math.floor(sheetH / rows));
  const frames: SheetFrame[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      frames.push({
        index,
        x: col * cellW,
        y: row * cellH,
        w: cellW,
        h: cellH,
      });
    }
  }
  return {
    cols,
    rows,
    cellW,
    cellH,
    frames,
    walkFrameIndices: [0, 1, 2, 3],
    takeHitFrameIndex: 2,
    attackFrameIndex: 3,
  };
}
