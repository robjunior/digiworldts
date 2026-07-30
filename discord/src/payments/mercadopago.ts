import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { config } from '../config.js';
import type { CreatePixPaymentInput, PaymentProvider, PaymentStatus, PixPayment, RefundResult, WebhookVerificationInput } from './types.js';

const REAL_MP_BASE_URL = 'https://api.mercadopago.com';

const PixResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  date_of_expiration: z.string().nullable().optional(),
  point_of_interaction: z.object({
    transaction_data: z.object({
      qr_code: z.string(),
      qr_code_base64: z.string(),
      ticket_url: z.string(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const StatusResponseSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), status: z.string() }).passthrough();
const RefundResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  payment_id: z.union([z.string(), z.number()]).transform(String),
  amount: z.number().nullable().optional(),
  status: z.string(),
}).passthrough();

export type MercadoPagoOptions = {
  readonly accessToken: string;
  readonly webhookSecret: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

type JsonSchema<T> = { readonly parse: (value: unknown) => T };

export class MercadoPagoHttpError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`mercadopago-http-error status=${status} ${describeMercadoPagoError(body)}`);
    this.name = 'MercadoPagoHttpError';
  }
}

function describeMercadoPagoError(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const record = body as Record<string, unknown>;
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  const causes = Array.isArray(record['cause'])
    ? record['cause']
        .map((entry) => (typeof entry === 'object' && entry !== null ? String((entry as Record<string, unknown>)['description'] ?? '') : ''))
        .filter((description) => description.length > 0)
    : [];
  return causes.length > 0 ? `${message} (${causes.join('; ')})` : message;
}

function centsToBrl(cents: number): number {
  return cents / 100;
}

function parseSignature(header: string | undefined): { readonly ts: string; readonly v1: string } | null {
  if (header === undefined) return null;
  const parts = new Map(header.split(',').map((part) => {
    const [key, value] = part.trim().split('=', 2);
    return [key, value] as const;
  }));
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  return ts && v1 ? { ts, v1 } : null;
}

export function buildMercadoPagoManifest(input: { readonly dataId?: string | undefined; readonly requestId?: string | undefined; readonly ts: string }): string {
  const idSegment = input.dataId === undefined ? '' : `id:${input.dataId};`;
  const requestSegment = input.requestId === undefined ? '' : `request-id:${input.requestId};`;
  return `${idSegment}${requestSegment}ts:${input.ts};`;
}

export function signMercadoPagoWebhook(input: { readonly dataId?: string | undefined; readonly requestId?: string | undefined; readonly ts: string; readonly secret: string }): string {
  return createHmac('sha256', input.secret).update(buildMercadoPagoManifest(input)).digest('hex');
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: MercadoPagoOptions) {
    this.baseUrl = options.baseUrl ?? REAL_MP_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<PixPayment> {
    const idempotencyKey = randomUUID();
    const body = {
      transaction_amount: centsToBrl(input.amountBrlCents),
      payment_method_id: 'pix',
      payer: {
        email: input.payer.email,
        identification: { type: input.payer.identificationType, number: input.payer.identificationNumber },
        first_name: input.payer.name,
        last_name: input.payer.lastName,
      },
      description: input.description,
      notification_url: input.notificationUrl,
      date_of_expiration: input.expiresAt.toISOString(),
    };
    const parsed = await this.request('/v1/payments', PixResponseSchema, { method: 'POST', idempotencyKey, body });
    const data = parsed.point_of_interaction.transaction_data;
    return { provider: this.name, providerPaymentId: parsed.id, status: parsed.status, qrCode: data.qr_code, qrCodeBase64: data.qr_code_base64, ticketUrl: data.ticket_url, expiresAt: parsed.date_of_expiration ?? null, idempotencyKey };
  }

  async getStatus(paymentId: string): Promise<PaymentStatus> {
    const parsed = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}`, StatusResponseSchema, { method: 'GET' });
    return { provider: this.name, providerPaymentId: parsed.id, status: parsed.status, raw: parsed };
  }

  async refund(paymentId: string, amountBrlCents?: number): Promise<RefundResult> {
    const idempotencyKey = randomUUID();
    const body = amountBrlCents === undefined ? undefined : { amount: centsToBrl(amountBrlCents) };
    const parsed = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, RefundResponseSchema, { method: 'POST', idempotencyKey, body });
    return { provider: this.name, refundId: parsed.id, paymentId: parsed.payment_id, amount: parsed.amount ?? null, status: parsed.status };
  }

  verifyWebhook(input: WebhookVerificationInput): boolean {
    const parsed = parseSignature(input.signatureHeader);
    if (parsed === null) return false;
    const expected = signMercadoPagoWebhook({ dataId: input.dataId, requestId: input.requestId, ts: parsed.ts, secret: this.options.webhookSecret });
    const actualBuffer = Buffer.from(parsed.v1, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private async request<T>(path: string, schema: JsonSchema<T>, init: { readonly method: 'GET' | 'POST'; readonly idempotencyKey?: string; readonly body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.options.accessToken}`, Accept: 'application/json' };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      if (init.idempotencyKey !== undefined) headers['X-Idempotency-Key'] = init.idempotencyKey;
      const requestInit: RequestInit = { method: init.method, headers, signal: controller.signal };
      if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
      const response = await fetch(new URL(path, this.baseUrl), requestInit);
      const body = await response.json().catch((error: unknown) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (!response.ok) throw new MercadoPagoHttpError(response.status, body);
      return schema.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createMercadoPagoProvider(): MercadoPagoProvider {
  if (!config.MP_ACCESS_TOKEN || !config.MP_WEBHOOK_SECRET) throw new Error('mercadopago-config-missing');
  return new MercadoPagoProvider({ accessToken: config.MP_ACCESS_TOKEN, webhookSecret: config.MP_WEBHOOK_SECRET });
}
