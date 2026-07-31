export function setTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3199';
  process.env.PUBLIC_URL = 'http://localhost:3199';
  process.env.GAME_PUBLIC_URL = 'http://game.test';
  process.env.BACKEND_URL = 'http://backend.test';
  process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
  process.env.SERVICE_TOKEN_DISCORD = 'x'.repeat(32);
  process.env.DISCORD_CLIENT_ID = 'client_test';
  process.env.DISCORD_CLIENT_SECRET = 'secret_test';
}
