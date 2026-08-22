/**
 * Server entrypoint.
 *
 * Startup order matters and is enforced here:
 *   1. Config + DB opened (both fail-fast on bad env or unwritable disk).
 *   2. Cluster (memory or Redis) connected. Live-match state and matchmaking
 *      queue live IN THE CLUSTER, not SQL — so a restart on Redis loses
 *      nothing, and a memory-cluster restart starts empty by design.
 *      `hydrateActiveMatches` and `hydrateMatchmaking` are status pings that
 *      report the cluster size at boot.
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
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { log } from './util/log.js';
import { flushAndShutdown } from './telemetry/emit.js';
import { closeDb, db } from './db/index.js';
import { loadCatalog } from './digimon/xml.js';
import { verifyCatalogAssets } from './scraper/verifier.js';
import { authPlugin } from './auth/routes.js';
import { oauthPlugin } from './auth/oauth/routes.js';
import { farmPlugin } from './farm/routes.js';
import { backfillStarterFactoriesForExistingUsers, seedFarmRecipes } from './farm/engine.js';
import { seedSkillsCatalogFromXml } from './skills/seed.js';
import { seedSkillsCatalogV2 } from './skills/seed-catalog.js';
import { rosterPlugin } from './roster/routes.js';
import { adminPlugin } from './admin/routes.js';
import { seedInitialBlueprints } from './admin/blueprints.js';
import { friendsPlugin, setFriendNotifier, setOnlineChecker } from './social/friends.js';
import { seedShopItems, shopPlugin } from './social/shop.js';
import { seedDefaultRarityTables } from './dungeons/rarity-tables.js';
import { dailyPlugin } from './social/daily.js';
import { trainingPlugin } from './training/routes.js';
import { lobbyPlugin, stopLobbyLoops, getLobbyConnectionSnapshot, deliverToUser } from './lobby/ws.js';
import { onboardingPlugin } from './onboarding/routes.js';
import { seedDefaultOnboarding } from './onboarding/engine.js';
import { tutorialPlugin } from './tutorial/routes.js';
import { gameSettingsPlugin } from './settings/routes.js';
import { scenesPlugin } from './scenes/routes.js';
import { particlePresetsPlugin } from './particle-presets/routes.js';
import { skillVfxPresetsPlugin } from './skill-vfx/routes.js';
import { seedDefaultGameSettings } from './settings/engine.js';
import { seedDefaultQuests, seedDefaultWorldObjects } from './quests/seed.js';
import { worldPlugin } from './world/routes.js';
import { questsPlugin } from './quests/routes.js';
import { dungeonsPlugin } from './dungeons/routes.js';
import { dialoguesPlugin } from './dialogues/routes.js';
import { tilesetsPlugin } from './tilesets/routes.js';
import { nurseryPlugin } from './nursery/routes.js';
import { marketPlugin } from './market/routes.js';
import { coinMarketPlugin } from './market/coins.js';
import { digdexPlugin } from './dex/routes.js';
import { adventurePlugin } from './adventure/routes.js';
import { chatPlugin } from './chat/routes.js';
import { pruneExpired, pruneOldLoginAttempts } from './auth/session.js';
import { hydrateActiveMatches } from './battle/routes.js';
import { battlePlugin } from './battle/http.js';
import { hydrateMatchmaking } from './matchmaking/queue.js';
import { normalizeRosterXpFloor } from './progression/normalize.js';
import { getCluster, closeCluster } from './cluster/index.js';
import { seasonsPlugin } from './seasons/routes.js';
import { startSeasonsTicker, stopSeasonsTicker } from './seasons/ticker.js';
import { playerPlugin } from './player/routes.js';
import { servicePlugin } from './service/routes.js';
import { linkPlugin } from './link/routes.js';
import { npcsPlugin } from './npcs/routes.js';
import { seedInitialNpcs } from './npcs/seed.js';

async function main(): Promise<void> {
  ensureDirs();
  // Eager sqlite open: runs mkdir + PRAGMAs + applySchema + column migrations.
  // Postgres has its own async adapter path (schema baked in via schema-pg.sql,
  // no ADD COLUMN migrations needed) that opens lazily on first q()/one()/run().
  if (config.DATABASE === 'sqlite') db();

  const cluster = await getCluster();
  log.info('boot.cluster', { kind: cluster.kind, nodeId: config.NODE_ID });

  const matchesHydrated = await hydrateActiveMatches();
  const queueHydrated = await hydrateMatchmaking();
  if (matchesHydrated + queueHydrated > 0) {
    log.info('boot.hydrate', { activeMatches: matchesHydrated, queueEntries: queueHydrated });
  }

  let catalog = { version: '1', updatedAt: 0, digimons: [] as Awaited<ReturnType<typeof loadCatalog>>['digimons'] };
  try {
    catalog = loadCatalog();
  } catch (err) {
    log.error('boot.catalog.load.fail', {
      hint: 'digimons.xml failed validation or exceeded size cap — starting with empty catalog. Fix the XML and restart.',
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (catalog.digimons.length > 0) {
    log.info('boot.catalog', { count: catalog.digimons.length });
    // Deliberately NOT awaited: on an empty asset volume this re-downloads two
    // files per catalog entry, and `SCRAPER_MIN_DELAY_MS` throttling alone puts
    // 434 entries past two minutes — longer than the container healthcheck
    // tolerates, so the API was killed before it ever listened. Nothing else
    // depends on the images; a missing portrait 404s until its download lands.
    void verifyCatalogAssets(catalog)
      .then((report) => log.info('boot.verify', report))
      .catch((err) => log.warn('boot.verify.fail', { err: err instanceof Error ? err.message : String(err) }));
    await normalizeRosterXpFloor();
  } else {
    log.warn('boot.catalog.empty', {
      hint: 'run `pnpm scrape --list` then `pnpm scrape --enrich` OR use the admin page after registering',
    });
  }

  await seedShopItems();
  await seedFarmRecipes();
  await seedDefaultRarityTables();
  await backfillStarterFactoriesForExistingUsers();
  await seedInitialBlueprints();
  await seedDefaultOnboarding();
  await seedDefaultGameSettings();
  await seedDefaultWorldObjects();
  await seedDefaultQuests();
  await seedInitialNpcs();
  await seedSkillsCatalogFromXml();
  if (config.SKILLS_V2_ENABLED) {
    const v2Result = await seedSkillsCatalogV2();
    log.info('skills.v2.boot.seed', {
      total: v2Result.total,
      inserted: v2Result.inserted,
      skipped: v2Result.skipped,
      validationErrors: v2Result.validationErrors.length,
    });
  }

  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    // Trust exactly 1 proxy hop (the frontend nginx in docker-compose). This
    // makes `req.ip` = the rightmost XFF value that nginx appended (the real
    // client), NOT the leftmost value the client may have injected. Set to a
    // higher integer if there are more real proxies in front; do not use
    // `true` which trusts every hop and re-opens the XFF-spoof throttle bypass.
    trustProxy: 1,
  });

  await app.register(fastifyCookie, { secret: config.SESSION_SECRET });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (req.url.startsWith('/api/auth/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
    }
  });

  const corsOrigins = config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (corsOrigins.length > 0) {
    // Refuse wildcard-with-credentials: `origin: true` reflects the request's
    // Origin header verbatim, and combined with `credentials: true` that's a
    // session-hijack primitive — an attacker page can call any authenticated
    // API cross-origin under the victim's cookie. The browser CORS spec
    // explicitly allows this combination (unlike `*` + credentials), so this
    // must be rejected at config load, not left to the operator to remember.
    if (corsOrigins.includes('*')) {
      throw new Error(
        'CORS_ORIGINS cannot include "*" — credentials-enabled reflect-any is a session-hijack primitive. List explicit origins instead.',
      );
    }
    await app.register(fastifyCors, {
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      // `Set-Cookie` is never readable from JS regardless of exposedHeaders —
      // removing this drops a misleading signal that suggested otherwise.
      maxAge: 86400,
    });
    log.info('boot.cors', { origins: corsOrigins });
  }
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 32 * 1024 },
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 },
    preservePath: true,
  });

  await app.register(fastifyStatic, {
    root: config.paths.assetsDir,
    prefix: '/assets/digimon/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: resolve(config.paths.assetsDir, '..', 'sprites'),
    prefix: '/assets/sprites/',
    decorateReply: false,
  });

  // Static (frame-0) sprite cells cut from the same generated sheets — used by
  // still/2D surfaces (roster, lobby, cards) so every digimon display reads
  // from the sheet rather than the legacy dot.gif. Missing cells 404 (below).
  await app.register(fastifyStatic, {
    root: resolve(config.paths.assetsDir, '..', 'sprites-static'),
    prefix: '/assets/sprites-static/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: config.paths.npcPortraitsDir,
    prefix: '/assets/npc/',
    decorateReply: false,
  });

  if (existsSync(config.paths.frontendDistDir)) {
    await app.register(fastifyStatic, {
      root: config.paths.frontendDistDir,
      prefix: '/',
      decorateReply: true,
      index: ['index.html'],
    });
  } else {
    log.warn('boot.frontend.dist.missing', {
      hint: 'run `pnpm --filter @digiworld/frontend build` to produce frontend/dist',
      path: config.paths.frontendDistDir,
    });
  }

  await app.register(authPlugin);
  await app.register(oauthPlugin);
  await app.register(rosterPlugin);
  await app.register(farmPlugin);
  await app.register(adminPlugin);
  await app.register(friendsPlugin);
  await app.register(shopPlugin);
  await app.register(dailyPlugin);
  await app.register(trainingPlugin);
  await app.register(onboardingPlugin);
  await app.register(tutorialPlugin);
  await app.register(gameSettingsPlugin);
  await app.register(scenesPlugin);
  await app.register(particlePresetsPlugin);
  await app.register(skillVfxPresetsPlugin);
  await app.register(questsPlugin);
  await app.register(dungeonsPlugin);
  await app.register(dialoguesPlugin);
  await app.register(tilesetsPlugin);
  await app.register(worldPlugin);
  await app.register(nurseryPlugin);
  await app.register(marketPlugin);
  await app.register(coinMarketPlugin);
  await app.register(digdexPlugin);
  await app.register(adventurePlugin);
  await app.register(chatPlugin);
  await app.register(battlePlugin);
  await app.register(seasonsPlugin);
  await app.register(playerPlugin);
  await app.register(linkPlugin);
  await app.register(npcsPlugin);
  await app.register(servicePlugin);
  await app.register(lobbyPlugin);

  app.get('/api/health', async (_req, reply) => reply.send({ ok: true, at: Date.now() }));

  setOnlineChecker(isUserOnlineFromLobby);
  setFriendNotifier((userId, payload) => deliverToUser(userId, payload));

  app.setNotFoundHandler((req, reply) => {
    const url = req.url;
    const isApi = url.startsWith('/api') || url.startsWith('/ws') || url.startsWith('/assets/digimon') || url.startsWith('/assets/sprites') || url.startsWith('/assets/sprites-static');
    if (req.method === 'GET' && !isApi && existsSync(config.paths.frontendDistDir)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not found' });
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    log.warn('http.error', {
      method: req.method,
      url: req.url,
      status: error.statusCode ?? 500,
      err: error.message,
      stack: error.stack,
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

  startSeasonsTicker();

  const shutdown = async (signal: string): Promise<void> => {
    log.info('server.shutdown.begin', { signal });
    stopSeasonsTicker();
    await stopLobbyLoops();
    clearInterval(pruneTimer);
    try {
      await flushAndShutdown();
    } catch (err) {
      log.warn('server.shutdown.telemetry.fail', { err: err instanceof Error ? err.message : String(err) });
    }
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
  for (const p of [config.paths.dataDir, config.paths.scrapeCacheDir, config.paths.assetsDir, config.paths.npcPortraitsDir]) {
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
