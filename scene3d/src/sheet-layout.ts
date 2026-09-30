/**
 * Sprite-sheet layout + cycle semantics — shared by the 3D rig and the 2D
 * menu component so both consumers describe the same grid with one source of
 * truth.
 *
 * Two layouts exist:
 *
 * LEGACY (fallback) — the authored sheets that ship today:
 *   2 cols × 2 rows of cells (a square image, e.g. 32×32 = 16×16 cells, or
 *   64×64 = 32×32 cells). 4 frames total. Rendered as WALK loop + single-hit
 *   (cell 2) + single-attack (cell 3) poses, exactly like the repo has always
 *   handled them. Digimons without the new sprites keep THIS path untouched.
 *
 * CYCLES-12 (new) — the upcoming sheets the user described:
 *   3 cols × 4 rows of cells (a non-square image, width:pixels < height).
 *   12 frames total. Row-major cell semantics (0-based cell index):
 *
 *     cell 0 = walk 1          cell 1 = walk 2        cell 2 = walk 3
 *     cell 3 = happy 1         cell 4 = death 1       cell 5 = death 2
 *     cell 6 = angry 1         cell 7 = happy 2       cell 8 = angry 2
 *     cell 9 = sad 1           cell 10 = sad 2        cell 11 = angry 3
 *
 * Cycles:
 *   walk  = [0,1,2]   movement state  -> use whenever the digimon moves
 *   happy = [3,7]     DEFAULT idle state
 *   angry = [6,8,11]  attacking
 *   sad   = [9,10]    affected by a negative status (until the status clears)
 *   death = [4,5]     dead: persists in place, no action, no incoming hits,
 *                     but an ally revive can pull it back
 *
 * Layout is detected from the sheet's ACTUAL pixel dimensions (never a
 * hardcoded cell size): square -> legacy, non-square -> cycles-12. This
 * matches the repo rule "derive cell size from dimensions, argue never".
 */
export const CYCLES12_COLS = 3;
export const CYCLES12_ROWS = 4;

export type SpriteCycle = 'walk' | 'happy' | 'angry' | 'sad' | 'death';

export type SheetVersion = 'legacy4' | 'cycles12';

export type SheetLayout = {
  readonly version: SheetVersion;
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
};

/** Cell indices (row-major) that make up each cycle in a CYCLES-12 sheet. */
export const CYCLES12_CYCLE_CELLS: Readonly<Record<SpriteCycle, readonly number[]>> = {
  walk: [0, 1, 2],
  happy: [3, 7],
  angry: [6, 8, 11],
  sad: [9, 10],
  death: [4, 5],
};

/** Default (no-argument) idle frame per layout, so menus show the resting pose. */
export const DEFAULT_IDLE_CELL: Readonly<Record<SheetVersion, number>> = {
  // Legacy has no dedicated idle — frame 0 (top-left) is the resting pose.
  legacy4: 0,
  // New layout's idle state is happy, first frame = cell 3.
  cycles12: CYCLES12_CYCLE_CELLS.happy[0] ?? 3,
};

/**
 * Resolve a sheet's grid from its real pixel dimensions. Square images are the
 * legacy 2×2 (4-frame) layout; every non-square sheet is treated as the new
 * 3×4 (12-frame) layout. Cell size is derived from the actual dimensions, never
 * assumed.
 */
export function resolveSheetLayout(width: number, height: number): SheetLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = w / h;
  const square = Math.abs(ratio - 1) < 0.02;
  if (square) {
    return {
      version: 'legacy4',
      cols: 2,
      rows: 2,
      cellW: Math.floor(w / 2),
      cellH: Math.floor(h / 2),
    };
  }
  return {
    version: 'cycles12',
    cols: CYCLES12_COLS,
    rows: CYCLES12_ROWS,
    cellW: Math.floor(w / CYCLES12_COLS),
    cellH: Math.floor(h / CYCLES12_ROWS),
  };
}

/** Source rect (x, y, w, h in sheet pixels) of a 0-based cell in `layout`. */
export function cellRect(
  layout: SheetLayout,
  cell: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const col = cell % layout.cols;
  const row = Math.floor(cell / layout.cols);
  return {
    x: col * layout.cellW,
    y: row * layout.cellH,
    w: layout.cellW,
    h: layout.cellH,
  };
}

/** Resolve the frame indices for a cycle in a layout (legacy maps to frames 0-3). */
export function cycleCells(layout: SheetLayout, cycle: SpriteCycle): readonly number[] {
  if (layout.version === 'cycles12') return CYCLES12_CYCLE_CELLS[cycle];
  // Legacy: only walk/hit/attack were defined. Any cycle other than 'walk'
  // collapses to the single resting frame 0 (menus) or the attack cell.
  if (cycle === 'walk') return [0, 1, 2, 3];
  return [0];
}