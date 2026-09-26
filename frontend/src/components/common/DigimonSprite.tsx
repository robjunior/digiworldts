import { memo, useEffect, useState } from "react";

import {
  unitSpriteSheetUrl,
  unitSpriteStaticUrl,
} from "@digiworld/scene3d";

const portraitUrl = (catalogId: string) =>
  `/assets/digimon/${catalogId}/portrait.webp`;

/** Alpha >= this counts as digimon pixels (mirrors scene3d ALPHA_THRESHOLD). */
const ALPHA_MIN = 24;
/** Transparent breathing room around the trimmed silhouette, in px. */
const PAD_PX = 1;
/** Vertical offset applied after centering (positive = move down). Fixes top cropping. */
const OFFSET_Y = 2;
/** Number of cells per row in the sprite sheet grid (2 cols). */
const SHEET_COLS = 2;
/** Number of cells per column in the sprite sheet grid (2 rows). */
const SHEET_ROWS = 2;
/** Hard cap on the number of cached frame promises. LRU evicts the oldest. */
const MAX_CACHE_SIZE = 500;
/** Max trimmed output side in px; guards against pathological huge sprites. */
const MAX_SPRITE_SIZE = 512;

type DigimonSpriteVariant = "sprite" | "portrait";

type DigimonSpriteProps = {
  /** Catalog id, e.g. `skb-317` (or the integer form `317`). */
  readonly catalogId: string;
  /** Which visual to show: 'sprite' = trimmed static frame; 'portrait' = full portrait art. */
  readonly variant?: DigimonSpriteVariant;
  /** Extra class names merged onto the <img>. */
  readonly className?: string;
  /** Accessible label; defaults to empty (decorative). */
  readonly alt?: string;
  /** Frame index into the walk animation cell grid (0-based). Use 0 for static sprites.
   *   Walk cycles typically use frames 0..3 for a 4-frame animation.
   *   Defaults to 0 (first cell). */
  readonly frameIndex?: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/**
 * Draw `(sx, sy, sw, sh)` from `img`, trim transparent margins, center the
 * remaining silhouette in a tight square, export as a PNG data URL. Returns
 * null when the canvas is unavailable or the region is fully transparent.
 * @param sx Source x offset (pixels) - use with sprite sheets to select specific cells
 * @param sy Source y offset (pixels) - use with sprite sheets to select specific cells
 */
function trimCenterExport(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): string | null {
  const region = document.createElement("canvas");
  region.width = sw;
  region.height = sh;
  const rctx = region.getContext("2d", { willReadFrequently: true });
  if (rctx === null) return null;
  rctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  let pixels: Uint8ClampedArray;
  try {
    pixels = rctx.getImageData(0, 0, sw, sh).data;
  } catch {
    return null;
  }

  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;
  let hasPixels = false;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const alpha = pixels[(y * sw + x) * 4 + 3] ?? 0;
      if (alpha >= ALPHA_MIN) {
        hasPixels = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!hasPixels) return null;

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const side = Math.max(boxW, boxH) + PAD_PX * 2;
  if (side > MAX_SPRITE_SIZE) {
    console.warn(
      `DigimonSprite: trimmed sprite exceeded max size (${side}px > ${MAX_SPRITE_SIZE}px); skipping export`,
    );
    return null;
  }

  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const octx = out.getContext("2d");
  if (octx === null) return null;
  octx.imageSmoothingEnabled = false;
  const ox = PAD_PX + Math.floor((side - PAD_PX * 2 - boxW) / 2);
  const oy = PAD_PX + Math.floor((side - PAD_PX * 2 - boxH) / 2) + OFFSET_Y;
  octx.drawImage(region, minX, minY, boxW, boxH, ox, oy, boxW, boxH);
  return out.toDataURL("image/png");
}

/**
 * Cell size is derived from the sheet's ACTUAL pixel dimensions, never
 * hardcoded, so a user-supplied 32x32 sheet (16x16 cells) slices the same way
 * as the authored 64x64 sheets (32x32 cells). A hardcoded 32px cell would
 * collapse a 32x32 sheet into a single frame and freeze the walk cycle.
 */
function cellSizeOf(img: HTMLImageElement): { cellW: number; cellH: number } {
  const w = img.naturalWidth || 64;
  const h = img.naturalHeight || 64;
  return {
    cellW: Math.max(1, Math.floor(w / SHEET_COLS)),
    cellH: Math.max(1, Math.floor(h / SHEET_ROWS)),
  };
}

async function extractSingleFrame(
  catalogId: string,
  frameIndex = 0,
): Promise<string | null> {
  try {
    const img = await loadImage(unitSpriteStaticUrl(catalogId));
    const { cellW, cellH } = cellSizeOf(img);
    const cellX = (frameIndex % SHEET_COLS) * cellW;
    const cellY = Math.floor(frameIndex / SHEET_COLS) * cellH;
    return trimCenterExport(img, cellX, cellY, cellW, cellH);
  } catch {
    /* static cell missing — try slicing it off the 2×2 sheet */
  }
  try {
    const img = await loadImage(unitSpriteSheetUrl(catalogId));
    const { cellW, cellH } = cellSizeOf(img);
    const cellX = (frameIndex % SHEET_COLS) * cellW;
    const cellY = Math.floor(frameIndex / SHEET_COLS) * cellH;
    return trimCenterExport(img, cellX, cellY, cellW, cellH);
  } catch {
    if (import.meta.env.DEV) {
      console.warn(
        `[DigimonSprite] Failed to load ${catalogId} frame ${frameIndex}`,
      );
    }
  }
  return null;
}

/** catalogId:frameIndex → extracted-frame promise; shared across every mounted instance. */
const frameCache = new Map<string, Promise<string | null>>();

function frameFor(catalogId: string, frameIndex = 0): Promise<string | null> {
  const key = `${catalogId}:${frameIndex}`;
  const existing = frameCache.get(key);
  if (existing !== undefined) {
    // LRU touch: move to most-recently-used end.
    frameCache.delete(key);
    frameCache.set(key, existing);
    return existing;
  }

  // Evict oldest entry when over capacity.
  if (frameCache.size >= MAX_CACHE_SIZE) {
    const oldest = frameCache.keys().next().value;
    if (oldest !== undefined) frameCache.delete(oldest);
  }

  const created = extractSingleFrame(catalogId, frameIndex);
  frameCache.set(key, created);
  return created;
}

/**
 * THE canonical 2D digimon display. Every DOM surface that shows a digimon
 * sprite (digidex, roster, lobby, cards...) renders through this component —
 * never through a raw asset URL. Guarantees exactly ONE digimon, alpha-trimmed
 * and centered, regardless of how the source cell was packed:
 *   1. static cell (`/assets/sprites-static/<id>.png`) → trim + center
 *   2. walk cell sliced from the 2×2 sheet (`/assets/sprites/<id>.png`)
 *   3. hidden (layout never breaks)
 * - 'portrait' variant passes the full portrait art through untouched.
 */
export const DigimonSprite = memo(function DigimonSprite({
  catalogId,
  variant = "sprite",
  className,
  alt = "",
  frameIndex,
}: DigimonSpriteProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(
    variant === "portrait" ? portraitUrl(catalogId) : null,
  );
  const [hidden, setHidden] = useState(false);

useEffect(() => {
    setHidden(false);
    if (variant === "portrait") {
      setSrc(portraitUrl(catalogId));
      return;
    }
    let alive = true;
    setSrc(null);
    void frameFor(catalogId, frameIndex ?? 0).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [catalogId, variant, frameIndex]);

  if (hidden || src === null) return <></>;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
        imageRendering: "pixelated",
      }}
      onError={() => setHidden(true)}
    />
  );
});
