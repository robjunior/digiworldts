import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import './styles/tokens.css';
import './styles/components.css';
import './styles/extensions.css';
import './styles/extensions-admin.css';
import './styles/extensions-combat3d.css';
import './styles/admin-shell.css';

import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { installBrowserLocaleWatcher } from './lib/locale';
import { adminEnv } from './env';

installBrowserLocaleWatcher();

// Loud console banner so nobody accidentally forgets they're pointed at prod.
if (adminEnv.isProduction) {
  // eslint-disable-next-line no-console
  console.warn(
    `%c⚠ ADMIN CONNECTED TO PRODUCTION`,
    'background:#7a0000;color:#fff;font-size:14px;font-weight:700;padding:6px 12px;border-radius:4px',
    `\nBackend: ${adminEnv.backendUrl}\nEvery write hits real players.`,
  );
} else if (adminEnv.isStaging) {
  // eslint-disable-next-line no-console
  console.info(
    `%c● ADMIN → STAGING`,
    'background:#785900;color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:4px',
    `\nBackend: ${adminEnv.backendUrl}`,
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: { retry: 0 },
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
