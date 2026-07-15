import { isAbsolute, resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

/**
 * Default SQLite datastore path, expressed relative to the app package root
 * (`apps/api`). Documented identically in `apps/api/.env.example` (TASK-4).
 */
const DEFAULT_DATABASE_URL = 'file:./prisma/dev.db';

/**
 * Apply — and pin to an absolute path — the datastore URL BEFORE the Nest
 * container is built.
 *
 * Two problems are solved here, both consequences of Prisma's SQLite path rules:
 *
 *  1. `PrismaService` reads `DATABASE_URL` the moment it is constructed (inside
 *     {@link NestFactory.create}), so any default must already be in `process.env`
 *     — hence a mutation, not a value passed to the client. This is the house
 *     `process.env.X ?? default` idiom (there is no @nestjs/config): a checkout
 *     with no `.env` still boots.
 *  2. Prisma resolves a RELATIVE `file:` URL differently depending on who reads
 *     it — the CLI (`prisma migrate`) anchors at the schema directory
 *     (`apps/api/prisma/`), but the CLIENT at runtime anchors at `process.cwd()`.
 *     Left relative, `pnpm dev` and a migration would point at DIFFERENT files
 *     (`apps/api/prisma/dev.db` vs `apps/api/prisma/prisma/dev.db`). To make the
 *     runtime deterministic regardless of CWD, we resolve any relative `file:`
 *     URL to an ABSOLUTE path anchored at the app package root. `__dirname` is
 *     `apps/api/src` under vitest and `apps/api/dist` when built — both are one
 *     level below `apps/api`, so `resolve(__dirname, '..', <path>)` yields
 *     `apps/api/prisma/dev.db` in either case. The `db:*` scripts pass the matching
 *     schema-relative URL so the CLI writes to that very same file.
 *
 * An already-absolute `file:` URL (what the hermetic tests inject) and any
 * non-file URL (a future `postgresql://`) are passed through untouched.
 */
function ensureDatabaseUrl(): void {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  process.env.DATABASE_URL = absolutizeFileUrl(url);
}

/** Anchor a relative `file:` SQLite URL at the app package root; else pass through. */
function absolutizeFileUrl(url: string): string {
  if (!url.startsWith('file:')) return url; // e.g. a future postgresql:// URL
  const path = url.slice('file:'.length);
  if (isAbsolute(path)) return url; // hermetic tests inject an absolute temp path
  const appRoot = resolve(__dirname, '..');
  return `file:${resolve(appRoot, path)}`;
}

/**
 * Build (but do not start) the Nest application.
 *
 * Split out from {@link bootstrap} so tests can construct the app and assert on
 * its wiring without binding a real TCP port. Configuration is read from the
 * environment here so a single code path governs both `main.ts` and tests.
 */
export async function createApp(): Promise<INestApplication> {
  ensureDatabaseUrl();

  const app = await NestFactory.create(AppModule, {
    // Quieter boot logs; feature slices can raise this via env later.
    logger: ['error', 'warn', 'log'],
  });

  // R-15: the SPA addresses the backend at `/api/*` (apiUrl('/x') = '/api/x', the
  // invariant-1 funnel in apps/web/src/api/client.ts) and the Vite dev proxy forwards
  // `/api/*` to Nest UNCHANGED. So the SERVER must own the `/api` prefix — without it
  // every browser→api call 404s (the whole browser→api boundary was dead). This makes
  // Nest map /api/health + /api/auth/* + /api/digimon + /api/farm. No `exclude`: the
  // SPA calls apiUrl('/health') = /api/health too, so health MUST live under the prefix.
  app.setGlobalPrefix('api');

  // Invariant 1 groundwork: the SPA reaches data ONLY through this API over
  // HTTP from its own origin. CORS is restricted to the web origin (overridable
  // via WEB_ORIGIN) rather than a wildcard, so the browser contract is explicit
  // from day one. Multiple origins may be given as a comma-separated list.
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const allowedOrigins = webOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Parse the Cookie header so handlers can read `req.cookies` (TASK-11, R-2b —
  // the httpOnly refresh cookie that `/auth/refresh` + `/auth/logout` consume).
  // WIRED HERE in the SHARED createApp() — NOT main.ts — on purpose (friction #2):
  // every e2e boots via createApp(), so putting cookie-parser only in main.ts would
  // leave `req.cookies` undefined under the gate and the refresh tests could not
  // read the cookie. Registered before the routes run so the parsed cookies are
  // available to every controller. `cookie-parser` is pure JS (no native build).
  app.use(cookieParser());

  // R-25 (TASK-192): stand up the Socket.IO realtime transport ALONGSIDE the HTTP
  // pipeline. `IoAdapter` is what makes any `@WebSocketGateway` (the PvpGateway, the
  // live challenge→accept handshake) actually bind to the SAME HTTP server this app
  // listens on — so `app.listen(0)` in the e2e harness (bootHttpTestApp) exposes the
  // socket server on the very same ephemeral port a `socket.io-client` connects to.
  // Installed ADDITIVELY (invariant 5): it layers a sibling transport on and does NOT
  // touch the HTTP prefix / CORS / ValidationPipe pipeline — every existing route
  // behaves byte-identically, and dropping this line + the gateway reverts cleanly to
  // offline-only PvP (two-way door). `@nestjs/platform-socket.io` is pure JS (no native
  // build, no `allowBuilds`), mirroring the `cookie-parser` dep precedent.
  app.useWebSocketAdapter(new IoAdapter(app));

  // First global request validation (TASK-4). Wired in the SHARED createApp so
  // tests and the live server enforce identical rules. No DTOs exist yet — TASK-5
  // adds the first ones (register/login) and this pipe validates them then.
  //  - whitelist: true      strips properties with no matching DTO decorator, so
  //                         clients can never smuggle unexpected fields into a
  //                         handler (defence in depth for the auth surface).
  //  - transform: true      coerces the plain request body into the DTO class and
  //                         converts primitive types, so handlers receive typed
  //                         instances rather than raw JSON.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  return app;
}

/** Resolve the listen port from env (default 3000). */
export function resolvePort(): number {
  const raw = process.env.PORT ?? process.env.API_PORT;
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}
