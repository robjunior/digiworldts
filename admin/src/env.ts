/**
 * Runtime env exposed to the admin app.
 *
 * `import.meta.env.*` is populated by Vite from `.env.<mode>` at build/dev
 * time. Reading it once here gives every component a stable, type-narrow
 * view of what backend it's talking to and what environment label to badge.
 */

export type AdminEnvLabel = 'dev' | 'staging' | 'production';

type ParsedEnv = {
  readonly backendUrl: string;
  readonly label: AdminEnvLabel;
  readonly title: string;
  readonly isProduction: boolean;
  readonly isStaging: boolean;
  readonly isDev: boolean;
};

function parseLabel(raw: string | undefined): AdminEnvLabel {
  if (raw === 'production' || raw === 'staging' || raw === 'dev') return raw;
  return 'dev';
}

const raw = import.meta.env;
const label = parseLabel(raw.VITE_ENV_LABEL);
const backendUrl = raw.VITE_BACKEND_URL || 'http://localhost:3000';
const titleFromEnv = raw.VITE_ADMIN_TITLE?.trim();
const defaultTitle = `SOULXENON — Admin (${label})`;

export const adminEnv: ParsedEnv = {
  backendUrl,
  label,
  title: titleFromEnv && titleFromEnv.length > 0 ? titleFromEnv : defaultTitle,
  isProduction: label === 'production',
  isStaging: label === 'staging',
  isDev: label === 'dev',
};

if (typeof document !== 'undefined' && document.title !== adminEnv.title) {
  document.title = adminEnv.title;
}
