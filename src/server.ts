/**
 * Server entrypoint.
 *
 * Startup order matters and is enforced here:
 *   1. Config + DB opened (both fail-fast on bad env or unwritable disk).
 *   2. Live-match state hydrated from `active_matches` and matchmaking queue
 *      hydrated from `matchmaking_queue` — restart no longer forfeits.
 *   3. XML catalog loaded, then asset verifier walks it (re-downloads any
 *      portrait/dot that is missing from public/assets/digimon/{id}/).
 *   4. Fastify + cookie + websocket + static plugins registered.
 *   5. All route plugins registered (auth, roster, farm, admin, friends,
 *      shop, daily) + WS lobby.
 *   6. Shop items seeded (idempotent).
 *   7. Listen. Graceful shutdown on SIGINT / SIGTERM.
 */
import Fastify, { type FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { log } from './util/log.js';
import { closeDb, db } from './db/index.js';
import { loadCatalog } from './digimon/xml.js';
import { verifyCatalogAssets } from './scraper/verifier.js';
import { authPlugin } from './auth/routes.js';
import { farmPlugin } from './farm/routes.js';
import { rosterPlugin } from './roster/routes.js';
import { adminPlugin } from './admin/routes.js';
import { seedInitialBlueprints } from './admin/blueprints.js';
import { friendsPlugin, setOnlineChecker } from './social/friends.js';
import { seedShopItems, shopPlugin } from './social/shop.js';
import { dailyPlugin } from './social/daily.js';
import { trainingPlugin } from './training/routes.js';
import { lobbyPlugin, stopLobbyLoops, getLobbyConnectionSnapshot } from './lobby/ws.js';
import { onboardingPlugin } from './onboarding/routes.js';
import { seedDefaultOnboarding } from './onboarding/engine.js';
import { worldPlugin } from './world/routes.js';
import { pruneExpired, pruneOldLoginAttempts } from './auth/session.js';
import { hydrateActiveMatches } from './battle/routes.js';
import { hydrateMatchmaking } from './matchmaking/queue.js';
import { getCluster, closeCluster } from './cluster/index.js';

async function main(): Promise<void> {
  ensureDirs();
  db();

  const cluster = await getCluster();
  log.info('boot.cluster', { kind: cluster.kind, nodeId: config.NODE_ID });

  const matchesHydrated = await hydrateActiveMatches();
  const queueHydrated = await hydrateMatchmaking();
  if (matchesHydrated + queueHydrated > 0) {
    log.info('boot.hydrate', { activeMatches: matchesHydrated, queueEntries: queueHydrated });
  }

  const catalog = loadCatalog();
  if (catalog.digimons.length > 0) {
    log.info('boot.catalog', { count: catalog.digimons.length });
    try {
      const report = await verifyCatalogAssets(catalog);
      log.info('boot.verify', report);
    } catch (err) {
      log.warn('boot.verify.fail', { err: err instanceof Error ? err.message : String(err) });
    }
  } else {
    log.warn('boot.catalog.empty', {
      hint: 'run `pnpm scrape --list` then `pnpm scrape --enrich` OR use the admin page after registering',
    });
  }

  await seedShopItems();
  await seedInitialBlueprints();
  await seedDefaultOnboarding();

  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(fastifyCookie, { secret: config.SESSION_SECRET });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 32 * 1024 },
  });
  await app.register(fastifyStatic, {
    root: config.paths.publicDir,
    prefix: '/',
    decorateReply: false,
    index: ['index.html'],
  });

  await app.register(authPlugin);
  await app.register(rosterPlugin);
  await app.register(farmPlugin);
  await app.register(adminPlugin);
  await app.register(friendsPlugin);
  await app.register(shopPlugin);
  await app.register(dailyPlugin);
  await app.register(trainingPlugin);
  await app.register(onboardingPlugin);
  await app.register(worldPlugin);
  await app.register(lobbyPlugin);

  app.get('/api/health', async (_req, reply) => reply.send({ ok: true, at: Date.now() }));

  setOnlineChecker(isUserOnlineFromLobby);

  app.setErrorHandler((error: FastifyError, req, reply) => {
    log.warn('http.error', {
      method: req.method,
      url: req.url,
      status: error.statusCode ?? 500,
      err: error.message,
    });
    if (reply.sent) return;
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: status >= 500 ? 'internal error' : error.message });
  });

  const pruneTimer = setInterval(() => {
    void (async () => {
      try {
        const s = await pruneExpired();
        const l = await pruneOldLoginAttempts();
        if (s + l > 0) log.debug('housekeeping.prune', { sessions: s, loginAttempts: l });
      } catch (err) {
        log.warn('housekeeping.prune.fail', { err: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, 5 * 60 * 1000);
  pruneTimer.unref?.();

  await app.listen({ host: config.HOST, port: config.PORT });
  log.info('server.listening', { host: config.HOST, port: config.PORT, env: config.NODE_ENV });

  const shutdown = async (signal: string): Promise<void> => {
    log.info('server.shutdown.begin', { signal });
    await stopLobbyLoops();
    clearInterval(pruneTimer);
    try {
      await app.close();
    } catch (err) {
      log.warn('server.shutdown.close.fail', { err: err instanceof Error ? err.message : String(err) });
    }
    try {
      await closeCluster();
    } catch (err) {
      log.warn('server.shutdown.cluster.fail', { err: err instanceof Error ? err.message : String(err) });
    }
    try {
      closeDb();
    } catch (err) {
      log.warn('server.shutdown.db.fail', { err: err instanceof Error ? err.message : String(err) });
    }
    log.info('server.shutdown.done');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function ensureDirs(): void {
  for (const p of [config.paths.dataDir, config.paths.scrapeCacheDir, config.paths.assetsDir]) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function isUserOnlineFromLobby(userId: string): boolean {
  return getLobbyConnectionSnapshot().has(userId);
}

main().catch((err: unknown) => {
  log.error('server.boot.fail', { err: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
