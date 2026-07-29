import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { getTutorialSeen, markTutorialSeen, resetTutorialSeen, type TutorialSeenResponse } from '../../lib/api-tutorial';

/**
 * Per-user tutorial "seen" tracker backed by the server via `/api/tutorial/seen`.
 *
 * Previously localStorage-only (`digiworld.tutorial.seen.{userId}`), which
 * cleared with cache/private mode and didn't cross devices — so the intro/
 * per-page tutorials re-fired every session on a fresh browser. Now the
 * source of truth is `users.tutorial_seen` (migration 022) with React Query
 * providing a session-scoped cache; markSeen updates optimistically so the
 * current tutorial closes without waiting on the server round-trip.
 *
 * Query key is scoped by userId so that when two accounts share the same
 * browser (dev/testing) or a player logs out and back into a fresh account,
 * the cache doesn't leak the previous user's seen set.
 */
const EMPTY_RESPONSE: TutorialSeenResponse = { seenIds: [] };

function tutorialQueryKey(userId: string | null): readonly [string, string, string | null] {
  return ['tutorial', 'seen', userId] as const;
}

export function useTutorialSeen(): {
  readonly userId: string | null;
  readonly has: (tutorialId: string) => boolean;
  readonly markSeen: (tutorialId: string) => void;
  readonly resetAll: () => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => tutorialQueryKey(userId), [userId]);

  const query = useQuery({
    queryKey,
    queryFn: getTutorialSeen,
    enabled: userId !== null,
    staleTime: Infinity,
  });

  const seenSet = useMemo(
    () => new Set(query.data?.seenIds ?? []),
    [query.data?.seenIds],
  );

  const { mutate: mutateMark } = useMutation({
    mutationFn: (tutorialId: string) => markTutorialSeen(tutorialId),
    onMutate: async (tutorialId) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<TutorialSeenResponse>(queryKey) ?? EMPTY_RESPONSE;
      const nextIds = [...new Set([...prev.seenIds, tutorialId])];
      queryClient.setQueryData<TutorialSeenResponse>(queryKey, { seenIds: nextIds });
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData<TutorialSeenResponse>(queryKey, ctx.prev);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<TutorialSeenResponse>(queryKey, data);
    },
  });

  const { mutate: mutateReset } = useMutation({
    mutationFn: () => resetTutorialSeen(),
    onSuccess: (data) => {
      queryClient.setQueryData<TutorialSeenResponse>(queryKey, data);
    },
  });

  const has = useCallback((id: string): boolean => seenSet.has(id), [seenSet]);

  const markSeen = useCallback(
    (id: string): void => {
      if (userId === null || seenSet.has(id)) return;
      mutateMark(id);
    },
    [seenSet, userId, mutateMark],
  );

  const resetAll = useCallback((): void => {
    if (userId === null) return;
    mutateReset();
  }, [userId, mutateReset]);

  return { userId, has, markSeen, resetAll };
}
