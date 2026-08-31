#!/usr/bin/env python3
"""
SPIKE 001 — sprite-sheet redistribution + pixel-recolor layer.

Goal: figure out the BEST way to lay out the generated digimon sheet so we can
(a) stop "falling back to the 4 frames / legacy dot" and (b) manipulate pixels
at runtime for skills (tint) and status (frozen/poisoned/burned/downed).

This script builds the candidate layout (grid 4x4 = 16 frames @ 32px = 128x128)
and a per-state recolor function, then a verifier decodes the PNG and asserts:
  - every cell is exactly ONE digimon (32x32 block, alpha-trimmed silhouette)
  - recolor touches ONLY opaque digimon pixels, never the transparent bg
  - status overlays are detectable (changed pixel count within the silhouette)

Run:  python3 src/gen.py
"""
from __future__ import annotations
import os, struct, zlib
from PIL import Image, ImageEnhance

OUT = os.path.join(os.path.dirname(__file__), "out")
CELL = 32
GRID = 4
SHEET = CELL * GRID  # 128

# ---- Semantic row layout (the "alignment" the user asked for) ---------------
# Row 0: WALK / idle bob (2 frames, loop)
# Row 1: ACTION (attack 3 + skill 1)
# Row 2: REACTION (take-hit 2 + downed 2)
# Row 3: STATUS overlays (frozen / poisoned / burned / downed-tint) — applied
#        as a recolor layer ON TOP of whatever base pose is showing.
WALK_A   = 0  # (0,0)
WALK_B   = 1  # (1,0)
ATK_0    = 4  # (0,1) attack wind-up
ATK_1    = 5  # (1,1) attack strike
ATK_2    = 6  # (2,1) attack recovery
SKILL    = 7  # (3,1) skill cast (tintable)
HIT_0    = 8  # (0,2) recoil
HIT_1    = 9  # (1,2) recoil 2
DOWN_0   = 10 # (2,2) downed pose
DOWN_1   = 11 # (3,2) downed pose 2
ST_FROZEN   = 12 # (0,3) — recolor target for frozen
ST_POISON   = 13 # (1,3)
ST_BURN     = 14 # (2,3)
ST_DOWNED   = 15 # (3,3)

def tint(img: Image.Image, r, g, b, a_thresh=30) -> Image.Image:
    """Multiply-RGB wash on opaque pixels only."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            rr, gg, bb, aa = px[x, y]
            if aa <= a_thresh:
                continue
            px[x, y] = (
                int(rr * r), int(gg * g), int(bb * b), aa
            )
    return rgba

def add_glow(img: Image.Image, amount) -> Image.Image:
    """Lighten opaque pixels (used for 'burning' / energized skill)."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            rr, gg, bb, aa = px[x, y]
            if aa <= 30:
                continue
            px[x, y] = (
                min(255, int(rr + (255 - rr) * amount)),
                min(255, int(gg + (255 - gg) * amount)),
                min(255, int(bb + (255 - bb) * amount)),
                aa,
            )
    return rgba

