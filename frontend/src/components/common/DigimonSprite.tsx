import { useEffect, useState } from 'react';

import { unitDotUrl, unitSpriteSheetUrl, unitSpriteStaticUrl } from '@digiworld/scene3d';

const portraitUrl = (catalogId: string) => `/assets/digimon/${catalogId}/portrait.webp`;

/** Alpha >= this counts as digimon pixels (mirrors scene3d ALPHA_THRESHOLD). */
const ALPHA_MIN = 24;
/** Transparent breathing room around the trimmed silhouette, in px. */
const PAD_PX = 1;

type DigimonSpriteVariant = 'sprite' | 'portrait';

type DigimonSpriteProps = {
  /** Catalog id, e.g. `skb-317` (or the integer form `317`). */
  readonly catalogId: string;
  /** Which visual to show: 'sprite' = trimmed static frame; 'portrait' = full portrait art. */
  readonly variant?: DigimonSpriteVariant;
  /** Extra class names merged onto the <img>. */
  readonly className?: string;
  /** Accessible label; defaults to empty (decorative). */
  readonly alt?: string;
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
 */
function trimCenterExport(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): string | null {
  const region = document.createElement('canvas');
  region.width = sw;
  region.height = sh;
  const rctx = region.getContext('2d', { willReadFrequently: true });
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
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      if ((pixels[(y * sw + x) * 4 + 3] ?? 0) >= ALPHA_MIN) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const side = Math.max(boxW, boxH) + PAD_PX * 2;

  const out = document.createElement('canvas');
  out.width = side;
  out.height = side;
  const octx = out.getContext('2d');
  if (octx === null) return null;
  octx.imageSmoothingEnabled = false;
  const ox = PAD_PX + Math.floor((side - PAD_PX * 2 - boxW) / 2);
  const oy = PAD_PX + Math.floor((side - PAD_PX * 2 - boxH) / 2);
  octx.drawImage(region, minX, minY, boxW, boxH, ox, oy, boxW, boxH);
  return out.toDataURL('image/png');
}

async function extractSingleFrame(catalogId: string): Promise<string | null> {
  try {
    const img = await loadImage(unitSpriteStaticUrl(catalogId));
    return trimCenterExport(img, 0, 0, img.naturalWidth, img.naturalHeight);
  } catch {
    /* static cell missing — try slicing it off the 2×2 sheet */
  }
  try {
    const img = await loadImage(unitSpriteSheetUrl(catalogId));
    const w = img.naturalWidth || 64;
    const h = img.naturalHeight || 64;
    return trimCenterExport(img, 0, 0, Math.floor(w / 2), Math.floor(h / 2));
  } catch {
    /* sheet missing too */
  }
  return null;
}

/** catalogId → extracted-frame promise; shared across every mounted instance. */
const frameCache = new Map<string, Promise<string | null>>();

function frameFor(catalogId: string): Promise<string | null> {
  const existing = frameCache.get(catalogId);
  if (existing !== undefined) return existing;
  const created = extractSingleFrame(catalogId);
  frameCache.set(catalogId, created);
  return created;
}

/**
 * THE canonical 2D digimon display. Every DOM surface that shows a digimon
 * sprite (digidex, roster, lobby, cards...) renders through this component —
 * never through a raw asset URL. Guarantees exactly ONE digimon, alpha-trimmed
 * and centered, regardless of how the source cell was packed:
 *   1. static cell (`/assets/sprites-static/<id>.png`) → trim + center
 *   2. walk cell sliced from the 2×2 sheet (`/assets/sprites/<id>.png`)
 *   3. legacy `dot.gif`
 *   4. hidden (layout never breaks)
 * - 'portrait' variant passes the full portrait art through untouched.
 */
export function DigimonSprite({
  catalogId,
  variant = 'sprite',
  className,
  alt = '',
}: DigimonSpriteProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(
    variant === 'portrait' ? portraitUrl(catalogId) : null,
  );
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (variant === 'portrait') {
      setSrc(portraitUrl(catalogId));
      return;
    }
    let alive = true;
    setSrc(null);
    void frameFor(catalogId).then((url) => {
      if (alive) setSrc(url ?? unitDotUrl(catalogId));
    });
    return () => {
      alive = false;
    };
  }, [catalogId, variant]);

  if (hidden || src === null) return <></>;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        display: 'block',
        imageRendering: 'pixelated',
      }}
      onError={() => {
        if (src !== unitDotUrl(catalogId)) {
          setSrc(unitDotUrl(catalogId));
          return;
        }
        setHidden(true);
      }}
    />
  );
}
