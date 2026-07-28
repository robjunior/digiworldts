export type Locale = 'en' | 'pt';

const STORAGE_KEY = 'digiworld_locale';
const listeners = new Set<() => void>();

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('pt')) return 'pt';
  return 'en';
}

function readStorage(): Locale | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'en' || raw === 'pt' ? raw : null;
}

export function getLocale(): Locale {
  return readStorage() ?? detectBrowserLocale();
}

export function setLocale(locale: Locale): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale);
  }
  for (const l of listeners) l();
  if (typeof fetch !== 'undefined') {
    void fetch('/api/auth/locale-pref', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ locale }),
    }).catch(() => {});
  }
}

export function seedLocaleFromServer(locale: Locale | null): void {
  if (locale === null) return;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale);
  }
  for (const l of listeners) l();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function localizedName(skill: { readonly name: string; readonly name_pt?: string | null }, locale: Locale): string {
  if (locale === 'pt' && skill.name_pt) return skill.name_pt;
  return skill.name;
}

export function localizedDescription(
  skill: { readonly description?: string | null; readonly description_pt?: string | null },
  locale: Locale,
): string | null {
  if (locale === 'pt' && skill.description_pt) return skill.description_pt;
  return skill.description ?? null;
}
