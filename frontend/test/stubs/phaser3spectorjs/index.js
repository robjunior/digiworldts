// Stub package for `phaser3spectorjs`, an optional Phaser debug dependency that
// Phaser's WebGL renderer unconditionally `require`s under the unbundled source
// (its production build normally strips this via webpack's DefinePlugin). It is
// never exercised by the HEADLESS renderer used in tests, so an empty module is
// sufficient. Wired into resolution via a pnpm.overrides entry in package.json.
export default {};
export const SPECTOR = class {};
