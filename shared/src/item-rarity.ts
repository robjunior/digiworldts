export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export type Rarity = (typeof RARITIES)[number];

export const RARITY_RANK: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export const RARITY_BY_RANK: readonly Rarity[] = RARITIES;

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

export const RARITY_LABEL_EN: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export const RARITY_LABEL_PT: Record<Rarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  epic: 'Épico',
  legendary: 'Lendário',
};

export function rarityFromRankOrCommon(rank: number): Rarity {
  if (!Number.isInteger(rank) || rank < 0 || rank >= RARITIES.length) {
    return 'common';
  }
  return RARITIES[rank]!;
}

export function compareRarity(a: Rarity, b: Rarity): number {
  return RARITY_RANK[a] - RARITY_RANK[b];
}
