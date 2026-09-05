/**
 * CharacterGeneration - Creates composite character sprite from customization options
 * Uses Phaser graphics API to layer: base → hair → hat → outfit → accessories
 * Integrates with dungeon tilemap (32px tiles) and party system
 */

// Face frame map: face type -> {row, col} in the sprite sheet
export const faceFrameMap: Record<string, { row: number; col: number }> = {
  'face-0': { row: 0, col: 0 },
  'face-1': { row: 0, col: 1 },
  'face-2': { row: 0, col: 2 },
  'face-3': { row: 0, col: 3 },
  'face-4': { row: 0, col: 4 },
  'face-5': { row: 0, col: 5 },
};

/**
 * Hair frame positions - each hair style has a specific offset from the base face
 */
export const hairFramePositions: Record<string, { x: number; y: number; frame: number | null }> = {
  'none': { x: 0, y: 0, frame: null },
  'short': { x: 0, y: -4, frame: 0 },
  'long': { x: 0, y: -8, frame: 1 },
  'spiky': { x: 0, y: -6, frame: 2 },
  'curly': { x: 0, y: -7, frame: 3 },
};

/**
 * Headwear frame positions - drawn on top of hair
 */
export const hatFramePositions: Record<string, { x: number; y: number; frame: number | null }> = {
  'none': { x: 0, y: 0, frame: null },
  'cap': { x: 0, y: -12, frame: 0 },
  'hood': { x: 0, y: -10, frame: 1 },
  'helmet': { x: 0, y: -14, frame: 2 },
};

/**
 * Upper outfit layer positions
 */
export const upperOutfitPositions: Record<string, { x: number; y: number }> = {
  'none': { x: 0, y: 0 },
  'shirt': { x: 0, y: 16 },
  'jacket': { x: 0, y: 16 },
  'armor': { x: 0, y: 16 },
  'hoodie': { x: 0, y: 16 },
  'formal': { x: 0, y: 16 },
};

/**
 * Lower outfit layer positions
 */
export const lowerOutfitPositions: Record<string, { x: number; y: number }> = {
  'none': { x: 0, y: 0 },
  'pants': { x: 0, y: 32 },
  'skirt': { x: 0, y: 32 },
  'shorts': { x: 0, y: 32 },
  'leggings': { x: 0, y: 32 },
};

/**
 * TILE_SIZE for the dungeon grid - matches the tileset used in DungeonPhaserScene
 */
export const TILE_SIZE = 32;

/**
 * Generate a composite character texture from customization options
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {Object} customization - Object with faceType, hairStyle, hatType, upperOutfit, lowerOutfit
 * @returns {string} - Phaser texture key for the composite sprite
 */
export function generateCharacterTexture(scene: Phaser.Scene, customization: {
  faceType: number;
  hairStyle: string;
  hatType: string;
  upperOutfit: string;
  lowerOutfit: string;
}): string {
  const { faceType, hairStyle, hatType, upperOutfit, lowerOutfit } = customization;

  // Create a render texture to composite all layers
  const renderTexture = scene.textures.createDynamic(
    `character-${faceType}-${hairStyle}-${hatType}-${upperOutfit}-${lowerOutfit}`,
    64,
    64
  );

  // Start drawing to the render texture
  renderTexture.beginDraw();
  renderTexture.clear();

  // 1. Draw BASE face/head layer
  const faceConfig = faceFrameMap[faceTypes[faceType]];
  if (faceConfig) {
    renderTexture.draw(
      'base-walk-character',
      16, 16,
      faceTypes[faceType]
    );
  }

  // 2. Draw HAIR layer on top of head
  const hairPos = hairFramePositions[hairStyle];
  if (hairStyle !== 'none' && hairPos) {
    renderTexture.fillStyle('#8B4513');
    renderTexture.fillRect(20, 8, 12, 12);
  }

  // 3. Draw HEADWEAR layer on top of hair
  const hatPos = hatFramePositions[hatType];
  if (hatType !== 'none' && hatPos) {
    renderTexture.fillStyle('#555555');
    renderTexture.fillRect(20, 0, 12, 8);
  }

  // 4. Draw BODY/upper outfit layer
  const upperPos = upperOutfitPositions[upperOutfit];
  if (upperOutfit !== 'none' && upperPos) {
    renderTexture.fillStyle('#FF0000');
    renderTexture.fillRect(16, 32, 32, 16);
  }

  // 5. Draw LOWER outfit layer
  const lowerPos = lowerOutfitPositions[lowerOutfit];
  if (lowerOutfit !== 'none' && lowerPos) {
    renderTexture.fillStyle('#FF0000');
    renderTexture.fillRect(16, 48, 32, 16);
  }

  // End drawing to the render texture
  renderTexture.endDraw();

  // Add the generated texture to the Phaser texture manager
  scene.textures.addImage(
    `character-${faceType}-${hairStyle}-${hatType}-${upperOutfit}-${lowerOutfit}`,
    renderTexture
  );

  return `character-${faceType}-${hairStyle}-${hatType}-${upperOutfit}-${lowerOutfit}`;
}

