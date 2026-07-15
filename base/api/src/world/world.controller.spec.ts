import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import type { WorldChunkView } from './world.types';

/**
 * World API contract (TASK-46, R-17a) — the runnable proof of the chunk endpoint: an
 * authenticated player streams a 32×32 chunk of the deterministic square-tile world, and
 * every guard/validation edge holds.
 *
 * Harness = the SHARED house harness (P-2 + P-6, `nest-e2e-and-datastore-tests` skill's
 * primary path): {@link bootHttpTestApp} boots the FULL AppModule via `createApp()`
 * (global `/api` prefix + `ValidationPipe` + the reused `JwtAuthGuard`) on an ephemeral
 * port inside a per-run throwaway SQLite DB, hit with Node's built-in `fetch`. The world
 * itself is stateless/pure, but a JWT is still needed (register+login one player), and
 * booting the full app is what proves the world guard constructs across the module
 * boundary — so the standard DB-backed boot is the right harness even though no world row
 * is ever written.
 */
describe('World API (end-to-end)', () => {
  let ds: TempDatastore;
  let baseUrl: string;

  beforeAll(async () => {
    ds = await bootHttpTestApp('world');
    baseUrl = ds.baseUrl;
  });

  afterAll(async () => {
    await ds.dispose();
  });

  const jsonPost = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const authGet = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /** Register + log in a fresh account and return its access token. */
  const registerLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    expect(((await register.json()) as RegisterResponse).email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  it('GET /world/chunk?cx=0&cy=0 → 200 with a 32×32 WorldChunkView', async () => {
    const token = await registerLogin('world-origin@example.com');
    const res = await authGet('/world/chunk?cx=0&cy=0', token);
    expect(res.status).toBe(200);
    const chunk = (await res.json()) as WorldChunkView;
    expect(chunk.cx).toBe(0);
    expect(chunk.cy).toBe(0);
    expect(chunk.size).toBe(32);
    expect(chunk.tiles).toHaveLength(1024);
    for (const tile of chunk.tiles) {
      expect(typeof tile.biome).toBe('string');
      expect(typeof tile.walkable).toBe('boolean');
    }
  });

  it('is deterministic — the same chunk twice returns byte-identical tiles', async () => {
    const token = await registerLogin('world-determinism@example.com');
    const a = (await (await authGet('/world/chunk?cx=5&cy=-3', token)).json()) as WorldChunkView;
    const b = (await (await authGet('/world/chunk?cx=5&cy=-3', token)).json()) as WorldChunkView;
    expect(a).toEqual(b);
  });

  it('a non-integer cx → 400 (validated before generating)', async () => {
    const token = await registerLogin('world-badcoord@example.com');
    const res = await authGet('/world/chunk?cx=x&cy=0', token);
    expect(res.status).toBe(400);
  });

  it('no Authorization header → 401', async () => {
    const res = await authGet('/world/chunk?cx=0&cy=0');
    expect(res.status).toBe(401);
  });
});
