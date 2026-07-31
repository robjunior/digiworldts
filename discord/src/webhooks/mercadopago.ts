import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { query } from '../db.js';
import { log } from '../logger.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import { insertWebhookEvent } from '../repo/webhooks.js';
import type { Queryable } from '../repo/types.js';
import { processMercadoPagoPaymentInTransaction } from '../purchase/orchestrator.js';

export type MercadoPagoWebhookDeps = {
  readonly db?: Queryable;
  readonly paymentProvider?: Pick<PaymentProvider, 'verifyWebhook'>;
  readonly now?: () => number;
  readonly processPayment?: (paymentId: string) => Promise<void>;
};

type NormalizedNotification = {
  readonly type: string;
  readonly dataId: string;
  readonly action: string | null;
  readonly rawPayload: unknown;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ack(reply: FastifyReply): FastifyReply {
  return reply.code(200).send({ ok: true });
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function readBodyNotification(body: unknown): NormalizedNotification | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const type = stringOrNull(record['type']);
  const data = record['data'];
  const dataId = typeof data === 'object' && data !== null ? stringOrNull((data as Record<string, unknown>)['id']) : null;
  if (type === null || dataId === null) return null;
  return { type, dataId, action: stringOrNull(record['action']), rawPayload: record };
}

function readQueryNotification(query: unknown): NormalizedNotification | null {
  if (typeof query !== 'object' || query === null) return null;
  const record = query as Record<string, unknown>;
  const type = stringOrNull(record['type']);
  const dataId = stringOrNull(record['data.id']) ?? stringOrNull(record['id']);
  if (type === null || dataId === null) return null;
  return { type, dataId, action: stringOrNull(record['action']), rawPayload: record };
}

export function extractMercadoPagoNotification(request: Pick<FastifyRequest, 'body' | 'query'>): NormalizedNotification | null {
  return readBodyNotification(request.body) ?? readQueryNotification(request.query);
}

export async function registerMercadoPagoWebhook(app: FastifyInstance, deps: MercadoPagoWebhookDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const processPayment = deps.processPayment ?? processMercadoPagoPaymentInTransaction;
  app.post('/webhooks/mercadopago', async (request, reply) => {
    const notification = extractMercadoPagoNotification(request);
    if (notification === null) return reply.code(400).send({ error: 'invalid-webhook-payload' });
    const signatureHeader = headerValue(request.headers['x-signature']);
    const requestId = headerValue(request.headers['x-request-id']);
    const provider = deps.paymentProvider ?? createMercadoPagoProvider();
    const verified = provider.verifyWebhook({ signatureHeader, requestId, dataId: notification.dataId });
    if (!verified) return reply.code(401).send({ error: 'invalid-signature' });
    const inserted = await insertWebhookEvent(db, { provider: 'mercadopago', providerEventId: notification.dataId, eventType: notification.type, payloadJson: JSON.stringify(notification.rawPayload), processedAt: now() });
    if (!inserted) return ack(reply);
    const response = ack(reply);
    setImmediate(() => {
      void processPayment(notification.dataId).catch((error: unknown) => {
        log.warn('mercadopago.webhook.process.failed', { paymentId: notification.dataId, err: error instanceof Error ? error.message : 'unknown error' });
      });
    });
    return response;
  });
}