/**
 * Spawn the player character in the existing game scene
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {Object} customization - Object with faceType, hairStyle, hatType, upperOutfit, lowerOutfit
 * @param {number} x - X position to spawn
 * @param {number} y - Y position to spawn
 * @returns {Phaser.GameObjects.Sprite} - The player sprite
 */
export function spawnPlayerCharacter(scene: Phaser.Scene, customization: {
  faceType: number;
  hairStyle: string;
  hatType: string;
  upperOutfit: string;
  lowerOutfit: string;
  skinColor?: string;
  hairColor?: string;
  outfitColor?: string;
}, x: number, y: number) {
  // Destroy any existing player character
  if (scene.playerCharacter) {
    scene.playerCharacter.destroy();
  }

  // Generate the composite texture
  const textureKey = generateCharacterTexture(scene, {
    faceType: customization.faceType,
    hairStyle: customization.hairStyle,
    hatType: customization.hatType,
    upperOutfit: customization.upperOutfit,
    lowerOutfit: customization.lowerOutfit,
  });

  // Create the player sprite with the generated texture
  const player = scene.physics.add.sprite(x, y, textureKey);

  // Set initial frame
  player.setFrame(0);

  // Set physics body size
  player.body.setSize(16, 16);

  // Store customization on the player object
  player.customization = customization;

  // Store reference on scene
  scene.playerCharacter = player;

  return player;
}

/**
 * Spawn follower Digimon sprites tied to the player
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {Phaser.GameObjects.Sprite} player - The player character
 * @param {number} count - Number of followers to spawn (3-5)
 * @returns {Array} - Array of follower sprites
 */
export function spawnFollowers(scene: Phaser.Scene, player: Phaser.GameObjects.Sprite, count: number = 3) {
  // Ensure count is within 3-5 range
  const followerCount = Math.max(3, Math.min(5, count));

  // Destroy any existing followers
  if (scene.followers) {
    scene.followers.forEach((follower: Phaser.GameObjects.Sprite) => {
      follower.destroy();
    });
  }

  // 1 tile = 32px in the dungeon tilemap
  const desiredDistances = [TILE_SIZE, TILE_SIZE * 2, TILE_SIZE * 3]; // 1, 2, 3 tiles

  const followers: Phaser.GameObjects.Sprite[] = [];

  for (let i = 0; i < followerCount; i++) {
    const desiredDist = desiredDistances[i] || TILE_SIZE * 2;
    const followerColor = (0xFF0000 * (i + 1)) % 0x1000000;

    const follower = scene.physics.add.sprite(
      player.x,
      player.y - desiredDist,
      'dot'
    );

    follower.setTint(followerColor);
    follower.body.setSize(12, 12);

    follower.custom = {
      index: i,
      desiredDistance: desiredDist,
      color: followerColor,
      type: `digimon-${i}`
    };

    followers.push(follower);
  }

  scene.followers = followers;
  return followers;
}

/**
 * Update follower positions in the game loop
 * This should be called from the main update loop
 * @param {Phaser.GameObjects.Sprite} player - The player character
 * @param {Array} followers - Array of follower sprites
 */
export function updateFollowers(player: Phaser.GameObjects.Sprite, followers: Phaser.GameObjects.Sprite[]) {
  if (!player || !followers.length) return;

  // 1 tile = 32px in the dungeon tilemap
  const TILE_SIZE = 32;

  followers.forEach((follower: Phaser.GameObjects.Sprite) => {
    const custom = follower.custom;
    if (!custom) return;

    const desiredDist = custom.desiredDistance;

    // Calculate vector from follower to player
    const dx = player.x - follower.x;
    const dy = player.y - follower.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If distance > target distance, move toward player
    if (distance > desiredDist) {
      const angle = Math.atan2(dy, dx);

      // Move toward player at reduced speed - tile-based movement
      const moveSpeed = TILE_SIZE; // 32px per update cycle
      const moveX = Math.cos(angle) * moveSpeed;
      const moveY = Math.sin(angle) * moveSpeed;

      follower.x += moveX;
      follower.y += moveY;
    } else {
      // Stop moving - idle at position
      follower.setVelocity(0, 0);
    }

    // Apply tint
    follower.setTint(custom.color);
  });
}