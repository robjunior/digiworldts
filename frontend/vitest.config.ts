import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["src/test/setup-happy-dom-canvas.ts"],
    // Only collect vitest-format tests. The repo also has tsx-driven regression
    // scripts (e.g. sheet-frames.test.ts, run via `npx tsx`) that throw at module
    // top-level and are not vitest suites.
    include: ["src/**/*.vitest.test.ts"],
    globals: false,
  },
});
