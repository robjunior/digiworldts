import { memo, useEffect, useState } from "react";

import {
  DEFAULT_IDLE_CELL,
  resolveSheetLayout,
  unitSpriteSheetUrl,
  unitSpriteStaticUrl,
  type SheetLayout,
} from "@digiworld/scene3d";

const portraitUrl = (catalogId: string) =>
  `/assets/digimon/${catalogId}/portrait.webp`;

/** Alpha >= this counts as digimon pixels (mirrors scene3d ALPHA_THRESHOLD). */
const ALPHA_MIN = 24;
/** Transparent breathing room around the trimmed silhouette, in px. */
const PAD_PX = 1;
/** Vertical offset applied after centering (positive = move down). Fixes top cropping. */
const OFFSET_Y = 2;
/** Hard cap on the number of cached frame promises. LRU evicts the oldest. */
const MAX_CACHE_SIZE = 500;
/** Max trimmed output side in px; guards against pathological huge sprites. */
const MAX_SPRITE_SIZE = 512;

type DigimonSpriteVariant = "sprite" | "portrait";

type DigimonSpriteProps = {
  /** Catalog id, e.g. `skb-317` (or the integer form `317`). */
  readonly catalogId: string;
  /** Which visual to show: 'sprite' = trimmed frame; 'portrait' = full portrait art. */
  readonly variant?: DigimonSpriteVariant;
  /** Extra class names merged onto the <img>. */
  readonly className?: string;
  /** Accessible label; defaults to empty (decorative). */
  readonly alt?: string;
  /**
   * Explicit 0-based cell index into the sheet grid. When omitted, the sheet's
   * resting/idle frame is chosen automatically (frame 0 on legacy 2×2 sheets,
   * the first happy frame on new 3×4 twelve-frame sheets).
   */
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
 * Draw the sheet region for a cell (using the sheet's real layout), trim
 * transparent margins, center the remaining silhouette in a tight square,
 * export as a PNG data URL. Returns null when the canvas is unavailable or the
 * region is fully transparent.
 */
function trimCenterExport(
  img: HTMLImageElement,
  layout: SheetLayout,
  cell: number,
): string | null {
  const col = cell % layout.cols;
  const row = Math.floor(cell / layout.cols);
  const sx = col * layout.cellW;
  const sy = row * layout.cellH;
  const sw = layout.cellW;
  const sh = layout.cellH;
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
 * Cell size and grid are derived from the sheet's ACTUAL pixel dimensions via
 * the shared `resolveSheetLayout` (square → legacy 2×2, non-square → new 3×4),
 * so user-supplied 32×32 sheets, authored 64×64 sheets, and the upcoming
 * twelve-frame sheets all slice correctly.
 */
function layoutOf(img: HTMLImageElement): SheetLayout {
  return resolveSheetLayout(img.naturalWidth || 64, img.naturalHeight || 64);
}

async function extractSingleFrame(
  catalogId: string,
  frameIndex: number,
): Promise<string | null> {
  // Resolve which cell to show: an explicit frameIndex wins; otherwise the
  // layout's resting/idle frame (happy on the new twelve-frame sheets).
  let cell = frameIndex;
  let layout: SheetLayout | null = null;

  const pickCell = (img: HTMLImageElement): number => {
    const l = layoutOf(img);
    layout = l;
    const explicit = !Number.isNaN(frameIndex) && frameIndex >= 0;
    return explicit ? (frameIndex % (l.cols * l.rows)) : DEFAULT_IDLE_CELL[l.version];
  };

  try {
    const img = await loadImage(unitSpriteStaticUrl(catalogId));
    const l = layoutOf(img);
    layout = l;
    cell = !Number.isNaN(frameIndex) && frameIndex >= 0 ? (frameIndex % (l.cols * l.rows)) : DEFAULT_IDLE_CELL[l.version];
    const out = trimCenterExport(img, l, cell);
    if (out !== null) return out;
  } catch {
    /* static cell missing — try slicing it off the sheet */
  }
  try {
    const img = await loadImage(unitSpriteSheetUrl(catalogId));
    const l = layoutOf(img);
    let c: number;
    if (layout !== null) c = cell; // keep the static-path resolution
    else c = !Number.isNaN(frameIndex) && frameIndex >= 0 ? (frameIndex % (l.cols * l.rows)) : DEFAULT_IDLE_CELL[l.version];
    return trimCenterExport(img, l, c);
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

function frameFor(catalogId: string, frameIndex: number): Promise<string | null> {
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
 *   2. a resting/idle cell sliced from the sheet (`/assets/sprites/<id>.png`)
 *   3. hidden (layout never breaks)
 * The sheet layout is auto-detected (legacy 2×2 vs new 3×4 twelve-frame), and
 * the default cell is the sheet's resting pose.
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
    void frameFor(catalogId, frameIndex ?? -1).then((url) => {
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
