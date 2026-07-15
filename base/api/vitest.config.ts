import { defineConfig } from 'vitest/config';

// NestJS relies on decorator metadata; vitest uses esbuild, which needs these
// legacy-decorator flags to emit the same `design:*` metadata `tsc` produces.
export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
  },
});
