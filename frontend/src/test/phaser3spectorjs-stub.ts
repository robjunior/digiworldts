// Dummy stand-in for `phaser3spectorjs`, an optional Phaser dependency that the
// WebGL renderer requires at module-load time. It is never actually exercised by
// the HEADLESS renderer used in tests, so an empty module is sufficient to let
// Phaser's import graph resolve under vitest.
export default {};
