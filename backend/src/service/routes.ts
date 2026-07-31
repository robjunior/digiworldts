import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { one, q, tx, type ShopItemRow, type UserRow } from '../db/index.js';
import type { DbAdapter } from '../db/adapter.js';
import { log } from '../util/log.js';
import { requireServiceAuth } from './middleware.js';
import { consumeDiscordLinkCode } from '../auth/discord-link.js';

const SQL_SELECT_LINK_BY_DISCORD = `SELECT id, display_name, discord_id FROM users WHERE discord_id = ?`;
const SQL_SELECT_USER_BY_ID = `SELECT id FROM users WHERE id = ?`;
const SQL_UNLINK_DISCORD = `UPDATE users SET discord_id = NULL, updated_at = ? WHERE discord_id = ?`;
const SQL_SELECT_SERVICE_USER = `SELECT u.id, u.display_name, u.discord_id, u.locale_pref, w.credits, w.premium_until
     FROM users u LEFT JOIN player_wallet w ON w.user_id = u.id WHERE u.discord_id = ?`;
const SQL_SELECT_PRODUCTS = `SELECT * FROM shop_items WHERE enabled = 1 AND class = 'product' ORDER BY price_credits ASC`;
const SQL_RESERVE_GRANT = `INSERT INTO service_grant_log (idempotency_key, endpoint, response_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (idempotency_key) DO NOTHING`;
const SQL_SELECT_GRANT_RESPONSE = `SELECT response_json FROM service_grant_log WHERE idempotency_key = ?`;
const SQL_UPDATE_GRANT_RESPONSE = `UPDATE service_grant_log SET response_json = ? WHERE idempotency_key = ?`;
const SQL_UPSERT_WALLET_CREDIT = `INSERT INTO player_wallet (user_id, credits, streak_day, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at`;
const SQL_SELECT_WALLET_GRANT = `SELECT credits, premium_until FROM player_wallet WHERE user_id = ?`;

const DiscordIdSchema = z.string().trim().min(1).max(64);
const IdempotencyKeySchema = z.string().trim().min(8).max(200);
const ReasonSchema = z.string().trim().min(1).max(200);

const LinkInitSchema = z.object({ discordId: DiscordIdSchema }).strict();
const LinkCompleteSchema = z.object({ discordId: DiscordIdSchema, code: z.string().trim().min(1).max(64) }).strict();
const UnlinkSchema = z.object({ discordId: DiscordIdSchema }).strict();
const WalletCreditSchema = z.object({ userId: z.string().trim().min(1), amount: z.number().int().positive(), idempotencyKey: IdempotencyKeySchema, reason: ReasonSchema }).strict();

type LinkRow = Pick<UserRow, 'id' | 'display_name'> & { readonly discord_id: string | null };
type ServiceUserRow = Pick<UserRow, 'id' | 'display_name' | 'locale_pref'> & {
  readonly discord_id: string;
  readonly credits: number | null;
  readonly premium_until: number | null;
};
type GrantReservation = { readonly kind: 'reserved' } | { readonly kind: 'cached'; readonly response: unknown };

class ServiceRouteError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function reserveGrant(t: DbAdapter, input: { readonly endpoint: string; readonly idempotencyKey: string; readonly now: number }): Promise<GrantReservation> {
  const reserved = await t.run(SQL_RESERVE_GRANT, [input.idempotencyKey, input.endpoint, '{}', input.now]);
  if (reserved.changes === 1) return { kind: 'reserved' };
  const cached = await t.one<{ readonly response_json: string }>(SQL_SELECT_GRANT_RESPONSE, [input.idempotencyKey]);
  if (!cached) throw new ServiceRouteError(500, 'idempotency-log-missing');
  return { kind: 'cached', response: JSON.parse(cached.response_json) };
}

