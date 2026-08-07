import { RARITY_COLOR, RARITY_LABEL_EN, RARITY_LABEL_PT, type Rarity } from '@digiworld/shared/item-rarity';

import { useFlag } from '../../hooks/useFlag';
import { getLocale } from '../../lib/locale';

const FEATURE_FLAG = 'rarity-visible';

export function RarityBadge({ rarity }: { readonly rarity: Rarity | undefined }): JSX.Element | null {
  const visible = useFlag(FEATURE_FLAG);
  if (!visible || rarity === undefined) return null;
  const label = getLocale() === 'pt' ? RARITY_LABEL_PT[rarity] : RARITY_LABEL_EN[rarity];
  return (
    <span
      className={`rarity-badge rarity-badge--${rarity}`}
      style={{ borderColor: RARITY_COLOR[rarity], color: RARITY_COLOR[rarity] }}
    >
      {label}
    </span>
  );
}
