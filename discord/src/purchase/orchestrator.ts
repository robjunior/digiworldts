import { randomUUID } from 'node:crypto';

import type { BackendGateway } from '../backendClient.js';
import { createBackendClient } from '../backendClient.js';
import { query, tx } from '../db.js';
import { loadProductCatalog, type ProductConfig } from '../products.js';
import { getPurchaseSessionByProviderPayment, markPurchaseDelivered, updatePurchaseSessionState } from '../repo/purchases.js';
import type { PurchaseSession, Queryable } from '../repo/types.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import { decideMercadoPagoTransition, decideTransition, isMercadoPagoStatus, isPurchaseState, recordPurchaseEvent } from './stateMachine.js';

type OrchestratorDeps = {
  readonly db?: Queryable;
  readonly paymentProvider?: Pick<PaymentProvider, 'getStatus'>;
  readonly backendClient?: Pick<BackendGateway, 'walletCredit'>;
  readonly loadCatalog?: () => Promise<{ readonly products: readonly ProductConfig[] }>;
  readonly now?: () => number;
};

function eventPayload(value: unknown): string {
  return JSON.stringify(value);
}

async function recordTransition(db: Queryable, session: PurchaseSession, toState: string, providerStatus: string | null, reason: string | null, now: number, payload: unknown): Promise<void> {
  await recordPurchaseEvent(db, { id: randomUUID(), sessionId: session.id, fromState: session.state, toState, providerStatus, reason, payloadJson: eventPayload(payload), createdAt: now });
}

function findProduct(products: readonly ProductConfig[], sku: string): ProductConfig | null {
  return products.find((product) => product.sku === sku && product.enabled !== false) ?? null;
}

async function grantReward(backendClient: Pick<BackendGateway, 'walletCredit'>, session: PurchaseSession, product: ProductConfig): Promise<void> {
  const idempotencyKey = `purchase:${session.id}:reward`;
  const reason = `discord-purchase:${session.id}`;
  await backendClient.walletCredit({ userId: session.userId, amount: product.creditsAmount, idempotencyKey, reason });
}

export async function processMercadoPagoPayment(paymentId: string, deps: OrchestratorDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const backendClient = deps.backendClient ?? createBackendClient();
  const loadCatalog = deps.loadCatalog ?? loadProductCatalog;
  const now = deps.now ?? Date.now;
  const status = await paymentProvider.getStatus(paymentId);
  if (!isMercadoPagoStatus(status.status)) return;
  const session = await getPurchaseSessionByProviderPayment(db, 'mercadopago', paymentId);
  if (session === null || !isPurchaseState(session.state)) return;
  const decision = decideMercadoPagoTransition(session.state, status.status);
  const timestamp = now();
  if (decision.kind === 'rejected') {
    await recordTransition(db, session, decision.to, decision.providerStatus, decision.reason, timestamp, status.raw);
    return;
  }
  if (decision.kind === 'accepted') {
    await updatePurchaseSessionState(db, session.id, decision.to, timestamp);
    await recordTransition(db, session, decision.to, decision.providerStatus, null, timestamp, status.raw);
  }
  if (decision.to !== 'paid') return;
  const deliveringDecision = decideTransition('paid', 'delivering', status.status);
  if (deliveringDecision.kind !== 'accepted') return;
  const products = await loadCatalog();
  const product = findProduct(products.products, session.sku);
  if (product === null) {
    await recordTransition(db, { ...session, state: 'paid' }, 'failed', status.status, 'product-not-found', timestamp, status.raw);
    await updatePurchaseSessionState(db, session.id, 'failed', timestamp);
    return;
  }
  await updatePurchaseSessionState(db, session.id, 'delivering', timestamp);
  await recordTransition(db, { ...session, state: 'paid' }, 'delivering', status.status, null, timestamp, status.raw);
  await grantReward(backendClient, session, product);
  const deliveredAt = now();
  await markPurchaseDelivered(db, session.id, 'delivered', deliveredAt);
  await recordTransition(db, { ...session, state: 'delivering' }, 'delivered', status.status, null, deliveredAt, status.raw);
}

export async function processMercadoPagoPaymentInTransaction(paymentId: string): Promise<void> {
  await tx(async (client) => processMercadoPagoPayment(paymentId, { db: client }));
}
