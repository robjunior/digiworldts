import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite dev server proxies /api and /ws to the Fastify backend on :3000.
 * In production, backend serves frontend/dist as static root (Phase 7).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
        changeOrigin: false,
      },
      '/assets/digimon': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
});
