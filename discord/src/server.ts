import Fastify, { type FastifyInstance } from 'fastify';

import { registerMercadoPagoWebhook, type MercadoPagoWebhookDeps } from './webhooks/mercadopago.js';

export type HealthResponse = Readonly<{
  ok: true;
  service: 'discord-commerce';
}>;

export type ServerDeps = { readonly mercadoPagoWebhook?: MercadoPagoWebhookDeps };

export function createServer(deps: ServerDeps = {}): FastifyInstance {
  const app: FastifyInstance = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      base: { service: 'discord-commerce' },
    },
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    ok: true,
    service: 'discord-commerce',
  }));

  void registerMercadoPagoWebhook(app, deps.mercadoPagoWebhook);

  return app;
}
