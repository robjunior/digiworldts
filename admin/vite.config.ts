import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

/**
 * Standalone admin Vite server.
 *
 * `VITE_BACKEND_URL` selects the target environment at DEV time:
 *   - `pnpm --filter @digiworld/admin dev`             → .env.dev            (local backend)
 *   - `pnpm --filter @digiworld/admin dev:staging`     → .env.staging        (remote staging)
 *   - `pnpm --filter @digiworld/admin dev:production`  → .env.production     (remote prod — read-heavy!)
 *
 * The proxy is what makes cross-origin cookies transparent: from the
 * BROWSER's perspective every request is same-origin (`http://localhost:5174`),
 * so the session cookie set by the remote backend is stored + resent without
 * SameSite/Secure gymnastics. The `set-cookie` rewrite below strips
 * `Domain=` and `Secure` and coerces `SameSite=None` → `SameSite=Lax` so a
 * cookie minted for `staging.example.com; Secure` is still accepted by the
 * dev browser on plain HTTP.
 *
 * In production the admin is served by nginx (see admin/Dockerfile + the
 * `admin` compose service). The browser hits the backend directly at
 * `/api/*` on the same host — no proxy in play there.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backendUrl = env.VITE_BACKEND_URL ?? 'http://localhost:3000';
  const wsBackend = backendUrl.replace(/^http/, 'ws');
  const proxyCommon: Partial<ProxyOptions> = {
    changeOrigin: true,
    secure: false,
    cookieDomainRewrite: '',
    cookiePathRewrite: '/',
    configure: (proxy) => {
      proxy.on('proxyRes', (proxyRes) => {
        const setCookie = proxyRes.headers['set-cookie'];
        if (!setCookie) return;
        proxyRes.headers['set-cookie'] = setCookie.map((cookie) =>
          cookie
            .replace(/;\s*Domain=[^;]+/i, '')
            .replace(/;\s*Secure/i, '')
            .replace(/SameSite=None/i, 'SameSite=Lax'),
        );
      });
    },
  };

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': { target: backendUrl, ...proxyCommon },
        '/ws': { target: wsBackend, ws: true, ...proxyCommon },
        '/assets/digimon': { target: backendUrl, ...proxyCommon },
        '/assets/sprites': { target: backendUrl, ...proxyCommon },
        '/assets/sprites-static': { target: backendUrl, ...proxyCommon },
        '/assets/arenas': { target: backendUrl, ...proxyCommon },
        '/assets/scenes': { target: backendUrl, ...proxyCommon },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: [
          fileURLToPath(new URL('./index.html', import.meta.url)),
          fileURLToPath(new URL('./threejs-editor/index.html', import.meta.url)),
        ],
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
    define: {
      __ADMIN_BUILD_ENV__: JSON.stringify(mode),
    },
  };
});
