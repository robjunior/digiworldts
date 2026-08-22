import { useState } from 'react';

import { unitSpriteStaticUrl, unitDotUrl } from '@digiworld/scene3d';

type DigimonSpriteProps = {
  /** Catalog id, e.g. `skb-317` (or the integer form `317`). */
  readonly catalogId: string;
  /** Extra class names merged onto the <img>. */
  readonly className?: string;
  /** Accessible label; defaults to empty (decorative). */
  readonly alt?: string;
};

/**
 * Still/2D display of a digimon that reads from the generated sprite sheet's
 * static frame (`/assets/sprites-static/<id>.png`) instead of the legacy
 * `dot.gif`. If the static cell is missing it falls back to `dot.gif` (and if
 * that is missing too, hides itself — never breaks layout).
 */
export function DigimonSprite({ catalogId, className, alt = '' }: DigimonSpriteProps): JSX.Element {
  const [src, setSrc] = useState(() => unitSpriteStaticUrl(catalogId));
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={(ev) => {
        if (src !== unitDotUrl(catalogId)) {
          setSrc(unitDotUrl(catalogId));
          return;
        }
        ev.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}