def crop_to_bbox(src: Image.Image) -> Image.Image:
    """Center the digimon in the cell (both axes) — NOT bottom-anchored. A
    consistent placement is what keeps every frame aligned (the bug the user
    reported: frames drifting vertically because crop anchored to the feet)."""
    rgba = src.convert("RGBA")
    bbox = rgba.getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cropped = rgba.crop(bbox)
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cw, ch = cropped.size
    out.paste(cropped, ((CELL - cw) // 2, (CELL - ch) // 2), cropped)
    return out

def make_sheet(src_path: str) -> Image.Image:
    base = crop_to_bbox(Image.open(src_path).convert("RGBA").resize((CELL, CELL), Image.NEAREST))
    sheet = Image.new("RGBA", (SHEET, SHEET), (0, 0, 0, 0))

    def put(cell, im):
        col, row = cell % GRID, cell // GRID
        sheet.paste(im, (col * CELL, row * CELL), im)

    # Row 0 — WALK + IDLE (4 frames): bob A/B + idle A/B
    wa = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); wa.paste(base, (0, -2), base)
    wb = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); wb.paste(base, (0, 2), base)
    ia = base
    ib = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); ib.paste(tint(base, 0.95, 0.95, 1.05), (1, 0), tint(base, 0.95, 0.95, 1.05))
    put(WALK_A, wa); put(WALK_B, wb); put(2, ia); put(3, ib)

    # Row 1 — ACTION: attack windup/strike/recover + skill cast (energized)
    a0 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); a0.paste(tint(base, 1.1, 1.0, 1.0), (-2, -1), tint(base, 1.1, 1.0, 1.0))
    a1 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); a1.paste(tint(base, 1.3, 0.9, 0.9), (2, 0), tint(base, 1.3, 0.9, 0.9))
    a2 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); a2.paste(base, (0, 1), base)
    skill = add_glow(base, 0.5)  # skill cast = energized
    put(ATK_0, a0); put(ATK_1, a1); put(ATK_2, a2); put(SKILL, skill)

    # Row 2 — REACTION: take-hit x2 + downed x2
    h0 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); h0.paste(tint(base, 1.4, 0.7, 0.7), (-3, 0), tint(base, 1.4, 0.7, 0.7))
    h1 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); h1.paste(tint(base, 1.2, 0.6, 0.6), (2, 1), tint(base, 1.2, 0.6, 0.6))
    d0 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); d0.paste(tint(base, 0.6, 0.6, 0.8), (0, 6), tint(base, 0.6, 0.6, 0.8))
    d1 = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); d1.paste(tint(base, 0.5, 0.5, 0.7), (0, 8), tint(base, 0.5, 0.5, 0.7))
    put(HIT_0, h0); put(HIT_1, h1); put(DOWN_0, d0); put(DOWN_1, d1)

    # Row 3 — STATUS overlays (pre-baked over the idle pose; the RUNTIME can
    # also recolor ANY frame in place, see recolor.ts). Keep alignment identical
    # to WALK_A so a status swap never shifts the digimon.
    put(ST_FROZEN, tint(wa, 0.6, 0.85, 1.0))
    put(ST_POISON,  tint(wa, 0.7, 1.0, 0.6))
    put(ST_BURN,    add_glow(tint(wa, 1.2, 0.8, 0.6), 0.3))
    put(ST_DOWNED,  tint(wa, 0.6, 0.6, 0.8))
    return sheet

# ---- PNG encode (no PIL dependency on external libs; use PIL save) -----------
def save(sheet: Image.Image, name: str):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    sheet.save(path, "PNG")
    return path

# ---- Verifier: decode raw PNG and check facts -------------------------------
def png_decode(path):
    d = open(path, "rb").read()
    w, h = struct.unpack(">II", d[16:24])
    idat = b""; i = 8
    while i < len(d):
        ln = struct.unpack(">I", d[i:i+4])[0]; t = d[i+4:i+8]
        if t == b"IDAT": idat += d[i+8:i+8+ln]
        i += 12 + ln
    raw = zlib.decompress(idat); st = w * 4
    def pae(a, b, c):
        p = a + b - c; x = abs(p-a); y = abs(p-b); z = abs(p-c)
        return a if x <= y and z else (b if y <= z else c)
    px = bytearray(); pv = bytearray(st); p = 0
    for _ in range(h):
        f = raw[p]; p += 1; ln = bytearray(raw[p:p+st]); p += st
        for q in range(st):
            a = ln[q-4] if q >= 4 else 0; b = pv[q]; c = pv[q-4] if q >= 4 else 0
            if f == 1: ln[q] = (ln[q] + a) & 255
            elif f == 2: ln[q] = (ln[q] + b) & 255
            elif f == 3: ln[q] = (ln[q] + ((a + b) >> 1)) & 255
            elif f == 4: ln[q] = (ln[q] + pae(a, b, c)) & 255
        px += ln; pv = ln
    return w, h, px

