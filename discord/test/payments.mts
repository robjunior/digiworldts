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

async function main(): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      captured.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/v1/payments' && req.method === 'POST') json(res, 200, { id: 'pay_123', status: 'pending', date_of_expiration: '2026-07-30T14:30:00.000Z', point_of_interaction: { transaction_data: { qr_code: 'pix-code', qr_code_base64: 'pix-base64', ticket_url: 'http://ticket.test' } } });
      else if (req.url === '/v1/payments/pay_123' && req.method === 'GET') json(res, 200, { id: 'pay_123', status: 'approved' });
      else if (req.url === '/v1/payments/pay_123/refunds' && req.method === 'POST') json(res, 200, { id: 'refund_1', payment_id: 'pay_123', amount: 1.23, status: 'approved' });
      else json(res, 404, { error: 'not-found' });
    })().catch((error: unknown) => json(res, 500, { error: error instanceof Error ? error.message : 'unknown' }));
  });
  const port = await listen(server);
  const { MercadoPagoProvider, buildMercadoPagoManifest } = await import('../src/payments/mercadopago.js');
  const provider = new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: 'secret', baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1_000 });
  const payment = await provider.createPixPayment({ amountBrlCents: 123, payer: { email: 'buyer@test.local', name: 'Test', lastName: 'Buyer', identificationType: 'CPF', identificationNumber: '12345678909' }, description: 'DigiWorld SKU', notificationUrl: 'http://local/webhooks/mercadopago', expiresAt: new Date('2026-07-30T14:30:00.000Z') });
  assertEqual(payment.qrCode, 'pix-code', 'PIX qr_code parsed');
  assertEqual(payment.qrCodeBase64, 'pix-base64', 'PIX qr_code_base64 parsed');
  assertEqual(payment.ticketUrl, 'http://ticket.test', 'PIX ticket_url parsed');
  const createRequest = captured[0];
  assert(createRequest !== undefined, 'create request captured');
  assertEqual(createRequest.method, 'POST', 'create uses POST');
  assertEqual(createRequest.headers.authorization, 'Bearer TEST-token', 'Bearer token sent');
  assert(typeof createRequest.headers['x-idempotency-key'] === 'string' && /^[0-9a-f-]{36}$/.test(createRequest.headers['x-idempotency-key']), 'UUID idempotency key sent');
  const requestBody = JSON.parse(createRequest.body) as {
    readonly transaction_amount: number;
    readonly payment_method_id: string;
    readonly date_of_expiration: string;
    readonly payer: Readonly<Record<string, unknown>> & { readonly identification: { readonly type: string } };
  };
  assertEqual(requestBody.transaction_amount, 1.23, 'amount converted to BRL');
  assertEqual(requestBody.payment_method_id, 'pix', 'PIX method sent');
  assertEqual(requestBody.payer.identification.type, 'CPF', 'payer identification sent');

  // MercadoPago rejects `payer.name` with a 400. The wire field is `first_name`.
  // Pin the exact key names — asserting only `identification` let a real bug ship.
  assertEqual(requestBody.payer['first_name'], 'Test', 'payer uses first_name, not name');
  assertEqual(requestBody.payer['last_name'], 'Buyer', 'payer uses last_name');
  assertEqual(requestBody.payer['name'], undefined, 'payer must NOT send the rejected `name` key');
  assertEqual(requestBody.payer['email'], 'buyer@test.local', 'payer email sent');
  assertEqual(requestBody.date_of_expiration, '2026-07-30T14:30:00.000Z', 'expiration sent');
  assertEqual((await provider.getStatus('pay_123')).status, 'approved', 'status fetched');
  assertEqual((await provider.refund('pay_123', 123)).refundId, 'refund_1', 'refund parsed');

  // Signature tests use INDEPENDENT vectors: the expected manifest is written
  // out literally and the HMAC is computed here with node:crypto, never via
  // buildMercadoPagoManifest. Deriving the expectation from the implementation
  // would make these assertions tautological — a manifest-format regression
  // would break signing and verification together and still "pass".
  assertEqual(
    buildMercadoPagoManifest({ dataId: 'pay_123', requestId: 'req_9', ts: '12345' }),
    'id:pay_123;request-id:req_9;ts:12345;',
    'manifest with all fields matches the documented MercadoPago template',
  );
  assertEqual(
    buildMercadoPagoManifest({ dataId: 'pay_123', requestId: undefined, ts: '12345' }),
    'id:pay_123;ts:12345;',
    'missing request-id drops the whole segment, never emits undefined',
  );
  assertEqual(
    buildMercadoPagoManifest({ dataId: undefined, requestId: undefined, ts: '12345' }),
    'ts:12345;',
    'all optional segments droppable',
  );

  const vectorFull = createHmac('sha256', 'secret').update('id:pay_123;request-id:req_9;ts:12345;').digest('hex');
  assert(
    provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorFull}`, requestId: 'req_9', dataId: 'pay_123' }),
    'independently computed signature verifies (full manifest)',
  );

  const vectorNoRequestId = createHmac('sha256', 'secret').update('id:pay_123;ts:12345;').digest('hex');
  assert(
    provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorNoRequestId}`, requestId: undefined, dataId: 'pay_123' }),
    'independently computed signature verifies with x-request-id absent',
  );

  assert(
    !provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${vectorNoRequestId}`, requestId: undefined, dataId: 'tampered' }),
    'tampered data id fails',
  );
  assert(
    !provider.verifyWebhook({ signatureHeader: `ts=12345,v1=${'0'.repeat(64)}`, requestId: undefined, dataId: 'pay_123' }),
    'wrong signature fails',
  );
  assert(
    !provider.verifyWebhook({ signatureHeader: 'ts=12345,v1=deadbeef', requestId: undefined, dataId: 'pay_123' }),
    'length-mismatched signature fails without throwing',
  );

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  process.stdout.write('payment provider tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
