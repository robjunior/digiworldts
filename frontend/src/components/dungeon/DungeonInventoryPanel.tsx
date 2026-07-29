import type { ReactElement } from 'react';

import { useT } from '../../hooks/useLocale';
import type { InventoryItemView, ShopItemView } from '../../lib/api-shop';

type DungeonInventoryPanelProps = {
  readonly inventory: readonly InventoryItemView[];
  readonly productById: ReadonlyMap<string, ShopItemView>;
  readonly selectedItemId: string | null;
  readonly busy: boolean;
  readonly onSelectItem: (itemId: string, needsMon: boolean) => void;
};

const NON_USABLE_KINDS = new Set(['evolve', 'cosmetic', 'building_placement']);
const GLOBAL_KINDS = new Set(['xp_mult']);

function inferKind(product: ShopItemView | undefined, name: string): string {
  if (product) return product.kind;
  const lower = name.toLowerCase();
  if (lower.includes('revive') || lower.includes('resurrect')) return 'revive';
  if (lower.includes('focus') || lower.includes('boost') || lower.includes('xp')) return 'xp_mult';
  return 'consumable';
}

function kindGlyph(kind: string): ReactElement {
  switch (kind) {
    case 'revive':
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 21s-8-5.5-8-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-8 11-8 11z" /><path d="M9 12h6M12 9v6" strokeLinecap="round" /></svg>);
    case 'xp_mult':
      return (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.4 6.6L21 11l-5 4.5L17.4 22 12 18.5 6.6 22 8 15.5 3 11l6.6-1.4z" /></svg>);
    case 'consumable':
    default:
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 4h8l2 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8z" /><path d="M6 8h12M10 12h4" strokeLinecap="round" /></svg>);
  }
}

function elementForItem(kind: string, name: string): string {
  if (kind === 'revive') return 'plant';
  if (kind === 'xp_mult') return 'light';
  const lower = name.toLowerCase();
  if (lower.includes('hp') || lower.includes('heal') || lower.includes('life')) return 'plant';
  if (lower.includes('en') || lower.includes('energy') || lower.includes('mp')) return 'electricity';
  if (lower.includes('fire')) return 'fire';
  if (lower.includes('water')) return 'water';
  return 'null';
}

export function DungeonInventoryPanel({ inventory, productById, selectedItemId, busy, onSelectItem }: DungeonInventoryPanelProps): ReactElement {
  const t = useT();
  const usable = inventory.filter((entry) => {
    if (entry.qty <= 0) return false;
    const product = productById.get(entry.itemId);
    if (product && NON_USABLE_KINDS.has(product.kind)) return false;
    return true;
  });

  return (
    <div className="dp-inv">
      <div className="dp-inv-hd">
        <span className="dp-inv-title">{t('dungeon.inventory')}</span>
        <span className="dp-inv-count">{usable.length}</span>
      </div>
      {usable.length === 0 ? (
        <div className="dp-inv-empty">{t('dungeon.no_usable_items')}</div>
      ) : (
        <div className="dp-inv-grid">
          {usable.map((entry) => {
            const product = productById.get(entry.itemId);
            const kind = inferKind(product, entry.name);
            const isSelected = selectedItemId === entry.itemId;
            const isGlobal = GLOBAL_KINDS.has(kind);
            const element = elementForItem(kind, entry.name);
            const description = entry.description || product?.description || '';
            return (
              <button
                key={entry.itemId}
                type="button"
                className={`dp-tile${isSelected ? ' is-selected' : ''}`}
                data-element={element}
                style={{ ['--el' as string]: `var(--el-${element})` }}
                onClick={() => onSelectItem(entry.itemId, !isGlobal)}
                disabled={busy}
                aria-pressed={isSelected}
                aria-label={`${entry.name}, ${entry.qty} in stock${isGlobal ? ' — activate now' : ' — click then pick a party member'}`}
              >
                <span className="dp-tile-ic" aria-hidden="true">{kindGlyph(kind)}</span>
                <span className="dp-tile-qty">×{entry.qty}</span>
                <span className="dp-tip" role="tooltip">
                  <span className="dp-tip-nm">{entry.name}</span>
                  {description ? <span className="dp-tip-ds">{description}</span> : null}
                  <span className="dp-tip-act">{isGlobal ? 'Click to activate now' : 'Click, then pick a party member'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
