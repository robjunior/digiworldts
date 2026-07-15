import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { OwnedDigimon } from './digimon.types';

/**
 * TASK-189 (R-26 slice 48) — DURATION-BASED training e2e. Exercises the split
 * `POST /digimon/:id/train/start` + `.../train/collect` seam over the real HTTP app +
 * throwaway DB (shared `bootHttpTestApp` harness — nest-e2e-and-datastore-tests):
 *  - `start` stamps `trainingStartedAt` (owner-scoped, 404 on a foreign id);
 *  - `collect` with a CONTROLLED seeded elapsed (we write `trainingStartedAt` to a fixed
 *    PAST `Date` directly via Prisma — NO real wall-clock wait, so the test is
 *    deterministic and non-flaky) applies the elapsed-scaled gain, CLEARS the timestamp,
 *    and a LONGER seeded elapsed yields a STRICTLY GREATER gain than a shorter one.
 * Server-authoritative elapsed (invariant 1): the client never supplies a duration.
 */
describe('Duration-based training API (end-to-end)', () => {
  let ctx: TempDatastore;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;

  const jsonPost = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    expect(((await register.json()) as RegisterResponse).email).toBe(email);
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return accessToken;
  };

  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  const post = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    ctx = await bootHttpTestApp('timed-train');
    app = ctx.app;
    baseUrl = ctx.baseUrl;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('start stamps trainingStartedAt (owner-scoped); collect applies an elapsed-scaled gain and clears it', async () => {
    const token = await registerAndLogin('alice-timed@example.test');
    const [starter] = await getRoster(token);
    expect(starter.trainingStartedAt == null).toBe(true);

    // START → the timestamp is now set on the wire.
    const startRes = await post(`/digimon/${starter.id}/train/start`, token);
    expect(startRes.status).toBe(200);
    const started = (await startRes.json()) as OwnedDigimon;
    expect(started.trainingStartedAt).toBeTruthy();

    // Seed a CONTROLLED elapsed: rewrite trainingStartedAt to 2 hours in the PAST so the
    // server computes a real, deterministic elapsed on collect (no wall-clock wait).
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.digimon.update({
      where: { id: starter.id },
      data: { trainingStartedAt: twoHoursAgo },
    });

    // COLLECT → gain applied, timestamp cleared.
    const collectRes = await post(`/digimon/${starter.id}/train/collect`, token);
    expect(collectRes.status).toBe(200);
    const collected = (await collectRes.json()) as OwnedDigimon;
    expect(collected.trainingStartedAt == null).toBe(true);
    // A real elapsed session strictly progresses: level up and/or more xp than the base.
    expect(collected.level * 1000 + collected.xp).toBeGreaterThan(
      starter.level * 1000 + starter.xp,
    );
  });

  it('a LONGER seeded elapsed yields a strictly greater gain than a shorter one', async () => {
    // Two fresh accounts (two independent starters) so the comparison is clean.
    const shortToken = await registerAndLogin('short-timed@example.test');
    const longToken = await registerAndLogin('long-timed@example.test');
    const [shortMon] = await getRoster(shortToken);
    const [longMon] = await getRoster(longToken);

    await post(`/digimon/${shortMon.id}/train/start`, shortToken);
    await post(`/digimon/${longMon.id}/train/start`, longToken);

    // Seed distinct past starts: 10 minutes vs 6 hours ago (both well within floor..cap).
    await prisma.digimon.update({
      where: { id: shortMon.id },
      data: { trainingStartedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await prisma.digimon.update({
      where: { id: longMon.id },
      data: { trainingStartedAt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    });

    const shortOut = (await (
      await post(`/digimon/${shortMon.id}/train/collect`, shortToken)
    ).json()) as OwnedDigimon;
    const longOut = (await (
      await post(`/digimon/${longMon.id}/train/collect`, longToken)
    ).json()) as OwnedDigimon;

    const magnitude = (d: OwnedDigimon): number => d.level * 1000 + d.xp;
    expect(magnitude(longOut)).toBeGreaterThan(magnitude(shortOut));
  });

  it('start/collect are owner-scoped — a foreign id 404s (no existence leak)', async () => {
    const owner = await registerAndLogin('owner-timed@example.test');
    const intruder = await registerAndLogin('intruder-timed@example.test');
    const [ownedMon] = await getRoster(owner);

    // The intruder cannot start OR collect the owner's digimon.
    expect((await post(`/digimon/${ownedMon.id}/train/start`, intruder)).status).toBe(404);
    expect((await post(`/digimon/${ownedMon.id}/train/collect`, intruder)).status).toBe(404);
  });

  it('collect on a NOT-training digimon 422s; double-start 422s', async () => {
    const token = await registerAndLogin('guards-timed@example.test');
    const [mon] = await getRoster(token);

    // Not training yet → collect 422.
    expect((await post(`/digimon/${mon.id}/train/collect`, token)).status).toBe(422);
    // Start → ok; a second start while already training → 422 (never resets the clock).
    expect((await post(`/digimon/${mon.id}/train/start`, token)).status).toBe(200);
    expect((await post(`/digimon/${mon.id}/train/start`, token)).status).toBe(422);
  });
});
