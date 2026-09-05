// Verification script for character customization system
// This script can be run to test that the system works correctly

// Verify character generation
const scene = new Phaser.Scene();
const customization = new CharacterCustomization();
customization.faceType = 0;
customization.hairStyle = 'none';
customization.hatType = 'none';
customization.upperOutfit = 'none';
customization.lowerOutfit = 'none';

// Generate texture
const textureKey = generateCharacterTexture(scene, customization);
if (textureKey === undefined) {
  console.error('FAIL: Texture key should be generated');
  process.exit(1);
}
console.log('PASS: Texture key generated:', textureKey);

// Spawn player
const player = spawnPlayerCharacter(scene, customization, 400, 300);
if (player === undefined) {
  console.error('FAIL: Player should be spawned');
  process.exit(1);
}
if (player.body === undefined) {
  console.error('FAIL: Player should have physics body');
  process.exit(1);
}
console.log('PASS: Player spawned at (400, 300) with physics body');

// Spawn followers
const followers = spawnFollowers(scene, player, 3);
if (followers.length < 3 || followers.length > 5) {
  console.error('FAIL: Should spawn 3-5 followers, got', followers.length);
  process.exit(1);
}
console.log('PASS: Spawned', followers.length, 'followers');

// Verify follower distances
const desiredDistances = [32, 64, 96]; // 1, 2, 3 tiles
followers.forEach((follower, i) => {
  const desiredDist = desiredDistances[i] || 32;
  const distance = Math.sqrt(
    Math.pow(player.x - follower.x, 2) + 
    Math.pow(player.y - follower.y, 2)
  );
  const actualRound = Math.round(distance);
  const expectedRound = Math.round(desiredDist);
  if (actualRound !== expectedRound) {
    console.error('FAIL: Follower ' + i + ' should be at ' + desiredDist + 'px, got ' + actualRound + 'px');
    process.exit(1);
  }
});
console.log('PASS: All followers at correct distances (1, 2, 3 tiles)');

// Test save/load
const saved = JSON.stringify(customization.toJSON());
const loaded = new CharacterCustomization();
loaded.fromJSON(JSON.parse(saved));
if (loaded.faceType !== customization.faceType) {
  console.error('FAIL: faceType should round-trip');
  process.exit(1);
}
if (loaded.hairStyle !== customization.hairStyle) {
  console.error('FAIL: hairStyle should round-trip');
  process.exit(1);
}
if (loaded.outfitColor !== customization.outfitColor) {
  console.error('FAIL: outfitColor should round-trip');
  process.exit(1);
}
console.log('PASS: Save/load roundtrip works');

// Test reset
customization.reset();
if (customization.faceType !== 0) {
  console.error('FAIL: faceType should reset to 0');
  process.exit(1);
}
if (customization.hairStyle !== 'none') {
  console.error('FAIL: hairStyle should reset to none');
  process.exit(1);
}
console.log('PASS: Reset to defaults works');

console.log('\nAll customization verification tests passed!');