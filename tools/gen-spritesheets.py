#!/usr/bin/env python3
"""
Generate 2x2 four-frame sprite sheets for the combat/pen/dungeon rig from the
single-frame dot sprites in data/sprites/.

Layout (per digimon):
  Row 0 (WALK cycle, always loops):   [frame0 bob-up]  [frame1 bob-down]
  Row 1 (HIT cycle, on attack/skill): [frame2 recoil]  [frame3 lean-back]

Each source dotNNN.PNG is 32x32 RGBA and maps to catalog id NNN via
`dot{NNN}.gif` (skullbot scheme). Output:
  backend/public/assets/sprites/<NNN>.png        (64x64, 2x2 grid: walk + hit)
  backend/public/assets/sprites-static/<NNN>.png (32x32, frame 0 only — the
                                                 non-dungeon still displays)

The rig (scene3d/src/sprite-rig.ts) slices the 2x2 sheet into 4 frames and
loops the walk row, switching to the hit row when playAttack() fires; the
sprites-static cell is what every 2D <img> (roster/lobby/cards) now reads.
"""
from __future__ import annotations

import os
import sys
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "data", "sprites")
# Served by the backend's /assets/sprites (+ /assets/sprites-static) static
# mounts (frontend/public is root-owned and unwritable here; this mirrors how
# /assets/digimon and /assets/arenas are served from backend/public/assets in
# dev + prod).
OUT_DIR = os.path.join(ROOT, "backend", "public", "assets", "sprites")
OUT_STATIC_DIR = os.path.join(ROOT, "backend", "public", "assets", "sprites-static")

CELL = 32
SHEET = CELL * 2


def tint_red(img: Image.Image, amount: float) -> Image.Image:
    """Add a red wash to opaque pixels (used for the hit/recoil frames)."""
    if amount <= 0:
        return img
    rgb = img.convert("RGBA")
    px = rgb.load()
    w, h = rgb.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 30:
                continue
            nr = min(255, int(r + (255 - r) * amount))
            ng = max(0, int(g * (1 - amount * 0.5)))
            nb = max(0, int(b * (1 - amount * 0.5)))
            px[x, y] = (nr, ng, nb, a)
    return rgb


def crop_to_bbox(img: Image.Image) -> Image.Image:
    """Crop a 32x32 sprite (already CELL sized) to its opaque bounding box and
    re-center it, so the static frame is tight and visually identical to the
    legacy dot.gif (which was a single tight cell)."""
    rgb = img.convert("RGBA")
    bbox = rgb.getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cropped = rgb.crop(bbox)
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cw, ch = cropped.size
    # Center horizontally; anchor near the bottom so feet sit like the source.
    ox = (CELL - cw) // 2
    oy = CELL - ch
    out.paste(cropped, (ox, oy), cropped)
    return out


def make_sheet(src: Image.Image) -> Image.Image:
    base = src.convert("RGBA").resize((CELL, CELL), Image.NEAREST)
    sheet = Image.new("RGBA", (SHEET, SHEET), (0, 0, 0, 0))

    # WALK row: vertical bob (frame0 up, frame1 down) keeps it in-bounds enough
    # for a 32px billboard and reads clearly as a 2-frame march bounce.
    walk_a = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    walk_a.paste(base, (0, -2), base)  # shift up 2px -> feet gap, head near top
    walk_b = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    walk_b.paste(base, (0, 2), base)   # shift down 2px

    # HIT row: recoil (left + light red) then lean-back (right/down + strong red)
    hit_a = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    hit_a.paste(tint_red(base, 0.35), (-3, 0), tint_red(base, 0.35))
    hit_b = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    hit_b.paste(tint_red(base, 0.6), (1, 3), tint_red(base, 0.6))

    sheet.paste(walk_a, (0, 0))
    sheet.paste(walk_b, (CELL, 0))
    sheet.paste(hit_a, (0, CELL))
    sheet.paste(hit_b, (CELL, CELL))
    return sheet


def main() -> int:
    if not os.path.isdir(SRC_DIR):
        print(f"source dir missing: {SRC_DIR}", file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(OUT_STATIC_DIR, exist_ok=True)

    count = 0
    skipped = 0
    for name in sorted(os.listdir(SRC_DIR)):
        if not (name.startswith("dot") and name.endswith(".PNG")):
            continue
        digits = name[3:-4]  # strip 'dot' and '.PNG'
        if not digits.isdigit():
            continue
        catalog_id = str(int(digits))  # dot001 -> 1
        src_path = os.path.join(SRC_DIR, name)
        try:
            src = Image.open(src_path)
            if src.size != (CELL, CELL):
                # normalise odd sizes to 32x32 before compositing
                src = src.resize((CELL, CELL), Image.NEAREST)
            sheet = make_sheet(src)
            static = crop_to_bbox(src)
        except Exception as exc:  # noqa: BLE001
            print(f"skip {name}: {exc}", file=sys.stderr)
            skipped += 1
            continue
        sheet.save(os.path.join(OUT_DIR, f"{catalog_id}.png"), "PNG")
        static.save(os.path.join(OUT_STATIC_DIR, f"{catalog_id}.png"), "PNG")
        count += 1

    print(f"generated {count} sprite sheets + static cells -> {OUT_DIR} (skipped {skipped})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
