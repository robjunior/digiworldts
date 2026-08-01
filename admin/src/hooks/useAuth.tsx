import type { AuthMeResponse, LoginBody, PublicUser } from '@digiworld/shared/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { ApiError, authLogin, authLogout, authMe } from '../lib/api';
import { seedLocaleFromServer } from '../lib/locale';

type AuthStatus = 'loading' | 'authed' | 'anon';

type AuthContextValue = {
  readonly user: PublicUser | null;
  readonly status: AuthStatus;
  readonly login: (body: LoginBody) => Promise<PublicUser>;
  readonly logout: () => Promise<void>;
};

const AUTH_ME_KEY = ['auth', 'me'] as const;
export { AUTH_ME_KEY };
const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Admin-app AuthProvider.
 *
 * Deliberately narrower than the player-app version:
 *   - no register (admin accounts are provisioned, never self-signed-up)
 *   - no WebSocket store to reset (admin does not open a game WS)
 *   - no registrationOpen tracking (irrelevant here)
 *
 * Everything else — the /auth/me query, login/logout mutations, 401 →
 * anon cache-clear, and the auto locale seed — matches the player app so
 * behaviour is uniform.
 */
export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: AUTH_ME_KEY,
    queryFn: authMe,
    retry: false,
    staleTime: 60_000,
    throwOnError: false,
  });

  const loginMutation = useMutation({
    mutationFn: authLogin,
    onSuccess: (session) => {
      queryClient.setQueryData<AuthMeResponse>(AUTH_ME_KEY, {
        user: session.user,
        registrationOpen: false,
      });
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: authLogout,
    onSuccess: () => {
      queryClient.setQueryData<AuthMeResponse | null>(AUTH_ME_KEY, null);
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });

  const user = meQuery.data?.user ?? null;
  const status = getStatus(meQuery.isPending, user, meQuery.error);

  useEffect(() => {
    if (user?.localePref) seedLocaleFromServer(user.localePref);
  }, [user?.localePref]);

  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401 && meQuery.data?.user !== undefined) {
      queryClient.setQueryData<AuthMeResponse | null>(AUTH_ME_KEY, null);
    }
  }, [meQuery.error, meQuery.data, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: async (body) => {
        const session = await loginMutation.mutateAsync(body);
        return session.user;
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [loginMutation, logoutMutation, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}

function getStatus(isPending: boolean, user: PublicUser | null, error: Error | null): AuthStatus {
  if (error instanceof ApiError && error.status === 401) return 'anon';
  if (user !== null) return 'authed';
  if (isPending) return 'loading';
  return 'anon';
}
