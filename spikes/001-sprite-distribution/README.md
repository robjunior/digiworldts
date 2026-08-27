# SPIKE 001 — Sprite-sheet redistribution + pixel-recolor layer

## Question
Best way to use our digimon sprite files without the recurring "falls back to the
4 frames / shows the whole 2×2" bug, AND lay out the sheet so we can manipulate
pixels at runtime for skills + status.

## What we verified (real execution, not guessing)
- Decoded real `backend/public/assets/sprites/*.png`: **64×64 = 2×2 of 32×32**.
  Layout constants in `sprite-rig.ts` (`SHEET_COLS=2`,`CELL=32`) and
  `tilesets.ts` (`FRAME=32`) are CORRECT — not the bug.
- Ran `scene3d/test/sprite-rig-sheet-smoke.mts`: rig draws ONE cell per frame
  (walk 0→1, attack→3, hit→2, revert). 3D + dungeon already show 1 frame.
- **Root cause of "4 frames / old behavior"**: 2D surfaces
  (`DigdexHive`, `EvolveDialog`, `EvolutionChain`, `DigdexDetailModal`,
  `DungeonPartyBar`) still render `template.assets.dot` = legacy `dot.gif`
  (`backend/src/scraper/assets.ts:54` → `/assets/digimon/<id>/dot.gif`). They
  never migrated to the sheet system. That is the "always going back to the 4
  frames" the user sees — not a rig bug.
- The 2×2 ALSO only has 4 poses → no room for status/habilidade at all.

## Spike result: candidate layout (VALIDATED)
`src/gen.py` builds a **4×4 grid = 16 frames @ 32px = 128×128** with fixed
semantic rows:
```
row0 WALK+IDLE  : [0]walkA [1]walkB [2]idleA [3]idleB
row1 ACTION     : [4]atkWind [5]atkStrike [6]atkRecover [7]skill(cast/glow)
row2 REACTION   : [8]hitA [9]hitB [10]downedA [11]downedB
row3 STATUS     : [12]frozen [13]poison [14]burn [15]downed-tint
```
Verifier decodes the PNG and asserts every cell is exactly ONE digimon
(connected-component count == 1 for all 16 cells) → runtime shows one sprite per
frame, never a 2×2 block. **PASS.**

## Spike result: runtime pixel recolor (VALIDATED)
`src/recolor.ts` + `src/recolor.test.ts` operate on a raw RGBA buffer (what
`CanvasRenderingContext2D.getImageData().data` returns) — no DOM dep, unit
testable. `applySpriteState(data, {status, skill, skillGlow})` washes only opaque
digimon pixels, never the transparent bg. Tests assert:
- status recolors change opaque pixels;
- transparent bg is NEVER touched (no alpha leak);
- opaque count is invariant (silhouette never grows/shrinks). **PASS.**

This is the mechanism for "manipular pixels ao usar habilidades ou exibir status"
in 3D (SpriteRig canvas), Phaser (texture), and 2D (DigimonSprite canvas) — apply
in-place on the per-frame canvas/ImageData.

## Bug found (actionable)
`crop_to_bbox` in `tools/gen-spritesheets.py` anchors the digimon to the BOTTOM
(`oy = CELL - ch`) instead of centering. That vertical drift is the real
"não alinha bem" complaint. Fix: center both axes (`(CELL-cw)//2, (CELL-ch)//2`).
Same fix belongs in `DigimonSprite.tsx` trim (it already centers — good).

## Recommendation for the real build
1. Regenerate sheets as **128×128 / 4×4** with the row semantics above.
2. Bump `SHEET_COLS/ROWS` and `CELL` in `sprite-rig.ts` + `DigimonSprite.tsx`
   and `FRAME` in `tilesets.ts` together (they MUST stay in sync — see skill).
3. Add `status`/`skill` recolor calls (`recolor.ts` pattern) in SpriteRig's
   `drawSheetFrame` path and Phaser `buildDigimonSheet` so status shows on the
   live sprite without baking 16 status×N sheets.
4. MIGRATE the 2D holdouts (`DigdexHive`, `EvolveDialog`, `DungeonPartyBar`, …)
   to `<DigimonSprite>` / `unitSpriteStaticUrl` so they stop rendering `dot.gif`.
5. Fix `crop_to_bbox` centering in the generator.

## Run it
```
python3 src/gen.py                       # builds out/digimon-001-4x4.png + verifies
npx tsx src/recolor.test.ts             # runtime recolor unit tests
```
