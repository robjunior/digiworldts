// Ensures the optional `phaser3spectorjs` module resolves when Phaser is present.
//
// Phaser's unbundled source unconditionally `require('phaser3spectorjs')` from its
// WebGL renderer, but the package is never actually declared as a dependency (it is
// normally stripped by webpack's DefinePlugin in the real build). Under vitest /
// Node the require fails and breaks any test that imports Phaser. We drop a tiny
// stub package into the repo-root node_modules so Node's CJS resolution (which
// walks up from Phaser's pnpm-store location) finds it. node_modules is
// gitignored, so this guard recreates the stub after every install.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stubSrc = resolve(root, "frontend/test/stubs/phaser3spectorjs");
const dest = resolve(root, "node_modules/phaser3spectorjs");

// Only act when Phaser is actually installed (don't create noise otherwise).
const phaserEntry = resolve(
  root,
  "node_modules/.pnpm/phaser@3.90.0/node_modules/phaser/package.json",
);
if (!existsSync(phaserEntry)) {
  // Phaser not installed yet — nothing to do.
  process.exit(0);
}

if (existsSync(dest)) {
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const name of ["package.json", "index.js"]) {
  const from = resolve(stubSrc, name);
  if (!existsSync(from)) {
    console.error(`[postinstall] missing stub source: ${from}`);
    process.exit(1);
  }
  writeFileSync(resolve(dest, name), readFileSync(from));
}
console.log("[postinstall] linked phaser3spectorjs stub into node_modules");
