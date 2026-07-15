import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { ENEMY_ROSTER } from '../digimon/battle';
import { DigimonService } from '../digimon/digimon.service';
import { PrismaService } from '../prisma/prisma.service';
import { difficultyForBiome, enemyScaleForBiome, wildEnemyScale } from './encounter';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import {
  MIN_SPAWN_DISTANCE,
  biomeAt,
  cityAt,
  distanceToNearestCity,
  tileAt,
  volcanoAt,
} from './world.map';
import type { EncounterView, WorldStateView } from './world.types';

/**
 * World spawn + encounter contract (TASK-48, R-17b) — the runnable proof of the two new
 * routes: a signed-in player is placed at a persisted Starter-City spawn (a walkable,
 * non-city tile ≥ MIN_SPAWN_DISTANCE from the nearest city), a re-read returns the SAME
 * spawn (persisted, idempotent), and a step-encounter roll returns null or a roster foe.
 *
 * Harness = the shared house harness (P-2 + P-6): {@link bootHttpTestApp} boots the FULL
 * AppModule via `createApp()` (global `/api` prefix + `ValidationPipe` + the reused
 * `JwtAuthGuard`) on an ephemeral port inside a per-run throwaway SQLite DB. `createApp()`
 * (not `Test.createTestingModule`) is required so the global ValidationPipe is active —
 * the ONLY boot that makes the malformed-body 400 assertion real.
 *
 * The encounter test picks a KNOWN-forest coordinate from the pure `biomeAt` field so the
 * assertion is against a deterministic biome (the wire's `biome` must echo "forest").
 */
