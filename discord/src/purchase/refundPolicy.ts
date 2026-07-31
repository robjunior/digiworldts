export type RefundTier =
  | { readonly kind: 'not_delivered' }
  | { readonly kind: 'full'; readonly clawbackCredits: number; readonly refundBrlCents: number }
  | { readonly kind: 'partial'; readonly clawbackCredits: number; readonly refundBrlCents: number }
  | { readonly kind: 'consumed' };

export type RefundDecisionInput = {
  readonly sessionState: string;
  readonly grantedCredits: number;
  readonly currentBalance: number;
  readonly amountBrlCents: number;
};

const DELIVERED_STATES = new Set(['delivered', 'delivering']);

export const REGRET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Brazilian CDC art. 49 gives a 7-day right of regret on online purchases. This only
 * reports whether the purchase is inside that window; it deliberately does not gate
 * the refund, because an operator may always choose to refund outside it.
 */
export function withinRegretWindow(createdAt: number, now: number): boolean {
  return now - createdAt <= REGRET_WINDOW_MS;
}

/**
 * Credits are a single fungible balance, so there is no way to prove which specific
 * credits were spent. This assumes the conservative reading — purchased credits are
 * consumed before earned ones — which shrinks refund liability rather than inflating it.
 */
export function decideRefundTier(input: RefundDecisionInput): RefundTier {
  if (!DELIVERED_STATES.has(input.sessionState)) return { kind: 'not_delivered' };
  if (input.grantedCredits <= 0) return { kind: 'not_delivered' };
  if (input.currentBalance >= input.grantedCredits) {
    return { kind: 'full', clawbackCredits: input.grantedCredits, refundBrlCents: input.amountBrlCents };
  }
  if (input.currentBalance <= 0) return { kind: 'consumed' };
  const clawbackCredits = input.currentBalance;
  const refundBrlCents = Math.round((input.amountBrlCents * clawbackCredits) / input.grantedCredits);
  return { kind: 'partial', clawbackCredits, refundBrlCents };
}
