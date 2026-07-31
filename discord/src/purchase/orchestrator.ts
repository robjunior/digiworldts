import { randomUUID } from 'node:crypto';

import type { BackendGateway } from '../backendClient.js';
import { createBackendClient } from '../backendClient.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { log } from '../logger.js';
import { getPurchaseSessionByProviderPayment, markPurchaseDelivered, updatePurchaseSessionState } from '../repo/purchases.js';
import type { PurchaseSession, Queryable } from '../repo/types.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import type { NotificationService } from '../notifications.js';
import { decideMercadoPagoTransition, decideTransition, isMercadoPagoStatus, isPurchaseState, recordPurchaseEvent } from './stateMachine.js';

type OrchestratorDeps = {
  readonly db?: Queryable;
  readonly paymentProvider?: Pick<PaymentProvider, 'getStatus'>;
  readonly backendClient?: Pick<BackendGateway, 'walletCredit'>;
  readonly now?: () => number;
  readonly notifications?: Pick<NotificationService, 'sendPurchaseNotification'>;
};

function eventPayload(value: unknown): string {
  return JSON.stringify(value);
}

async function recordTransition(db: Queryable, session: PurchaseSession, toState: string, providerStatus: string | null, reason: string | null, now: number, payload: unknown): Promise<void> {
  await recordPurchaseEvent(db, { id: randomUUID(), sessionId: session.id, fromState: session.state, toState, providerStatus, reason, payloadJson: eventPayload(payload), createdAt: now });
}

function frozenCredits(session: PurchaseSession): number | null {
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(session.metadataJson) as Record<string, unknown>;
  } catch (error) {
    log.warn('purchase.metadata.unparseable', { sessionId: session.id, err: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
  const frozen = metadata['creditsAmount'];
  return typeof frozen === 'number' && Number.isFinite(frozen) && frozen > 0 ? Math.round(frozen) : null;
}

export function creditsForSession(session: PurchaseSession): number {
  return frozenCredits(session) ?? Math.round((session.amountBrlCents / 100) * config.CREDITS_PER_BRL);
}

async function grantReward(backendClient: Pick<BackendGateway, 'walletCredit'>, session: PurchaseSession): Promise<void> {
  await backendClient.walletCredit({
    userId: session.userId,
    amount: creditsForSession(session),
    idempotencyKey: `purchase:${session.id}:reward`,
    reason: `discord-purchase:${session.id}`,
  });
}

export async function processMercadoPagoPayment(paymentId: string, deps: OrchestratorDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const backendClient = deps.backendClient ?? createBackendClient();
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
    const moved = await updatePurchaseSessionState(db, session.id, decision.to, timestamp, session.state);
    if (!moved) {
      log.warn('purchase.transition.lost_race', { sessionId: session.id, from: session.state, to: decision.to });
      return;
    }
    await recordTransition(db, session, decision.to, decision.providerStatus, null, timestamp, status.raw);
    if (deps.notifications && (decision.to === 'failed' || decision.to === 'expired')) {
      await deps.notifications.sendPurchaseNotification({ discordId: session.discordId, kind: decision.to, sku: session.sku });
    }
  }
  if (decision.to !== 'paid') return;

  // Never mint currency on our own arithmetic alone. The provider is the authority on
  // what was actually charged; if its number disagrees with the session we booked, this
  // is a dispute for a human, not a delivery.
  if (status.paidAmountBrlCents !== null && status.paidAmountBrlCents !== session.amountBrlCents) {
    log.error('purchase.amount_mismatch', { sessionId: session.id, expectedCents: session.amountBrlCents, providerCents: status.paidAmountBrlCents });
    await updatePurchaseSessionState(db, session.id, 'disputed', timestamp, 'paid');
    await recordTransition(db, { ...session, state: 'paid' }, 'disputed', status.status, 'amount-mismatch', timestamp, status.raw);
    return;
  }

  const deliveringDecision = decideTransition('paid', 'delivering', status.status);
  if (deliveringDecision.kind !== 'accepted') return;
  const startedDelivering = await updatePurchaseSessionState(db, session.id, 'delivering', timestamp, 'paid');
  if (!startedDelivering) {
    log.warn('purchase.delivering.lost_race', { sessionId: session.id });
    return;
  }
  await recordTransition(db, { ...session, state: 'paid' }, 'delivering', status.status, null, timestamp, status.raw);
  await grantReward(backendClient, session);
  const deliveredAt = now();
  await markPurchaseDelivered(db, session.id, 'delivered', deliveredAt, 'delivering');
  await recordTransition(db, { ...session, state: 'delivering' }, 'delivered', status.status, null, deliveredAt, status.raw);
  if (deps.notifications) {
    await deps.notifications.sendPurchaseNotification({ discordId: session.discordId, kind: 'approved', sku: session.sku });
  }
}

export async function processMercadoPagoPaymentInTransaction(paymentId: string, deps: Pick<OrchestratorDeps, 'notifications'> = {}): Promise<void> {
  await tx(async (client) => processMercadoPagoPayment(paymentId, { db: client, ...deps }));
}
