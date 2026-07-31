import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type CapturedRequest = { readonly method: string; readonly url: string; readonly headers: IncomingMessage['headers']; readonly body: string };

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(typeof address === 'object' && address !== null, 'mock server address exists');
  return address.port;
}

const ORDER_CREATE_RESPONSE = {
  id: 'order_1',
  status: 'action_required',
  status_detail: 'waiting_transfer',
  expiration_time: '2026-07-30T14:30:00.000Z',
  total_amount: '1.23',
  transactions: {
    payments: [
      {
        id: 'pay_opaque_1',
        amount: '1.23',
        status: 'action_required',
        status_detail: 'waiting_transfer',
        payment_method: {
          id: 'pix',
          type: 'bank_transfer',
          qr_code: 'pix-code',
          qr_code_base64: 'pix-base64',
          ticket_url: 'http://ticket.test',
        },
      },
    ],
  },
};

const ORDER_STATUS_RESPONSE = {
  id: 'order_1',
  status: 'processed',
  status_detail: 'accredited',
  transactions: { payments: [{ id: 'pay_opaque_1', status: 'processed', payment_method: { id: 'pix', type: 'bank_transfer' } }] },
};

async function main(): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      captured.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/v1/orders' && req.method === 'POST') json(res, 200, ORDER_CREATE_RESPONSE);
      else if (req.url === '/v1/orders/order_1' && req.method === 'GET') json(res, 200, ORDER_STATUS_RESPONSE);
      else if (req.url === '/v1/payments/pay_opaque_1/refunds' && req.method === 'POST') json(res, 200, { id: 'refund_1', payment_id: 'pay_opaque_1', amount: 1.23, status: 'approved' });
      else json(res, 404, { error: 'not-found', url: req.url });
    })().catch((error: unknown) => json(res, 500, { error: error instanceof Error ? error.message : 'unknown' }));
  });
  const port = await listen(server);
  const { MercadoPagoProvider, buildMercadoPagoManifest } = await import('../src/payments/mercadopago.js');
  const provider = new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: 'secret', baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1_000 });
  const payment = await provider.createPixPayment({ amountBrlCents: 123, payer: { email: 'buyer@test.local', name: 'Test', lastName: 'Buyer', identificationType: 'CPF', identificationNumber: '12345678909' }, description: 'DigiWorld SKU', externalReference: 'sess-abc-123', notificationUrl: 'http://local/webhooks/mercadopago', expiresAt: new Date('2026-07-30T14:30:00.000Z') });

  assertEqual(payment.providerPaymentId, 'order_1', 'orders API — providerPaymentId is the order id, not the opaque payment id');
  assertEqual(payment.innerPaymentId, 'pay_opaque_1', 'orders API — innerPaymentId is the payment id inside the order (for /v1/payments/{id}/refunds addressability, REV-1.4)');
  assertEqual(payment.status, 'action_required', 'initial order status is action_required (waiting_transfer)');
  assertEqual(payment.qrCode, 'pix-code', 'PIX qr_code parsed from transactions.payments[0].payment_method');
  assertEqual(payment.qrCodeBase64, 'pix-base64', 'PIX qr_code_base64 parsed');
  assertEqual(payment.ticketUrl, 'http://ticket.test', 'PIX ticket_url parsed');
  assertEqual(payment.expiresAt, '2026-07-30T14:30:00.000Z', 'expiration_time surfaced as expiresAt');

  const createRequest = captured[0];
  assert(createRequest !== undefined, 'create request captured');
  assertEqual(createRequest.url, '/v1/orders', 'orders API — POST /v1/orders replaces /v1/payments');
  assertEqual(createRequest.method, 'POST', 'create uses POST');
  assertEqual(createRequest.headers.authorization, 'Bearer TEST-token', 'Bearer token sent');
  assert(typeof createRequest.headers['x-idempotency-key'] === 'string' && /^[0-9a-f-]{36}$/.test(createRequest.headers['x-idempotency-key']), 'UUID idempotency key sent');

  const requestBody = JSON.parse(createRequest.body) as {
    readonly type: string;
    readonly external_reference: string;
    readonly expiration_time: string;
    readonly total_amount: string;
    readonly payer: Readonly<Record<string, unknown>> & { readonly identification: { readonly type: string } };
    readonly transactions: { readonly payments: readonly { readonly amount: string; readonly payment_method: { readonly id: string; readonly type: string } }[] };
  };
  assertEqual(requestBody.type, 'online', 'orders API — type=online required at top level');
  assertEqual(requestBody.external_reference, 'sess-abc-123', 'external_reference carries the purchase session id, so an orphaned order can be reconciled');
  assertEqual(requestBody.expiration_time, '2026-07-30T14:30:00.000Z', 'requested expiry reaches MercadoPago instead of being a dead parameter');
  assertEqual(requestBody.total_amount, '1.23', 'total_amount encoded as string (orders API is string-typed)');
  assertEqual(requestBody.transactions.payments.length, 1, 'exactly one PIX payment inside transactions.payments');
  assertEqual(requestBody.transactions.payments[0]?.amount, '1.23', 'per-payment amount matches order total');
  assertEqual(requestBody.transactions.payments[0]?.payment_method.id, 'pix', 'PIX method nested under transactions.payments[].payment_method');
  assertEqual(requestBody.transactions.payments[0]?.payment_method.type, 'bank_transfer', 'PIX type=bank_transfer as required by orders API');

  assertEqual(requestBody.payer.identification.type, 'CPF', 'payer identification sent');
  assertEqual(requestBody.payer['first_name'], 'Test', 'payer uses first_name, not name');
  assertEqual(requestBody.payer['last_name'], 'Buyer', 'payer uses last_name');
  assertEqual(requestBody.payer['name'], undefined, 'payer must NOT send the rejected `name` key');
  assertEqual(requestBody.payer['email'], 'buyer@test.local', 'payer email sent');

  const status = await provider.getStatus('order_1');
  assertEqual(status.providerPaymentId, 'order_1', 'getStatus keyed by order_id');
  assertEqual(status.status, 'processed', 'orders API status fetched (processed = paid)');
  assertEqual(captured[1]?.url, '/v1/orders/order_1', 'getStatus targets /v1/orders/{id}, not /v1/payments/{id}');

  assertEqual((await provider.refund('pay_opaque_1', 123)).refundId, 'refund_1', 'refund parsed');

  assertEqual(
    buildMercadoPagoManifest({ dataId: 'order_1', requestId: 'req_9', ts: '12345' }),
    'id:order_1;request-id:req_9;ts:12345;',
    'manifest with all fields matches the documented MercadoPago template',
  );
  assertEqual(
    buildMercadoPagoManifest({ dataId: 'ORDTST01KYTJ69C18Z806VPPN8SMSBEF', requestId: 'req_9', ts: '12345' }),
    'id:ordtst01kytj69c18z806vppn8smsbef;request-id:req_9;ts:12345;',
    'alphanumeric dataId (ORD* Orders API era) lowercased before HMAC per MP support 2026-07-31',
  );
  assertEqual(
    buildMercadoPagoManifest({ dataId: 'order_1', requestId: undefined, ts: '12345' }),
    'id:order_1;ts:12345;',
    'missing request-id drops the whole segment, never emits undefined',
  );
  assertEqual(
    buildMercadoPagoManifest({ dataId: undefined, requestId: undefined, ts: '12345' }),
    'ts:12345;',
    'all optional segments droppable',
  );

  const vectorFull = createHmac('sha256', 'secret').update('id:order_1;request-id:req_9;ts:12345;').digest('hex');
  assert(
    provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorFull}`, requestId: 'req_9', dataId: 'order_1' }),
    'independently computed signature verifies (full manifest)',
  );

  const vectorNoRequestId = createHmac('sha256', 'secret').update('id:order_1;ts:12345;').digest('hex');
  assert(
    provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorNoRequestId}`, requestId: undefined, dataId: 'order_1' }),
    'independently computed signature verifies with x-request-id absent',
  );

  const vectorUppercaseOrder = createHmac('sha256', 'secret').update('id:ordtst01kytj69c18z806vppn8smsbef;request-id:req_9;ts:12345;').digest('hex');
  assert(
    provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorUppercaseOrder}`, requestId: 'req_9', dataId: 'ORDTST01KYTJ69C18Z806VPPN8SMSBEF' }),
    'verifyWebhook lowercases alphanumeric dataId to match MP signature contract (MP support 2026-07-31)',
  );

  assert(
    !provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorNoRequestId}`, requestId: undefined, dataId: 'tampered' }),
    'tampered data id fails',
  );
  assert(
    !provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${'0'.repeat(64)}`, requestId: undefined, dataId: 'order_1' }),
    'wrong signature fails',
  );
  assert(
    !provider.verifyWebhook({ signatureHeader: 'ts=12345,v1=deadbeef', requestId: undefined, dataId: 'order_1' }),
    'length-mismatched signature fails without throwing',
  );

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  process.stdout.write('payment provider tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
