import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { query } from '../db.js';
import { log } from '../logger.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import { insertWebhookEvent } from '../repo/webhooks.js';
import type { Queryable } from '../repo/types.js';
import { processMercadoPagoPaymentInTransaction } from '../purchase/orchestrator.js';

const WebhookPayloadSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  type: z.string(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough(),
  live_mode: z.boolean().optional(),
  date_created: z.string().optional(),
}).passthrough();

export type MercadoPagoWebhookDeps = {
  readonly db?: Queryable;
  readonly paymentProvider?: Pick<PaymentProvider, 'verifyWebhook'>;
  readonly now?: () => number;
  readonly processPayment?: (paymentId: string) => Promise<void>;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ack(reply: FastifyReply): FastifyReply {
  return reply.code(200).send({ ok: true });
}

export async function registerMercadoPagoWebhook(app: FastifyInstance, deps: MercadoPagoWebhookDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const processPayment = deps.processPayment ?? processMercadoPagoPaymentInTransaction;
  app.post('/webhooks/mercadopago', async (request, reply) => {
    const parsed = WebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-webhook-payload' });
    const signatureHeader = headerValue(request.headers['x-signature']);
    const requestId = headerValue(request.headers['x-request-id']);
    const provider = deps.paymentProvider ?? createMercadoPagoProvider();
    const verified = provider.verifyWebhook({ signatureHeader, requestId, dataId: parsed.data.data.id });
    if (!verified) return reply.code(401).send({ error: 'invalid-signature' });
    const inserted = await insertWebhookEvent(db, { provider: 'mercadopago', providerEventId: parsed.data.data.id, eventType: parsed.data.type, payloadJson: JSON.stringify(parsed.data), processedAt: now() });
    if (!inserted) return ack(reply);
    const response = ack(reply);
    setImmediate(() => {
      void processPayment(parsed.data.data.id).catch((error: unknown) => {
        log.warn('mercadopago.webhook.process.failed', { paymentId: parsed.data.data.id, err: error instanceof Error ? error.message : 'unknown error' });
      });
    });
    return response;
  });
}
