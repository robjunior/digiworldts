import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import './styles/tokens.css';
import './styles/components.css';
import './styles/extensions.css';
import './styles/app-shell.css';

import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { installBrowserLocaleWatcher } from './lib/locale';
import { setSkillVfxPresetResolver } from '@digiworld/scene3d';
import { getSkillVfxPresetSync } from './lib/api-skill-vfx-presets';

installBrowserLocaleWatcher();

// `@digiworld/scene3d` renders and must not reach for the network, so it takes
// the preset lookup by injection. Without this the scene still runs — every
// skill simply falls back to its per-element runner.
setSkillVfxPresetResolver(getSkillVfxPresetSync);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Auth + presence are server-authoritative; short freshness window.
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
