// Boilerplate for integrating character customization into an existing Phaser dungeon game

// When switching to customization scene
scene.launch('CustomizationScene', {
  onConfirm: (char) => {
    // Spawn player character at center
    const centerX = scene.cameras.main.worldView.x + scene.cameras.main.width / 2;
    const centerY = scene.cameras.main.worldView.y + scene.cameras.main.height / 2;
    const player = spawnPlayerCharacter(scene, char, centerX, centerY);
    scene.playerCharacter = player;
    
    // Spawn 3 followers at 1-tile distance
    spawnFollowers(scene, player, 3);
    
    // Initialize follower system
    const followerSystem = new FollowerSystem(player);
    followerSystem.spawnFollowers(scene, 3);
  }
});

// In main update loop
function update() {
  // Update follower AI
  if (window.followerSystem) {
    const delta = 1/60; // approximate delta time
    window.followerSystem.updateFollowers(delta);
  }
  
  // Existing update logic...
}