/**
 * FollowerSystem - Distance-based follower AI for Phaser games
 * Spawns 3-5 Digimon followers that trail the player character
 * Each follower maintains a configurable desired distance from the player
 */
export class FollowerSystem {
  player: Phaser.GameObjects.Sprite;
  followers: Phaser.GameObjects.Sprite[];

  constructor(player: Phaser.GameObjects.Sprite) {
    this.player = player;
    this.followers = [];
    this.spawned = false;
  }

  spawnFollowers(scene: Phaser.Scene, count: number = 3) {
    const followerCount = Math.max(3, Math.min(5, count));

    // Destroy any existing followers
    this.destroyFollowers();

    const desiredDistances = [35, 55, 75]; // 30-40, 50-60, 70-80px

    for (let i = 0; i < followerCount; i++) {
      const desiredDist = desiredDistances[i] || 50;
      const followerColor = this.getFollowerColor(i);

      const follower = scene.physics.add.sprite(
        this.player.x,
        this.player.y - desiredDist,
        'dot'
      );

      follower.setTint(followerColor);

      follower.custom = {
        index: i,
        desiredDistance: desiredDist,
        color: followerColor,
        type: `digimon-${i}`
      };

      this.followers.push(follower);
    }

    this.spawned = true;
    return this.followers;
  }

  updateFollowers(delta: number) {
    if (!this.player || !this.followers.length) return;

    this.followers.forEach((follower) => {
      const custom = follower.custom;
      if (!custom) return;

      const desiredDist = custom.desiredDistance;

      // Calculate vector from follower to player
      const dx = this.player.x - follower.x;
      const dy = this.player.y - follower.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If distance > target distance, move toward player
      if (distance > desiredDist) {
        const angle = Math.atan2(dy, dx);

        const moveSpeed = 130; // px/sec
        const moveX = Math.cos(angle) * moveSpeed * delta;
        const moveY = Math.sin(angle) * moveSpeed * delta;

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

  getFollowerColor(index: number): number {
    const colors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF];
    return colors[index] || 0xFFFFFF;
  }

  destroyFollowers() {
    this.followers.forEach((follower) => {
      if (follower && follower.destroy) {
        follower.destroy();
      }
    });
    this.followers = [];
    this.spawned = false;
  }
}