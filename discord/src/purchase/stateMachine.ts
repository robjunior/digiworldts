import type { PurchaseEvent, Queryable } from '../repo/types.js';

export const PURCHASE_STATES = ['pending', 'awaiting_payment', 'paid', 'delivering', 'delivered', 'failed', 'cancelled', 'expired', 'refunded', 'disputed', 'chargeback'] as const;
export type PurchaseState = (typeof PURCHASE_STATES)[number];

export const MERCADOPAGO_STATUSES = ['pending', 'in_process', 'pending_waiting_transfer', 'approved', 'rejected', 'cancelled', 'refunded', 'in_mediation', 'charged_back'] as const;
export type MercadoPagoStatus = (typeof MERCADOPAGO_STATUSES)[number];

const STATUS_STATE: Record<MercadoPagoStatus, PurchaseState> = {
  pending: 'awaiting_payment',
  in_process: 'awaiting_payment',
  pending_waiting_transfer: 'awaiting_payment',
  approved: 'paid',
  rejected: 'failed',
  cancelled: 'cancelled',
  refunded: 'refunded',
  in_mediation: 'disputed',
  charged_back: 'chargeback',
} as const;

export const TRANSITIONS: Record<PurchaseState, readonly PurchaseState[]> = {
  pending: ['awaiting_payment', 'expired', 'failed', 'cancelled'],
  awaiting_payment: ['paid', 'expired', 'failed', 'cancelled', 'disputed', 'chargeback', 'refunded'],
  paid: ['delivering', 'refunded', 'disputed', 'chargeback'],
  delivering: ['delivered', 'failed'],
  delivered: ['refunded', 'chargeback'],
  failed: [],
  cancelled: [],
  expired: [],
  refunded: [],
  disputed: ['paid', 'refunded', 'chargeback'],
  chargeback: [],
} as const;

export type TransitionDecision =
  | { readonly kind: 'accepted'; readonly from: PurchaseState; readonly to: PurchaseState; readonly providerStatus: MercadoPagoStatus | null }
  | { readonly kind: 'noop'; readonly from: PurchaseState; readonly to: PurchaseState; readonly providerStatus: MercadoPagoStatus | null }
  | { readonly kind: 'rejected'; readonly from: PurchaseState; readonly to: PurchaseState; readonly providerStatus: MercadoPagoStatus | null; readonly reason: string };

export function isPurchaseState(value: string): value is PurchaseState {
  return PURCHASE_STATES.includes(value as PurchaseState);
}

export function isMercadoPagoStatus(value: string): value is MercadoPagoStatus {
  return MERCADOPAGO_STATUSES.includes(value as MercadoPagoStatus);
}

export function commerceStateForMercadoPagoStatus(status: MercadoPagoStatus): PurchaseState {
  return STATUS_STATE[status];
}

export function decideTransition(current: PurchaseState, next: PurchaseState, providerStatus: MercadoPagoStatus | null = null): TransitionDecision {
  if (current === next) return { kind: 'noop', from: current, to: next, providerStatus };
  return TRANSITIONS[current].includes(next)
    ? { kind: 'accepted', from: current, to: next, providerStatus }
    : { kind: 'rejected', from: current, to: next, providerStatus, reason: `invalid-transition:${current}->${next}` };
}

export function decideMercadoPagoTransition(current: PurchaseState, status: MercadoPagoStatus): TransitionDecision {
  return decideTransition(current, commerceStateForMercadoPagoStatus(status), status);
}

export async function recordPurchaseEvent(db: Queryable, event: PurchaseEvent): Promise<void> {
  await db.query(
    'INSERT INTO purchase_events (id, session_id, from_state, to_state, provider_status, reason, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [event.id, event.sessionId, event.fromState, event.toState, event.providerStatus, event.reason, event.payloadJson, event.createdAt],
  );
}
