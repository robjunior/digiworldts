/**
 * CharacterCustomization - State manager for character appearance
 * Stores all customization options and provides export/import methods
 */
export class CharacterCustomization {
  faceType: number;
  hairStyle: string;
  hatType: string;
  upperOutfit: string;
  lowerOutfit: string;
  skinColor: string;
  hairColor: string;
  outfitColor: string;

  constructor() {
    this.faceType = 0;
    this.hairStyle = 'none';
    this.hatType = 'none';
    this.upperOutfit = 'none';
    this.lowerOutfit = 'none';
    this.skinColor = '#FFD700';
    this.hairColor = '#8B4513';
    this.outfitColor = '#FF0000';
  }

  toJSON() {
    return {
      faceType: this.faceType,
      hairStyle: this.hairStyle,
      hatType: this.hatType,
      upperOutfit: this.upperOutfit,
      lowerOutfit: this.lowerOutfit,
      skinColor: this.skinColor,
      hairColor: this.hairColor,
      outfitColor: this.outfitColor,
    };
  }

  fromJSON(data: {
    faceType?: number;
    hairStyle?: string;
    hatType?: string;
    upperOutfit?: string;
    lowerOutfit?: string;
    skinColor?: string;
    hairColor?: string;
    outfitColor?: string;
  }): void {
    if (data.faceType !== undefined) this.faceType = data.faceType;
    if (data.hairStyle !== undefined) this.hairStyle = data.hairStyle;
    if (data.hatType !== undefined) this.hatType = data.hatType;
    if (data.upperOutfit !== undefined) this.upperOutfit = data.upperOutfit;
    if (data.lowerOutfit !== undefined) this.lowerOutfit = data.lowerOutfit;
    if (data.skinColor !== undefined) this.skinColor = data.skinColor;
    if (data.hairColor !== undefined) this.hairColor = data.hairColor;
    if (data.outfitColor !== undefined) this.outfitColor = data.outfitColor;
  }

  reset(): void {
    this.faceType = 0;
    this.hairStyle = 'none';
    this.hatType = 'none';
    this.upperOutfit = 'none';
    this.lowerOutfit = 'none';
    this.skinColor = '#FFD700';
    this.hairColor = '#8B4513';
    this.outfitColor = '#FF0000';
  }
}

/**
 * Available face types extracted from the base-walk-character sprite sheet
 * Sheet is 96x120 pixels with 6 columns × 8 rows of 16x16 cells
 */
export const faceTypes = ['face-0', 'face-1', 'face-2', 'face-3', 'face-4', 'face-5'];

/**
 * Available hair styles
 */
export const hairStyles = ['none', 'short', 'long', 'spiky', 'curly', 'bald'];

/**
 * Available headwear/hat types
 */
export const hatTypes = ['none', 'cap', 'hood', 'helmet', 'headband'];

/**
 * Available upper outfit types
 */
export const upperOutfits = ['none', 'shirt', 'jacket', 'armor', 'hoodie', 'formal'];

/**
 * Available lower outfit types
 */
export const lowerOutfits = ['none', 'pants', 'skirt', 'shorts', 'leggings'];

/**
 * Available skin tone colors
 */
export const skinColors = [
  '#FFD700', /* Gold */
  '#FFA500', /* Orange */
  '#FF69B4', /* Pink */
  '#1E90FF', /* Blue */
  '#90EE90', /* Light Green */
  '#87CEEB', /* Sky Blue */
];

/**
 * Available outfit color variations
 */
export const outfitColors = [
  '#FF0000', /* Red */
  '#FF8C00', /* OrangeRed */
  '#FFD700', /* Gold */
  '#4682B4', /* SteelBlue */
  '#2E8B57', /* SeaGreen */
  '#8B4513', /* Brown */
];