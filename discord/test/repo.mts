import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assert, assertEqual } from './assert.mjs';
import {
  closeTicket,
  disablePromoCode,
  getAuditLog,
  getLinkByDiscordId,
  getPromoCode,
  getPromoRedemption,
  getPurchaseEvent,
  getPurchaseSession,
  getTicket,
  getWebhookEvent,
  insertAuditLog,
  insertPromoCode,
  insertPromoRedemption,
  insertPurchaseEvent,
  insertPurchaseSession,
  insertTicket,
  insertWebhookEvent,
  markLinkLinked,
  updatePurchaseSessionState,
  type Queryable,
} from '../src/repo/index.js';

type PgliteRaw = {
  readonly exec: (sql: string) => Promise<unknown>;
  readonly query: <Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) => Promise<{ readonly rows: readonly Row[] }>;
};

function queryable(raw: PgliteRaw): PgliteRaw & Queryable {
  return {
    exec: raw.exec.bind(raw),
    async query<Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const result = await raw.query<Row>(text, params);
      const command = text.trimStart().split(/\s+/, 1)[0]?.toUpperCase();
      const duplicateIgnored = command === 'INSERT' && text.includes('ON CONFLICT') && result.rows.length === 0;
      return { rows: result.rows, rowCount: duplicateIgnored ? 0 : 1 };
    },
  };
}

async function main(): Promise<void> {
  const db = queryable(new PGlite());
  await db.exec(readFileSync(resolve('../backend/src/db/migrations/030_commerce_schema.pg.sql'), 'utf8'));
  await db.query('SET search_path = commerce, public');
  await db.query('BEGIN');
  const now = 1_700_000_000_000;

  await markLinkLinked(db, { discordId: 'discord-1', userId: 'user-1', accessToken: null, refreshToken: null, tokenExpiresAt: null, now: now + 1 });
  assertEqual((await getLinkByDiscordId(db, 'discord-1'))?.state ?? null, 'linked', 'discord link upserts linked row');

  await insertPurchaseSession(db, { id: 'session-1', userId: 'user-1', discordId: 'discord-1', guildId: 'guild-1', sku: 'sku-1', provider: 'mp', providerPaymentId: 'pay-1', state: 'awaiting_payment', amountBrlCents: 1234, currency: 'BRL', idempotencyKey: 'idem-1', qrCode: 'qr', qrCodeBase64: 'base64', ticketUrl: 'ticket', expiresAt: now + 60_000, deliveredAt: null, metadataJson: '{}', createdAt: now, updatedAt: now });
  await updatePurchaseSessionState(db, 'session-1', 'paid', now + 2);
  assertEqual((await getPurchaseSession(db, 'session-1'))?.state ?? null, 'paid', 'purchase session state updates');
  await insertPurchaseEvent(db, { id: 'event-1', sessionId: 'session-1', fromState: 'awaiting_payment', toState: 'paid', providerStatus: 'approved', reason: 'test', payloadJson: '{}', createdAt: now });
  assertEqual((await getPurchaseEvent(db, 'event-1'))?.toState ?? null, 'paid', 'purchase event reads');

  await insertPromoCode(db, { id: 'promo-1', code: 'SAVE', kind: 'fixed_brl', discountBrlCents: 500, maxUses: null, usesCount: 0, startsAt: null, expiresAt: null, disabledAt: null, createdBy: 'admin', createdAt: now });
  await disablePromoCode(db, 'promo-1', now + 3);
  assertEqual((await getPromoCode(db, 'promo-1'))?.disabledAt ?? null, now + 3, 'promo disables');
  await insertPromoRedemption(db, { userId: 'user-1', codeId: 'promo-1', purchaseSessionId: 'session-1', redeemedAt: now });
  assertEqual((await getPromoRedemption(db, 'user-1', 'promo-1'))?.purchaseSessionId ?? null, 'session-1', 'promo redemption reads');

  await insertTicket(db, { id: 'ticket-1', userId: 'user-1', discordId: 'discord-1', guildId: 'guild-1', channelId: 'chan-1', lastPurchaseSessionId: 'session-1', status: 'open', transcript: null, openedAt: now, closedAt: null, lastActivityAt: now });
  await closeTicket(db, 'ticket-1', now + 4);
  assertEqual((await getTicket(db, 'ticket-1'))?.status ?? null, 'closed', 'ticket closes');

  assert(await insertWebhookEvent(db, { provider: 'mercadopago', providerEventId: 'evt-1', eventType: 'payment', payloadJson: '{}', processedAt: now }), 'first webhook insert wins');
  assert(!(await insertWebhookEvent(db, { provider: 'mercadopago', providerEventId: 'evt-1', eventType: 'payment', payloadJson: '{}', processedAt: now })), 'duplicate webhook is ignored');
  assertEqual((await getWebhookEvent(db, 'mercadopago', 'evt-1'))?.eventType ?? null, 'payment', 'webhook reads');

  await insertAuditLog(db, { id: 'audit-1', actorDiscordId: 'admin-discord', action: 'stats', targetId: 'target-1', payloadJson: '{}', createdAt: now });
  assertEqual((await getAuditLog(db, 'audit-1'))?.action ?? null, 'stats', 'audit reads');

  await db.query('ROLLBACK');
  assertEqual((await getLinkByDiscordId(db, 'discord-1'))?.discordId ?? null, null, 'transaction rollback removed rows');
  process.stdout.write('repo commerce transaction test passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
