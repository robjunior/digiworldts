import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';

/**
 * Per-user tutorial "seen" tracker backed by localStorage.
 *
 * Storage is namespaced by userId so that if two accounts share the same
 * browser (dev/testing) or if a player logs out and back into a fresh
 * account, the second user still sees their own tutorials.
 *
 * A cross-tab `storage` event keeps every open tab in sync so dismissing
 * a tutorial in one tab doesn't leave it flashing in another.
 */
export const TUTORIAL_SEEN_EVENT = 'digiworld:tutorial-seen';

function storageKey(userId: string): string {
  return `digiworld.tutorial.seen.${userId}`;
}

function loadSeen(userId: string): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function persist(userId: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...ids]));
    window.dispatchEvent(new Event(TUTORIAL_SEEN_EVENT));
  } catch {
    // storage unavailable — session-only tracking
  }
}

export function useTutorialSeen(): {
  readonly userId: string | null;
  readonly has: (tutorialId: string) => boolean;
  readonly markSeen: (tutorialId: string) => void;
  readonly resetAll: () => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => (userId ? loadSeen(userId) : new Set()));

  useEffect(() => {
    if (userId === null) {
      setSeen(new Set());
      return;
    }
    setSeen(loadSeen(userId));
    const refresh = (): void => setSeen(loadSeen(userId));
    window.addEventListener('storage', refresh);
    window.addEventListener(TUTORIAL_SEEN_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(TUTORIAL_SEEN_EVENT, refresh);
    };
  }, [userId]);

  const has = useCallback((id: string): boolean => seen.has(id), [seen]);

  const markSeen = useCallback(
    (id: string): void => {
      if (userId === null || seen.has(id)) return;
      const next = new Set(seen);
      next.add(id);
      setSeen(next);
      persist(userId, next);
    },
    [seen, userId],
  );

  const resetAll = useCallback((): void => {
    if (userId === null) return;
    setSeen(new Set());
    persist(userId, new Set());
  }, [userId]);

  return { userId, has, markSeen, resetAll };
}
