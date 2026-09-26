import type { CSSProperties } from 'react';

import type { InventoryItemView, ShopItemKind, ShopItemView } from '../../lib/api-shop';

export type ShopFilter = 'all' | 'consumable' | 'evolve' | 'building_placement' | 'cosmetic' | 'battle_item';

export const SHOP_FILTERS: readonly { readonly label: string; readonly value: ShopFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Consumables', value: 'consumable' },
  { label: 'Chips', value: 'evolve' },
  { label: 'Buildings', value: 'building_placement' },
  { label: 'Cosmetics', value: 'cosmetic' },
  { label: 'Battle Items', value: 'battle_item' },
] as const;

export function kindLabel(kind: ShopItemKind): string {
  switch (kind) {
    case 'consumable':
      return 'Consumable';
    case 'evolve':
      return 'Evolution';
    case 'building_placement':
      return 'Building';
    case 'cosmetic':
      return 'Cosmetic';
    case 'xp_mult':
      return 'Booster';
    case 'revive':
      return 'Revive';
    case 'battle_item':
      return 'Battle Item';
    default:
      return kind;
  }
}

export function kindStyle(kind: ShopItemKind): KindStyle {
  switch (kind) {
    case 'consumable':
      return { '--kind-color': 'var(--signal)' };
    case 'evolve':
      return { '--kind-color': 'var(--gold)' };
    case 'building_placement':
      return { '--kind-color': 'var(--el-nature)' };
    case 'cosmetic':
      return { '--kind-color': 'var(--credits)' };
    case 'xp_mult':
      return { '--kind-color': 'var(--el-fire)' };
    case 'revive':
      return { '--kind-color': 'var(--battle)' };
    case 'battle_item':
      return { '--kind-color': 'var(--pvp)' };
    default:
      return { '--kind-color': 'var(--muted)' };
  }
}

export function isQuantityItem(kind: ShopItemKind): boolean {
  return kind === 'consumable' || kind === 'evolve' || kind === 'xp_mult' || kind === 'revive';
}

export function itemOwnedQty(item: ShopItemView, inventory: readonly InventoryItemView[]): number {
  return inventory.find((entry) => entry.itemId === item.id)?.qty ?? 0;
}

export type KindStyle = CSSProperties & {
  readonly '--kind-color': string;
};
