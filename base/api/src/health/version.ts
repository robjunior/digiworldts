/**
 * Resolve the running application version WITHOUT hard-coding it (TASK-2).
 *
 * Resolution order (first hit wins), chosen so the value is correct in every way
 * the app runs — `pnpm dev`, `node dist/main.js`, tests, and containers:
 *
 *   1. `APP_VERSION` — explicit override (e.g. a release tag injected by CI/CD).
 *   2. `npm_package_version` — auto-set by npm/pnpm for any `run` script, so
 *      `pnpm dev`/`pnpm start` surface `apps/api/package.json`'s version for free.
 *   3. `apps/api/package.json` read from disk — the source of truth when neither
 *      env var is present (bare `node dist/main.js`, some test runners).
 *
 * Why read the file with `require` at call time instead of `import`ing the JSON:
 * `apps/api/tsconfig.json` pins `rootDir: ./src`, so pulling `../package.json`
 * into the compile graph would break `nest build`. A guarded runtime `require`
 * keeps package.json out of the TS graph. It is resolved relative to THIS
 * module's directory so it works identically whether we run from `src/` (tests)
 * or `dist/` (built) — both sit one level below the package root.
 *
 * The final fallback is `'0.0.0'` (never a throw): a health probe must answer
 * even if version discovery fails, and `0.0.0` is the unambiguous "unknown build"
 * sentinel that still satisfies the non-empty-string contract.
 */
export function resolveVersion(): string {
  const fromEnv = process.env.APP_VERSION ?? process.env.npm_package_version;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
    // package.json not resolvable in this layout — fall through to the sentinel.
  }

  return '0.0.0';
}
