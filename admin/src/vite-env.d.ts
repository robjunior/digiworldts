/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  readonly VITE_ENV_LABEL: 'dev' | 'staging' | 'production' | string;
  readonly VITE_ADMIN_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __ADMIN_BUILD_ENV__: string;
