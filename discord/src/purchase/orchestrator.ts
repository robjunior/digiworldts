import { randomUUID } from 'node:crypto';

import type { BackendGateway } from '../backendClient.js';
import { createBackendClient } from '../backendClient.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { log } from '../logger.js';
import { getPurchaseSessionByProviderPayment, markPurchaseDelivered, updatePurchaseSessionState } from '../repo/purchases.js';
import { addCreditDebt } from '../repo/debt.js';
import type { PurchaseSession, Queryable } from '../repo/types.js';
import { createMercadoPagoProvider, MercadoPagoHttpError } from '../payments/mercadopago.js';
import type { PaymentProvider, PaymentStatus } from '../payments/types.js';
import type { NotificationService } from '../notifications.js';
import { decideMercadoPagoTransition, decideTransition, isMercadoPagoStatus, isPurchaseState, recordPurchaseEvent } from './stateMachine.js';

type OrchestratorDeps = {
  readonly db?: Queryable;
  readonly paymentProvider?: Pick<PaymentProvider, 'getStatus'>;
  readonly backendClient?: Pick<BackendGateway, 'walletCredit' | 'walletDebit'>;
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

// A chargeback is forced on us: the bank pulls the money regardless of policy. Take back
// whatever credits are still there, and park the rest as debt, since player_wallet's
// CHECK (credits >= 0) means the wallet itself cannot carry a negative balance.
async function clawbackAfterChargeback(db: Queryable, backendClient: Pick<BackendGateway, 'walletDebit'>, session: PurchaseSession, now: number): Promise<void> {
  const owed = creditsForSession(session);
  try {
    const debit = await backendClient.walletDebit({
      userId: session.userId,
      amount: owed,
      idempotencyKey: `purchase:${session.id}:chargeback`,
      reason: `discord-chargeback:${session.id}`,
    });
    if (debit.shortfall > 0) {
      await addCreditDebt(db, { userId: session.userId, amount: debit.shortfall, reason: `chargeback:${session.id}`, purchaseSessionId: session.id, now });
      log.warn('purchase.chargeback.debt_recorded', { sessionId: session.id, userId: session.userId, shortfall: debit.shortfall });
    }
  } catch (error) {
    await addCreditDebt(db, { userId: session.userId, amount: owed, reason: `chargeback-clawback-failed:${session.id}`, purchaseSessionId: session.id, now });
    log.error('purchase.chargeback.clawback_failed', { sessionId: session.id, err: error instanceof Error ? error.message : 'unknown' });
  }
}

export async function processMercadoPagoPayment(paymentId: string, deps: OrchestratorDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const backendClient = deps.backendClient ?? createBackendClient();
  const now = deps.now ?? Date.now;

  // The webhook turns a throw into a 500 so MercadoPago retries. An order the provider
  // does not know is not a transient fault — retrying it forever accomplishes nothing,
  // so it is swallowed here and only real failures are allowed to propagate.
  let status: PaymentStatus;
  try {
    status = await paymentProvider.getStatus(paymentId);
  } catch (error) {
    if (error instanceof MercadoPagoHttpError && error.status === 404) {
      log.warn('purchase.provider.unknown_order', { paymentId });
      return;
    }
    throw error;
  }

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
    if (decision.to === 'chargeback' && session.state === 'delivered') {
      await clawbackAfterChargeback(db, backendClient, session, timestamp);
    }
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
