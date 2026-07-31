import type { PurchaseEvent, PurchaseSession, Queryable } from './types.js';

type SessionRow = {
  readonly id: string;
  readonly user_id: string;
  readonly discord_id: string;
  readonly guild_id: string;
  readonly sku: string;
  readonly provider: string;
  readonly provider_payment_id: string | null;
  readonly state: string;
  readonly amount_brl_cents: number;
  readonly currency: string;
  readonly idempotency_key: string | null;
  readonly qr_code: string | null;
  readonly qr_code_base64: string | null;
  readonly ticket_url: string | null;
  readonly expires_at: number | null;
  readonly delivered_at: number | null;
  readonly metadata_json: string;
  readonly created_at: number;
  readonly updated_at: number;
};

type EventRow = {
  readonly id: string;
  readonly session_id: string | null;
  readonly from_state: string | null;
  readonly to_state: string;
  readonly provider_status: string | null;
  readonly reason: string | null;
  readonly payload_json: string;
  readonly created_at: number;
};

const SQL_INSERT_SESSION = `
  INSERT INTO purchase_sessions (id, user_id, discord_id, guild_id, sku, provider, provider_payment_id, state, amount_brl_cents, currency, idempotency_key, qr_code, qr_code_base64, ticket_url, expires_at, delivered_at, metadata_json, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
`;
const SQL_SELECT_SESSION = `SELECT * FROM purchase_sessions WHERE id = $1`;
const SQL_SELECT_SESSION_BY_PAYMENT = `SELECT * FROM purchase_sessions WHERE provider = $1 AND provider_payment_id = $2`;
const SQL_UPDATE_SESSION_STATE = `UPDATE purchase_sessions SET state = $2, updated_at = $3 WHERE id = $1`;
const SQL_UPDATE_PAYMENT = `UPDATE purchase_sessions SET provider_payment_id = $2, idempotency_key = $3, qr_code = $4, qr_code_base64 = $5, ticket_url = $6, expires_at = $7, state = $8, metadata_json = $9, updated_at = $10 WHERE id = $1`;
const SQL_UPDATE_DELIVERED = `UPDATE purchase_sessions SET state = $2, delivered_at = $3, updated_at = $3 WHERE id = $1`;
const SQL_EXPIRE_SESSIONS = `
  UPDATE purchase_sessions
  SET state = 'expired', updated_at = $1
  WHERE state IN ('pending', 'awaiting_payment') AND expires_at IS NOT NULL AND expires_at < $1
  RETURNING *
`;
const SQL_LIST_TERMINAL_PURCHASES = `
  SELECT id, sku, state, amount_brl_cents, created_at
  FROM purchase_sessions
  WHERE user_id = $1 AND state = ANY($2)
  ORDER BY created_at DESC
  LIMIT $3 OFFSET $4
`;
const SQL_COUNT_TERMINAL_PURCHASES = `
  SELECT COUNT(*)::int AS count
  FROM purchase_sessions
  WHERE user_id = $1 AND state = ANY($2)
`;
const SQL_INSERT_EVENT = `
  INSERT INTO purchase_events (id, session_id, from_state, to_state, provider_status, reason, payload_json, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;
const SQL_SELECT_EVENT = `SELECT * FROM purchase_events WHERE id = $1`;

function toSession(row: SessionRow): PurchaseSession {
  return {
    id: row.id,
    userId: row.user_id,
    discordId: row.discord_id,
    guildId: row.guild_id,
    sku: row.sku,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    state: row.state,
    amountBrlCents: row.amount_brl_cents,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    qrCode: row.qr_code,
    qrCodeBase64: row.qr_code_base64,
    ticketUrl: row.ticket_url,
    expiresAt: row.expires_at,
    deliveredAt: row.delivered_at,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): PurchaseEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    fromState: row.from_state,
    toState: row.to_state,
    providerStatus: row.provider_status,
    reason: row.reason,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

export async function insertPurchaseSession(db: Queryable, session: PurchaseSession): Promise<void> {
  await db.query(SQL_INSERT_SESSION, [session.id, session.userId, session.discordId, session.guildId, session.sku, session.provider, session.providerPaymentId, session.state, session.amountBrlCents, session.currency, session.idempotencyKey, session.qrCode, session.qrCodeBase64, session.ticketUrl, session.expiresAt, session.deliveredAt, session.metadataJson, session.createdAt, session.updatedAt]);
}

export async function getPurchaseSession(db: Queryable, id: string): Promise<PurchaseSession | null> {
  const result = await db.query<SessionRow>(SQL_SELECT_SESSION, [id]);
  const row = result.rows[0];
  return row ? toSession(row) : null;
}

export async function getPurchaseSessionByProviderPayment(db: Queryable, provider: string, providerPaymentId: string): Promise<PurchaseSession | null> {
  const result = await db.query<SessionRow>(SQL_SELECT_SESSION_BY_PAYMENT, [provider, providerPaymentId]);
  const row = result.rows[0];
  return row ? toSession(row) : null;
}

export async function updatePurchaseSessionState(db: Queryable, id: string, state: string, now: number): Promise<void> {
  await db.query(SQL_UPDATE_SESSION_STATE, [id, state, now]);
}

export async function updatePurchaseSessionPayment(db: Queryable, session: Pick<PurchaseSession, 'id' | 'providerPaymentId' | 'idempotencyKey' | 'qrCode' | 'qrCodeBase64' | 'ticketUrl' | 'expiresAt' | 'state' | 'metadataJson' | 'updatedAt'>): Promise<void> {
  await db.query(SQL_UPDATE_PAYMENT, [session.id, session.providerPaymentId, session.idempotencyKey, session.qrCode, session.qrCodeBase64, session.ticketUrl, session.expiresAt, session.state, session.metadataJson, session.updatedAt]);
}

export async function markPurchaseDelivered(db: Queryable, id: string, state: string, now: number): Promise<void> {
  await db.query(SQL_UPDATE_DELIVERED, [id, state, now]);
}

export async function expirePurchaseSessions(db: Queryable, now: number): Promise<readonly PurchaseSession[]> {
  const result = await db.query<SessionRow>(SQL_EXPIRE_SESSIONS, [now]);
  return result.rows.map(toSession);
}

export type PurchaseListRow = {
  readonly id: string;
  readonly sku: string;
  readonly state: string;
  readonly amountBrlCents: number;
  readonly createdAt: number;
};

export async function listTerminalPurchases(db: Queryable, input: { readonly userId: string; readonly states: readonly string[]; readonly limit: number; readonly offset: number }): Promise<readonly PurchaseListRow[]> {
  const result = await db.query<{ readonly id: string; readonly sku: string; readonly state: string; readonly amount_brl_cents: number; readonly created_at: number }>(
    SQL_LIST_TERMINAL_PURCHASES,
    [input.userId, input.states, input.limit, input.offset],
  );
  return result.rows.map((row) => ({ id: row.id, sku: row.sku, state: row.state, amountBrlCents: row.amount_brl_cents, createdAt: row.created_at }));
}

export async function countTerminalPurchases(db: Queryable, input: { readonly userId: string; readonly states: readonly string[] }): Promise<number> {
  const result = await db.query<{ readonly count: number }>(SQL_COUNT_TERMINAL_PURCHASES, [input.userId, input.states]);
  return Number(result.rows[0]?.count ?? 0);
}

export async function insertPurchaseEvent(db: Queryable, event: PurchaseEvent): Promise<void> {
  await db.query(SQL_INSERT_EVENT, [event.id, event.sessionId, event.fromState, event.toState, event.providerStatus, event.reason, event.payloadJson, event.createdAt]);
}

export async function getPurchaseEvent(db: Queryable, id: string): Promise<PurchaseEvent | null> {
  const result = await db.query<EventRow>(SQL_SELECT_EVENT, [id]);
  const row = result.rows[0];
  return row ? toEvent(row) : null;
}
