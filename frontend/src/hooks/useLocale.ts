import { useSyncExternalStore } from 'react';

import { getLocale, subscribeLocale, type Locale } from '../lib/locale';

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
