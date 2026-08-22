import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite dev server proxies /api and /ws to the Fastify backend selected via
 * VITE_BACKEND_URL (see .env.development). The set-cookie rewrite mirrors
 * admin/vite.config.ts so a production backend serving Secure + SameSite=None
 * cookies is still accepted by the plain-http dev browser at localhost:5173.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backendUrl = env.VITE_BACKEND_URL ?? 'http://127.0.0.1:3000';
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
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backendUrl, ...proxyCommon },
        '/ws': { target: wsBackend, ws: true, ...proxyCommon },
        '/assets/digimon': { target: backendUrl, ...proxyCommon },
        '/assets/sprites': { target: backendUrl, ...proxyCommon },
        '/assets/sprites-static': { target: backendUrl, ...proxyCommon },
        '/assets/arenas': { target: backendUrl, ...proxyCommon },
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
  };
});
