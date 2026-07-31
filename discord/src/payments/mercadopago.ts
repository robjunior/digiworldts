import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { config } from '../config.js';
import type { CreatePixPaymentInput, PaymentProvider, PaymentStatus, PixPayment, RefundResult, WebhookVerificationInput } from './types.js';

const REAL_MP_BASE_URL = 'https://api.mercadopago.com';

const OrderPaymentMethodSchema = z.object({
  id: z.string(),
  type: z.string(),
  qr_code: z.string().nullable().optional(),
  qr_code_base64: z.string().nullable().optional(),
  ticket_url: z.string().nullable().optional(),
}).passthrough();

const OrderPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  amount: z.union([z.string(), z.number()]).transform(String).optional(),
  status: z.string(),
  status_detail: z.string().optional(),
  payment_method: OrderPaymentMethodSchema.optional(),
}).passthrough();

const OrderResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  status_detail: z.string().optional(),
  expiration_time: z.string().nullable().optional(),
  total_amount: z.union([z.string(), z.number()]).transform(String).optional(),
  transactions: z.object({
    payments: z.array(OrderPaymentSchema).min(1),
  }).passthrough(),
}).passthrough();

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

function centsToBrlString(cents: number): string {
  return (cents / 100).toFixed(2);
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
  // MP support 2026-07-31: alphanumeric data.id (Orders API era, ORD*) MUST be lowercased before HMAC.
  // .toLowerCase() is a noop on legacy numeric ids, so applying unconditionally is safe.
  const idSegment = input.dataId === undefined ? '' : `id:${input.dataId.toLowerCase()};`;
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
    const amount = centsToBrlString(input.amountBrlCents);
    const body = {
      type: 'online',
      external_reference: input.externalReference,
      total_amount: amount,
      expiration_time: input.expiresAt.toISOString(),
      payer: {
        email: input.payer.email,
        first_name: input.payer.name,
        last_name: input.payer.lastName,
        identification: { type: input.payer.identificationType, number: input.payer.identificationNumber },
      },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: 'pix', type: 'bank_transfer' },
          },
        ],
      },
    };
    const parsed = await this.request('/v1/orders', OrderResponseSchema, { method: 'POST', idempotencyKey, body });
    const payment = parsed.transactions.payments[0];
    const pm = payment?.payment_method;
    const qrCode = pm?.qr_code ?? null;
    const ticketUrl = pm?.ticket_url ?? null;
    if (payment === undefined || qrCode === null || ticketUrl === null) {
      throw new Error(`mercadopago-order-missing-pix-payload orderId=${parsed.id}`);
    }
    return {
      provider: this.name,
      providerPaymentId: parsed.id,
      innerPaymentId: payment.id,
      status: parsed.status,
      qrCode,
      qrCodeBase64: pm?.qr_code_base64 ?? '',
      ticketUrl,
      expiresAt: parsed.expiration_time ?? null,
      idempotencyKey,
    };
  }

  async getStatus(orderId: string): Promise<PaymentStatus> {
    const parsed = await this.request(`/v1/orders/${encodeURIComponent(orderId)}`, OrderResponseSchema, { method: 'GET' });
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
