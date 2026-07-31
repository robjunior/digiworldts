import { randomUUID } from 'node:crypto';

import { query } from '../db.js';
import { log } from '../logger.js';
import type { NotificationService } from '../notifications.js';
import { expirePurchaseSessions } from '../repo/purchases.js';
import type { Queryable } from '../repo/types.js';
import { recordPurchaseEvent } from './stateMachine.js';

type SweepDeps = {
  readonly db?: Queryable;
  readonly now?: () => number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly notifications?: Pick<NotificationService, 'sendPurchaseNotification'>;
};

export type PurchaseSweep = { readonly stop: () => void; readonly runOnce: () => Promise<number> };

export async function sweepExpiredPurchaseSessions(deps: Pick<SweepDeps, 'db' | 'now' | 'notifications'> = {}): Promise<number> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const timestamp = now();
  const expired = await expirePurchaseSessions(db, timestamp);
  for (const session of expired) {
    await recordPurchaseEvent(db, { id: randomUUID(), sessionId: session.id, fromState: session.state, toState: 'expired', providerStatus: null, reason: 'expired-session-sweep', payloadJson: '{}', createdAt: timestamp });
    if (deps.notifications) {
      await deps.notifications.sendPurchaseNotification({ discordId: session.discordId, kind: 'expired', sku: session.sku });
    }
  }
  return expired.length;
}

export function startPurchaseSweep(intervalMs: number, deps: SweepDeps = {}): PurchaseSweep {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const runOnce = async (): Promise<number> => sweepExpiredPurchaseSessions(deps);
  const timer = setIntervalFn(() => {
    void runOnce().catch((error: unknown) => {
      log.warn('purchase.sweep.failed', { err: error instanceof Error ? error.message : 'unknown error' });
    });
  }, intervalMs);
  return { stop: () => clearIntervalFn(timer), runOnce };
}
