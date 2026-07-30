import type { AuditLogEntry, Queryable } from './types.js';

type AuditRow = {
  readonly id: string;
  readonly actor_discord_id: string | null;
  readonly action: string;
  readonly target_id: string | null;
  readonly payload_json: string;
  readonly created_at: number;
};

const SQL_INSERT_AUDIT = `
  INSERT INTO audit_log (id, actor_discord_id, action, target_id, payload_json, created_at)
  VALUES ($1, $2, $3, $4, $5, $6)
`;
const SQL_SELECT_AUDIT = `SELECT * FROM audit_log WHERE id = $1`;

function toAudit(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    actorDiscordId: row.actor_discord_id,
    action: row.action,
    targetId: row.target_id,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

export async function insertAuditLog(db: Queryable, entry: AuditLogEntry): Promise<void> {
  await db.query(SQL_INSERT_AUDIT, [entry.id, entry.actorDiscordId, entry.action, entry.targetId, entry.payloadJson, entry.createdAt]);
}

export async function getAuditLog(db: Queryable, id: string): Promise<AuditLogEntry | null> {
  const result = await db.query<AuditRow>(SQL_SELECT_AUDIT, [id]);
  const row = result.rows[0];
  return row ? toAudit(row) : null;
}
