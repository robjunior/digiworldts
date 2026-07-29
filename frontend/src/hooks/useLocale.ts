import { useSyncExternalStore } from 'react';

import { getLocale, subscribeLocale, t as translate, type Locale } from '../lib/locale';

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * Returns a `t(key, params?)` function bound to the current locale, and
 * re-renders the component whenever the locale changes. Prefer this over
 * calling the raw `t` from `lib/locale.ts` inside React components.
 */
export function useT(): (key: string, params?: Readonly<Record<string, string | number>>) => string {
  // Subscribe to locale changes so the returned function re-runs on switch.
  useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return translate;
}
