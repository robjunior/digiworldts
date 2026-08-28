// Stub for phaser3spectorjs (optional Phaser debug dep). Phaser's WebGL renderer
// unconditionally requires it under the unbundled source; the HEADLESS renderer
// never uses it, so an empty module is enough for tests to import Phaser.
export default {};
export const SPECTOR = class {};
