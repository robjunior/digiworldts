import type { Queryable, WebhookEvent } from './types.js';

type WebhookRow = {
  readonly provider: string;
  readonly provider_event_id: string;
  readonly event_type: string | null;
  readonly payload_json: string;
  readonly processed_at: number;
};

const SQL_INSERT_WEBHOOK = `
  INSERT INTO webhook_events (provider, provider_event_id, event_type, payload_json, processed_at)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING provider_event_id
`;
const SQL_SELECT_WEBHOOK = `SELECT * FROM webhook_events WHERE provider = $1 AND provider_event_id = $2`;

function toWebhook(row: WebhookRow): WebhookEvent {
  return {
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    payloadJson: row.payload_json,
    processedAt: row.processed_at,
  };
}

export async function insertWebhookEvent(db: Queryable, event: WebhookEvent): Promise<boolean> {
  const result = await db.query(SQL_INSERT_WEBHOOK, [event.provider, event.providerEventId, event.eventType, event.payloadJson, event.processedAt]);
  return result.rows.length === 1;
}

export async function getWebhookEvent(db: Queryable, provider: string, providerEventId: string): Promise<WebhookEvent | null> {
  const result = await db.query<WebhookRow>(SQL_SELECT_WEBHOOK, [provider, providerEventId]);
  const row = result.rows[0];
  return row ? toWebhook(row) : null;
}
