import type { AuthMeResponse, LoginBody, PublicUser, RegisterBody } from '@digiworld/shared/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { ApiError, authLogin, authLogout, authMe, authRegister } from '../lib/api';
import { seedLocaleFromServer } from '../lib/locale';
import { useWsStore } from '../state/wsStore';

type AuthStatus = 'loading' | 'authed' | 'anon';

type AuthContextValue = {
  readonly user: PublicUser | null;
  readonly status: AuthStatus;
  readonly registrationOpen: boolean;
  readonly login: (body: LoginBody) => Promise<PublicUser>;
  readonly register: (body: RegisterBody) => Promise<PublicUser>;
  readonly logout: () => Promise<void>;
};

const AUTH_ME_KEY = ['auth', 'me'] as const;
export { AUTH_ME_KEY };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const resetWs = useWsStore((state) => state.reset);
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
        registrationOpen: registrationOpenFromQuery(meQuery.data),
      });
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });

  const registerMutation = useMutation({
    mutationFn: authRegister,
    onSuccess: (session) => {
      queryClient.setQueryData<AuthMeResponse>(AUTH_ME_KEY, {
        user: session.user,
        registrationOpen: registrationOpenFromQuery(meQuery.data),
      });
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: authLogout,
    onSuccess: () => {
      resetWs();
      queryClient.setQueryData<AuthMeResponse | null>(AUTH_ME_KEY, null);
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });

  const user = meQuery.data?.user ?? null;
  const status = getStatus(meQuery.isPending, user, meQuery.error);
  useEffect(() => {
    if (user?.localePref) seedLocaleFromServer(user.localePref);
  }, [user?.localePref]);
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      registrationOpen: registrationOpenFromQuery(meQuery.data),
      login: async (body) => {
        const session = await loginMutation.mutateAsync(body);
        return session.user;
      },
      register: async (body) => {
        const session = await registerMutation.mutateAsync(body);
        return session.user;
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [loginMutation, logoutMutation, meQuery.data, registerMutation, status, user],
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
  if (user !== null) {
    return 'authed';
  }
  if (error instanceof ApiError && error.status === 401) {
    return 'anon';
  }
  if (isPending) {
    return 'loading';
  }
  return 'anon';
}

function registrationOpenFromQuery(data: AuthMeResponse | undefined): boolean {
  return data?.registrationOpen ?? true;
}
