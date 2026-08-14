import Phaser from 'phaser';

import { DungeonPhaserScene } from './DungeonPhaserScene';

/**
 * Build the Phaser.Game for the dungeon renderer, mounted into `container`.
 * Config is locked by the plan: AUTO renderer, pixel-art (nearest-neighbor,
 * no anti-aliasing), `scale.mode: NONE` — the wrapper resizes explicitly via
 * `game.scale.resize(w, h)` on a ResizeObserver.
 */
export function createDungeonGame(container: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    render: { antialiasGL: false },
    scale: { mode: Phaser.Scale.NONE },
    width: container.clientWidth || 800,
    height: container.clientHeight || 600,
    backgroundColor: '#1c1f2a',
    scene: DungeonPhaserScene,
  });
}