async function storeGrantResponse(t: DbAdapter, input: { readonly idempotencyKey: string; readonly response: Record<string, unknown> }): Promise<void> {
  await t.run(SQL_UPDATE_GRANT_RESPONSE, [JSON.stringify(input.response), input.idempotencyKey]);
}

async function requireUserInTx(t: DbAdapter, userId: string): Promise<void> {
  const user = await t.one<{ readonly id: string }>(SQL_SELECT_USER_BY_ID, [userId]);
  if (!user) throw new ServiceRouteError(404, 'user-not-found');
}

function productJson(item: ShopItemRow): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    priceCredits: item.price_credits,
    kind: item.kind,
    class: item.class,
    payload: JSON.parse(item.payload),
  };
}

export const servicePlugin: FastifyPluginAsync = async (app): Promise<void> => {
  if (!config.SERVICE_TOKEN_DISCORD) {
    log.warn('service.plugin.skipped', { reason: 'SERVICE_TOKEN_DISCORD unset' });
    return;
  }
  if (config.DATABASE !== 'postgres') {
    log.warn('service.plugin.skipped', { reason: 'DATABASE is not postgres' });
    return;
  }

  app.post('/api/service/link-init', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const parsed = LinkInitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const linked = await one<LinkRow>(SQL_SELECT_LINK_BY_DISCORD, parsed.data.discordId);
    return reply.send(linked ? { linked: true, userId: linked.id } : { linked: false });
  });

  app.post('/api/service/link-complete', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const parsed = LinkCompleteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await consumeDiscordLinkCode(parsed.data);
    if (result.kind === 'error') return reply.code(result.status).send({ error: result.code });
    return reply.send(result.alreadyLinked === true
      ? { linked: true, userId: result.userId, alreadyLinked: true }
      : { linked: true, userId: result.userId });
  });

  app.post('/api/service/unlink', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const parsed = UnlinkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await tx((t) => t.run(SQL_UNLINK_DISCORD, [Date.now(), parsed.data.discordId]));
    return reply.send({ ok: true, unlinked: result.changes > 0 });
  });

  app.get<{ Params: { readonly discordId: string } }>('/api/service/user-by-discord/:discordId', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const row = await one<ServiceUserRow>(SQL_SELECT_SERVICE_USER, req.params.discordId);
    if (!row) return reply.code(404).send({ error: 'discord-user-not-linked' });
    return reply.send({
      userId: row.id,
      displayName: row.display_name,
      discordId: row.discord_id,
      credits: row.credits ?? 0,
      premiumUntil: row.premium_until,
      locale: row.locale_pref,
    });
  });

  app.post('/api/service/wallet-credit', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const parsed = WalletCreditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    try {
      const response = await tx(async (t) => {
        const now = Date.now();
        const reservation = await reserveGrant(t, { endpoint: 'wallet-credit', idempotencyKey: parsed.data.idempotencyKey, now });
        if (reservation.kind === 'cached') return reservation.response;
        await requireUserInTx(t, parsed.data.userId);
        await t.run(SQL_UPSERT_WALLET_CREDIT, [parsed.data.userId, parsed.data.amount, now]);
        const wallet = await t.one<{ readonly credits: number }>(SQL_SELECT_WALLET_GRANT, [parsed.data.userId]);
        const body = { ok: true, userId: parsed.data.userId, amount: parsed.data.amount, credits: wallet?.credits ?? parsed.data.amount, reason: parsed.data.reason };
        await storeGrantResponse(t, { idempotencyKey: parsed.data.idempotencyKey, response: body });
        return body;
      });
      return reply.send(response);
    } catch (err) {
      if (err instanceof ServiceRouteError) return reply.code(err.status).send({ error: err.code });
      throw err;
    }
  });

  app.get('/api/service/products', async (req, reply) => {
    await requireServiceAuth(req, reply);
    const products = await q<ShopItemRow>(SQL_SELECT_PRODUCTS);
    return reply.send({ products: products.map(productJson) });
  });
};