describe('World spawn + encounter API (end-to-end, R-17b)', () => {
  let ds: TempDatastore;
  let baseUrl: string;

  beforeAll(async () => {
    ds = await bootHttpTestApp('world-state');
    baseUrl = ds.baseUrl;
  });

  afterAll(async () => {
    await ds.dispose();
  });

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const authGet = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const registerLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    expect(((await register.json()) as RegisterResponse).email).toBe(email);
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return accessToken;
  };

  /** Find a deterministic forest tile near the origin (the pure field mixes all biomes). */
  const findForestTile = (): { x: number; y: number } => {
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        if (biomeAt(x, y) === 'forest') return { x, y };
      }
    }
    throw new Error('no forest tile found in scan region');
  };

  it('GET /world/state → 200 with a valid, persisted, idempotent spawn', async () => {
    const token = await registerLogin('world-state@example.com');
    const res = await authGet('/world/state', token);
    expect(res.status).toBe(200);
    const state = (await res.json()) as WorldStateView;

    // The spawn is a walkable, non-city tile ≥ MIN_SPAWN_DISTANCE from the returned city.
    expect(tileAt(state.spawn.x, state.spawn.y).walkable).toBe(true);
    expect(cityAt(state.spawn.x, state.spawn.y)).toBeNull();
    expect(state.minSpawnDistance).toBe(MIN_SPAWN_DISTANCE);
    const dx = state.spawn.x - state.city.x;
    const dy = state.spawn.y - state.city.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
    // The returned city IS a real anchor.
    expect(cityAt(state.city.x, state.city.y)).not.toBeNull();
    expect(typeof state.city.name).toBe('string');

    // A SECOND call returns the SAME spawn (persisted on first read, idempotent).
    const again = (await (await authGet('/world/state', token)).json()) as WorldStateView;
    expect(again.spawn).toEqual(state.spawn);
  });

  it('GET /world/state → landmarks[] carries city + volcano, city byte-unchanged (R-20)', async () => {
    const token = await registerLogin('world-landmarks@example.com');
    const state = (await (await authGet('/world/state', token)).json()) as WorldStateView;

    // The additive landmark collection: a city entry + a volcano entry.
    const cityMark = state.landmarks.find((m) => m.kind === 'city');
    const volcanoMark = state.landmarks.find((m) => m.kind === 'volcano');
    expect(cityMark).toBeDefined();
    expect(volcanoMark).toBeDefined();

    // The `city` landmark is coordinate-equal to the legacy `city` field (byte-stable —
    // invariant 5: R-18's client still reads `city` until TASK-125 switches to the list).
    expect(cityMark).toEqual({
      kind: 'city',
      x: state.city.x,
      y: state.city.y,
      name: state.city.name,
    });

    // The volcano is a real anchor, a distinct tile from the city, walkable public terrain.
    expect(volcanoAt(volcanoMark!.x, volcanoMark!.y)).not.toBeNull();
    expect(cityAt(volcanoMark!.x, volcanoMark!.y)).toBeNull();
    expect(tileAt(volcanoMark!.x, volcanoMark!.y).walkable).toBe(true);
    expect(volcanoMark!.x === state.city.x && volcanoMark!.y === state.city.y).toBe(false);

    // spawn / minSpawnDistance unchanged.
    expect(state.minSpawnDistance).toBe(MIN_SPAWN_DISTANCE);
    expect(tileAt(state.spawn.x, state.spawn.y).walkable).toBe(true);
  });

  it('POST /world/encounter {x,y} on forest → 200 with a null or roster encounter', async () => {
    const token = await registerLogin('world-encounter@example.com');
    const forest = findForestTile();
    const rosterIds = new Set(ENEMY_ROSTER.map((e) => e.id));
    // Roll several times: the response is stochastic, but every non-null encounter must
    // route into the shipped battle roster and the biome must always echo "forest".
    for (let i = 0; i < 8; i += 1) {
      const res = await jsonPost('/world/encounter', forest, token);
      expect(res.status).toBe(200);
      const view = (await res.json()) as EncounterView;
      expect(view.biome).toBe('forest');
      if (view.encounter !== null) {
        expect(typeof view.encounter.name).toBe('string');
        expect(rosterIds.has(view.encounter.enemyId)).toBe(true);
        // TASK-167 (R-22 slice 28): a non-empty encounter carries a biome-derived
        // difficulty; empty rolls carry none.
        expect(view.difficulty).toBe(difficultyForBiome('forest'));
        // TASK-168 (R-22 slice 29) + TASK-169 (R-22 slice 30): a non-empty encounter ALSO
        // carries a wild-enemy STRENGTH SCALE that COMPOUNDS the biome baseline with the tile's
        // distance from the nearest safe city; empty rolls carry none.
        expect(view.enemyScale).toBe(
          wildEnemyScale('forest', distanceToNearestCity(forest.x, forest.y)),
        );
      } else {
        expect(view.difficulty).toBeUndefined();
        expect(view.enemyScale).toBeUndefined();
      }
    }
  });

  // TASK-169 (R-22 slice 30): the world's GEOGRAPHY compounds the biome danger — a deep-
  // wilderness encounter opens with a strictly higher enemyScale than a near-city encounter of
  // the SAME biome (a near-city tile is the identity floor = the slice-29 biome baseline).
  it('POST /world/encounter → a FAR tile carries a strictly higher enemyScale than a NEAR tile of the same biome', async () => {
    const token = await registerLogin('world-distance@example.com');

    // Find two forest tiles of the SAME biome: one near a city (distance < 15, identity floor)
    // and one deep in the wilderness (distance >= 30, beyond MIN_SPAWN_DISTANCE).
    const findForestAt = (predicate: (d: number) => boolean): { x: number; y: number } => {
      for (let y = 0; y < 400; y += 1) {
        for (let x = 0; x < 400; x += 1) {
          if (biomeAt(x, y) === 'forest' && predicate(distanceToNearestCity(x, y))) {
            return { x, y };
          }
        }
      }
      throw new Error('no matching forest tile found in scan region');
    };
    const near = findForestAt((d) => d < 15);
    const far = findForestAt((d) => d >= 30);

    // The near-city tile is the identity floor: exactly the slice-29 biome baseline.
    expect(wildEnemyScale('forest', distanceToNearestCity(near.x, near.y))).toBe(
      enemyScaleForBiome('forest'),
    );
    // The far tile is strictly tougher than the near tile of the same biome.
    const nearScale = wildEnemyScale('forest', distanceToNearestCity(near.x, near.y));
    const farScale = wildEnemyScale('forest', distanceToNearestCity(far.x, far.y));
    expect(farScale).toBeGreaterThan(nearScale);

    // And the running route echoes each scale on a non-empty roll (drive several rolls so at
    // least one surfaces a foe; every non-null far roll must be the strictly-higher scale).
    for (let i = 0; i < 12; i += 1) {
      const view = (await (await jsonPost('/world/encounter', far, token)).json()) as EncounterView;
      if (view.encounter !== null) {
        expect(view.enemyScale).toBe(farScale);
        expect(view.enemyScale!).toBeGreaterThan(nearScale);
      }
    }
  });

  // TASK-170 (R-22 slice 31): the wild foe ALSO scales with the PLAYER'S OWN team level, so a
  // levelled account meets a strictly tougher foe on the SAME tile than a beginner. Proven over
  // HTTP through the JWT-guarded route (the handler resolves the caller's team level, owner-scoped).
  it('POST /world/encounter → a LEVELLED player carries a strictly higher enemyScale than a beginner on the SAME tile', async () => {
    const beginnerToken = await registerLogin('world-level-beginner@example.com');
    const veteranToken = await registerLogin('world-level-veteran@example.com');

    const forest = findForestTile();
    // The beginner's team is the granted level-1 starters → the identity floor (arity-2 baseline).
    const baselineScale = wildEnemyScale('forest', distanceToNearestCity(forest.x, forest.y));

    // Level the veteran's roster: trigger the starter grant (GET /world/state also grants nothing,
    // so read the roster via GET /digimon), then bump one Digimon's level well above the beginner.
    const prisma = ds.app.get(PrismaService);
    const veteran = await prisma.user.findFirst({
      where: { email: 'world-level-veteran@example.com' },
      select: { id: true },
    });
    expect(veteran).not.toBeNull();
    // Force the starter grant for the veteran so the roster exists to level up.
    await ds.app.get(DigimonService).getRosterForUser(veteran!.id);
    await prisma.digimon.updateMany({
      where: { userId: veteran!.id, deletedAt: null },
      data: { level: 20 },
    });
    const veteranScale = wildEnemyScale('forest', distanceToNearestCity(forest.x, forest.y), 20);
    expect(veteranScale).toBeGreaterThan(baselineScale);

    // Drive several rolls per player; every non-null roll must echo that player's own scale,
    // and the veteran's is strictly greater than the beginner's on the identical tile.
    const rollScale = async (token: string): Promise<number | undefined> => {
      for (let i = 0; i < 20; i += 1) {
        const view = (await (
          await jsonPost('/world/encounter', forest, token)
        ).json()) as EncounterView;
        if (view.encounter !== null) return view.enemyScale;
      }
      return undefined;
    };

    const beginnerRolled = await rollScale(beginnerToken);
    const veteranRolled = await rollScale(veteranToken);
    // At least one side should surface a foe across 20 forest rolls (chance 0.2 each).
    if (beginnerRolled !== undefined) {
      expect(beginnerRolled).toBe(baselineScale);
    }
    if (veteranRolled !== undefined) {
      expect(veteranRolled).toBe(veteranScale);
      expect(veteranRolled).toBeGreaterThan(baselineScale);
    }
  });

  it('POST /world/encounter with a malformed body → 400', async () => {
    const token = await registerLogin('world-badbody@example.com');
    const res = await jsonPost('/world/encounter', { x: 'nope' }, token);
    expect(res.status).toBe(400);
  });

  it('no Authorization header → 401 on both routes', async () => {
    expect((await authGet('/world/state')).status).toBe(401);
    expect((await jsonPost('/world/encounter', { x: 0, y: 0 })).status).toBe(401);
  });
});
