import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import { PrismaService } from '../prisma/prisma.service';
import { DigimonService } from './digimon.service';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { OwnedDigimon } from './digimon.types';

/**
 * TASK-255 (R-31a) — persisted party-slot MUTATION core. Exercises the guarded
 * owner-scoped `POST /digimon/:id/party` + its `GET /digimon` surfacing over the real
 * HTTP app + throwaway DB (shared `bootHttpTestApp` harness —
 * nest-e2e-and-datastore-tests), PLUS a direct-service unit block for the one-per-slot
 * / 422 / 404 rules (driving the seam the HTTP validation pipe short-circuits before).
 *
 * Party is DOMAIN state (invariant 3 untriggered — no ResourceBalance/AuditLog); every
 * read/write is owner-scoped (`{ userId, deletedAt: null }`, invariant 2 — a foreign or
 * soft-deleted id 404s with no existence leak).
 */
describe('Party-slot mutation API (end-to-end)', () => {
  let ctx: TempDatastore;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let service: DigimonService;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
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

  beforeAll(async () => {
    ctx = await bootHttpTestApp('party-slot');
    app = ctx.app;
    baseUrl = ctx.baseUrl;
    prisma = app.get(PrismaService);
    service = app.get(DigimonService);
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('POST /party {slot:1} persists partySlot=1 and GET /digimon surfaces it; {slot:null} clears it', async () => {
    const token = await registerAndLogin('alice-party@example.test');
    const [starter] = await getRoster(token);
    // A fresh starter is not in any party.
    expect(starter.partySlot == null).toBe(true);

    // Assign slot 1 → 200 + surfaced.
    const assign = await jsonPost(`/digimon/${starter.id}/party`, { slot: 1 }, token);
    expect(assign.status).toBe(200);
    expect(((await assign.json()) as OwnedDigimon).partySlot).toBe(1);

    // GET /digimon reflects the persisted choice.
    const afterAssign = (await getRoster(token)).find((d) => d.id === starter.id);
    expect(afterAssign?.partySlot).toBe(1);

    // Clear it → null on the wire + on the next read.
    const clear = await jsonPost(`/digimon/${starter.id}/party`, { slot: null }, token);
    expect(clear.status).toBe(200);
    expect(((await clear.json()) as OwnedDigimon).partySlot == null).toBe(true);
    const afterClear = (await getRoster(token)).find((d) => d.id === starter.id);
    expect(afterClear?.partySlot == null).toBe(true);
  });

  it('one Digimon per slot — re-assigning a slot to another owned Digimon frees the previous holder', async () => {
    const token = await registerAndLogin('bob-party@example.test');
    // Seed a SECOND owned digimon so there are two candidates for the same slot.
    const [first] = await getRoster(token);
    const owner = await prisma.digimon.findFirstOrThrow({ where: { id: first.id } });
    const second = await prisma.digimon.create({
      data: {
        userId: owner.userId,
        name: 'Gabumon',
        type: 'Data',
        element: 'Water',
        stage: 'Rookie',
        hp: 50,
        atk: 12,
        def: 11,
        spd: 9,
        level: 1,
      },
    });

    // Put the first in slot 1.
    expect((await jsonPost(`/digimon/${first.id}/party`, { slot: 1 }, token)).status).toBe(200);
    // Now claim slot 1 for the second → the first must be freed (one per slot).
    expect((await jsonPost(`/digimon/${second.id}/party`, { slot: 1 }, token)).status).toBe(200);

    const roster = await getRoster(token);
    const firstAfter = roster.find((d) => d.id === first.id);
    const secondAfter = roster.find((d) => d.id === second.id);
    expect(secondAfter?.partySlot).toBe(1);
    expect(firstAfter?.partySlot == null).toBe(true);
  });

  it('an unauthenticated POST → 401', async () => {
    const noToken = await jsonPost('/digimon/anything/party', { slot: 1 });
    expect(noToken.status).toBe(401);
  });

  it('an out-of-range slot → 400 (validation active — the P-7 pipe guard rejects before the handler)', async () => {
    const token = await registerAndLogin('carol-party@example.test');
    const [mon] = await getRoster(token);
    expect((await jsonPost(`/digimon/${mon.id}/party`, { slot: 9 }, token)).status).toBe(400);
    expect((await jsonPost(`/digimon/${mon.id}/party`, { slot: 0 }, token)).status).toBe(400);
  });

  it("another user's Digimon id → 404 (owner-scoped, no existence leak)", async () => {
    const owner = await registerAndLogin('owner-party@example.test');
    const intruder = await registerAndLogin('intruder-party@example.test');
    const [ownedMon] = await getRoster(owner);
    expect((await jsonPost(`/digimon/${ownedMon.id}/party`, { slot: 1 }, intruder)).status).toBe(
      404,
    );
  });

  // Direct-service seam: the HTTP pipe rejects bad slots before the service runs, so the
  // service's OWN guard + the 404/soft-delete rules are driven directly here.
  describe('setPartySlot service rules', () => {
    it('a non-integer / out-of-range slot → 422 UnprocessableEntity even on the direct path', async () => {
      const token = await registerAndLogin('svc-guard@example.test');
      const [mon] = await getRoster(token);
      const found = await prisma.digimon.findFirstOrThrow({ where: { id: mon.id } });
      await expect(service.setPartySlot(found.userId, mon.id, 4)).rejects.toMatchObject({
        status: 422,
      });
      await expect(service.setPartySlot(found.userId, mon.id, 1.5)).rejects.toMatchObject({
        status: 422,
      });
      // null and a valid int in [1,3] are accepted.
      expect((await service.setPartySlot(found.userId, mon.id, 3)).partySlot).toBe(3);
      expect((await service.setPartySlot(found.userId, mon.id, null)).partySlot == null).toBe(true);
    });

    it('a foreign id → 404; a soft-deleted id → 404 (invariant 2, no leak)', async () => {
      const token = await registerAndLogin('svc-scope@example.test');
      const [mon] = await getRoster(token);
      const found = await prisma.digimon.findFirstOrThrow({ where: { id: mon.id } });

      // Foreign owner cannot touch it.
      await expect(service.setPartySlot('some-other-user-id', mon.id, 1)).rejects.toMatchObject({
        status: 404,
      });

      // Soft-delete it → even the true owner now 404s.
      await prisma.digimon.update({ where: { id: mon.id }, data: { deletedAt: new Date() } });
      await expect(service.setPartySlot(found.userId, mon.id, 1)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
