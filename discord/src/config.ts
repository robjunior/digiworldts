import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive(),
  PUBLIC_URL: z.string().url(),
  GAME_PUBLIC_URL: z.string().url(),
  BACKEND_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SERVICE_TOKEN_DISCORD: z.string().min(32),
  DISCORD_TOKEN: optionalSecret,
  DISCORD_CLIENT_ID: optionalSecret,
  DISCORD_CLIENT_SECRET: optionalSecret,
  DISCORD_GUILD_ID: optionalSecret,
  DISCORD_ADMIN_ROLE_IDS: z.string().default(''),
  MP_ACCESS_TOKEN: optionalSecret,
  MP_WEBHOOK_SECRET: optionalSecret,
  MP_PAYER_EMAIL: optionalSecret,
  MP_PAYER_NAME: optionalSecret,
  MP_PAYER_LAST_NAME: optionalSecret,
  MP_PAYER_ID_TYPE: optionalSecret,
  MP_PAYER_ID_NUMBER: optionalSecret,
  PIX_EXPIRATION_MINUTES: z.coerce.number().int().positive().default(30),
  PURCHASE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  TICKET_INACTIVITY_HOURS: z.coerce.number().int().positive().default(48),
  RATE_LIMIT_COMMANDS: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_BUY: z.coerce.number().int().positive().default(3),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  process.stderr.write(`Invalid Discord service environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
