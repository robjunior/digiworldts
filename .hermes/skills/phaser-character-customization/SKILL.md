---
name: phaser-character-customization
description: |
  Character customization system for Phaser-based dungeon crawlers.
  Creates player sprites from layered components (face, hair, hat, outfits)
  that composite into a single sprite, with followers trailing
  the player at 1-tile (32px) intervals in the dungeon.
category: game-development
trigger: |
  Use when implementing character customization for a Phaser game with layered sprite components
  (base face, hair, hat, clothes) that composite into a single sprite, with followers trailing
  the player. Also use when integrating tile-based follower distance AI (1, 2, or 3 tiles).
example: |
  const customization = new CharacterCustomization();
  customization.faceType = 1;
  customization.hairStyle = 'long';
  customization.hatType = 'cap';
  customization.upperOutfit = 'jacket';
  customization.lowerOutfit = 'pants';
  customization.skinColor = '#FFD700';
  customization.hairColor = '#8B4513';
  customization.outfitColor = '#FF0000';
  const textureKey = generateCharacterTexture(scene, customization);
  const player = spawnPlayerCharacter(scene, customization, 400, 300);
  spawnFollowers(scene, player, 3);
  // In update loop: updateFollowers(player, player.followers);
  // Followers maintain 1-tile intervals: 32px, 64px, 96px from player
yaml frontmatter: |
  ---
name: phaser-character-customization
description: |
  Character customization system for Phaser-based dungeon crawlers.
  Creates player sprites from layered components (face, hair, hat, outfits)
  with 1-tile follower distance AI for dungeon integration.
category: game-development
trigger: |
  Use when implementing character customization for a Phaser game with layered sprite components
  (base face, hair, hat, clothes) that composite into a single sprite, with followers trailing
  the player. Also use when integrating tile-based follower distance AI (1, 2, or 3 tiles).
example: |
  const customization = new CharacterCustomization();
  customization.faceType = 1;
  customization.hairStyle = 'long';
  customization.hatType = 'cap';
  customization.upperOutfit = 'jacket';
  customization.lowerOutfit = 'pants';
  customization.skinColor = '#FFD700';
  customization.hairColor = '#8B4513';
  customization.outfitColor = '#FF0000';
  const textureKey = generateCharacterTexture(scene, customization);
  const player = spawnPlayerCharacter(scene, customization, 400, 300);
  spawnFollowers(scene, player, 3);
  // In update loop: updateFollowers(player, player.followers);
  // Followers maintain 1-tile intervals: 32px, 64px, 96px from player
---