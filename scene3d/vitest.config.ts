import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    globals: false,
    // Run each test file in its own process. `render-loop-clock.test.ts` uses
    // `vi.mock("three")` to stub WebGLRenderer; without isolation that mock
    // leaks into other files in the same worker pool (e.g. any test importing
    // the real `three`), flipping unrelated tests. Forks keep mocks per-file.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