def cell_cluster_count(px, w, h, cell):
    cw, ch = w // GRID, h // GRID
    col, row = cell % GRID, cell // GRID
    sx, sy = col * cw, row * ch
    from collections import deque
    op = lambda x, y: px[((sy+y)*w + (sx+x))*4+3] > 128
    seen = [[False]*cw for _ in range(ch)]; n = 0
    for y in range(ch):
        for x in range(cw):
            if op(x, y) and not seen[y][x]:
                n += 1; q = deque([(x, y)]); seen[y][x] = True
                while q:
                    cx, cy = q.pop()
                    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                        nx, ny = cx+dx, cy+dy
                        if 0 <= nx < cw and 0 <= ny < ch and op(nx, ny) and not seen[ny][nx]:
                            seen[ny][nx] = True; q.append((nx, ny))
    return n

def opaque_count(px, w, h, cell):
    cw, ch = w // GRID, h // GRID
    col, row = cell % GRID, cell // GRID
    sx, sy = col * cw, row * ch
    n = 0
    for y in range(ch):
        for x in range(cw):
            if px[((sy+y)*w + (sx+x))*4+3] > 128: n += 1
    return n

def verify(path):
    w, h, px = png_decode(path)
    assert (w, h) == (SHEET, SHEET), f"size {w}x{h} != {SHEET}"
    # Every cell must be exactly ONE digimon (1 connected cluster) — proves the
    # runtime will show ONE sprite per frame, never a 2x2 block.
    bad = []
    for cell in range(GRID * GRID):
        c = cell_cluster_count(px, w, h, cell)
        if c != 1:
            bad.append((cell, c))
    # Status overlays must differ from the plain walk cell (recolor actually
    # changed opaque pixels — we can detect because colors differ).
    # Compare ST_FROZEN vs WALK_A opaque pixels: at least one differs (recolor works).
    def cell_pixels(cell):
        cw, ch = w // GRID, h // GRID
        col, row = cell % GRID, cell // GRID
        sx, sy = col * cw, row * ch
        out = []
        for y in range(ch):
            for x in range(cw):
                i = ((sy+y)*w + (sx+x))*4
                out.append((px[i], px[i+1], px[i+2], px[i+3]))
        return out
    walk = cell_pixels(WALK_A)
    frozen = cell_pixels(ST_FROZEN)
    diff = sum(1 for (a, b) in zip(walk, frozen) if a[:3] != b[:3] and a[3] > 128)
    # Interior-opaque count (ignore a 1px anti-alias border so a colored edge
    # doesn't read as "silhouette grew"). Confirms recolor does NOT leak bg in.
    def interior_opaque(cell):
        cw, ch = w // GRID, h // GRID
        col, row = cell % GRID, cell // GRID
        sx, sy = col * cw, row * ch
        n = 0
        for y in range(1, ch-1):
            for x in range(1, cw-1):
                if px[((sy+y)*w + (sx+x))*4+3] > 128: n += 1
        return n
    return {
        "size": (w, h),
        "bad_cells": bad,
        "frozen_vs_walk_diff_opaque": diff,
        "walkA_interior_opaque": interior_opaque(WALK_A),
        "frozen_interior_opaque": interior_opaque(ST_FROZEN),
    }

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    src = os.path.join(root, "data", "sprites", "dot001.PNG")
    sheet = make_sheet(src)
    p = save(sheet, "digimon-001-4x4.png")
    print("wrote", p)
    res = verify(p)
    print("verify:", res)
    assert res["bad_cells"] == [], f"cells with !=1 digimon: {res['bad_cells']}"
    assert res["frozen_vs_walk_diff_opaque"] > 0, "status recolor changed no opaque pixels!"
    assert res["walkA_interior_opaque"] == res["frozen_interior_opaque"], \
        f"interior silhouette grew (bg leak?): {res['walkA_interior_opaque']} -> {res['frozen_interior_opaque']}"
    print("\nSPIKE 001 VERIFY PASSED: 16-frame 4x4 layout valid + status recolor is silhouette-only")
