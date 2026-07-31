/**
 * Env-driven configuration, validated with Zod at boot.
 * Missing/invalid vars fail-fast with a readable error instead of surfacing
 * as a `undefined` deep inside a handler later.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

loadDotenv({ quiet: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

/**
 * Persist a generated session secret so restarts don't invalidate every
 * live session. Only used if SESSION_SECRET env is absent (dev convenience).
 */
function ensureSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET;
  if (envSecret && envSecret.length >= 32) return envSecret;
  const secretFile = resolve(projectRoot, 'data', '.session-secret');
  if (existsSync(secretFile)) {
    const s = readFileSync(secretFile, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  mkdirSync(dirname(secretFile), { recursive: true });
  const generated = randomBytes(48).toString('hex');
  writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NODE_ID: z.string().min(1).default(() => `node-${randomBytes(4).toString('hex')}`),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_URL: z.string().optional(),
  DB_PATH: z.string().default('data/digiworld.db'),
  CLUSTER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().optional(),
  DATA_DIR: z.string().default('data'),
  PUBLIC_DIR: z.string().default('public'),
  FRONTEND_DIST_DIR: z.string().default('../frontend/dist'),
  ARENAS_DIR: z.string().default('../frontend/public/assets/arenas'),
  CATALOG_XML: z.string().default('data/catalog/digimons.xml'),
  SCRAPE_CACHE_DIR: z.string().default('data/cache'),
  ASSETS_DIR: z.string().default('public/assets/digimon'),
  DIALOGUES_DIR: z.string().default('data/dialogues'),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  ADMIN_BOOTSTRAP: z.enum(['open', 'closed']).default('open'),
  SCRAPER_USER_AGENT: z.string().default('DigiWorld/0.1 (self-hosted; contact via game admin)'),
  SCRAPER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(150),
  MAX_LOBBY_CONNECTIONS: z.coerce.number().int().positive().default(1200),
  MAX_CONCURRENT_MATCHES: z.coerce.number().int().positive().default(200),
  CORS_ORIGINS: z.string().default(''),
  SKILLS_V2_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  SERVICE_TOKEN_DISCORD: z.string().min(32).optional(),
}).refine((c) => c.CLUSTER !== 'redis' || (c.REDIS_URL && c.REDIS_URL.length > 0), {
  message: 'REDIS_URL is required when CLUSTER=redis',
  path: ['REDIS_URL'],
}).refine((c) => c.DATABASE !== 'postgres' || (c.DATABASE_URL && c.DATABASE_URL.length > 0), {
  message: 'DATABASE_URL is required when DATABASE=postgres',
  path: ['DATABASE_URL'],
});

const parsed = ConfigSchema.safeParse({
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET ?? ensureSessionSecret(),
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  paths: {
    root: projectRoot,
    db: resolve(projectRoot, parsed.data.DB_PATH),
    dataDir: resolve(projectRoot, parsed.data.DATA_DIR),
    publicDir: resolve(projectRoot, parsed.data.PUBLIC_DIR),
    frontendDistDir: resolve(projectRoot, parsed.data.FRONTEND_DIST_DIR),
    arenasDir: resolve(projectRoot, parsed.data.ARENAS_DIR),
    catalogXml: resolve(projectRoot, parsed.data.CATALOG_XML),
    scrapeCacheDir: resolve(projectRoot, parsed.data.SCRAPE_CACHE_DIR),
    assetsDir: resolve(projectRoot, parsed.data.ASSETS_DIR),
    dialogues: resolve(projectRoot, parsed.data.DIALOGUES_DIR),
  },
} as const;

export type AppConfig = typeof config;
