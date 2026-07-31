import type { Queryable, Ticket } from './types.js';

type TicketRow = {
  readonly id: string;
  readonly user_id: string | null;
  readonly discord_id: string | null;
  readonly guild_id: string | null;
  readonly channel_id: string | null;
  readonly last_purchase_session_id: string | null;
  readonly status: string;
  readonly transcript: string | null;
  readonly opened_at: number;
  readonly closed_at: number | null;
  readonly last_activity_at: number;
};

const SQL_INSERT_TICKET = `
  INSERT INTO tickets (id, user_id, discord_id, guild_id, channel_id, last_purchase_session_id, status, transcript, opened_at, closed_at, last_activity_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;
const SQL_SELECT_TICKET = `SELECT * FROM tickets WHERE id = $1`;
const SQL_UPDATE_TICKET_STATUS = `UPDATE tickets SET status = $2, closed_at = $3, last_activity_at = $3 WHERE id = $1`;

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    userId: row.user_id,
    discordId: row.discord_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    lastPurchaseSessionId: row.last_purchase_session_id,
    status: row.status,
    transcript: row.transcript,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    lastActivityAt: row.last_activity_at,
  };
}

export async function insertTicket(db: Queryable, ticket: Ticket): Promise<void> {
  await db.query(SQL_INSERT_TICKET, [ticket.id, ticket.userId, ticket.discordId, ticket.guildId, ticket.channelId, ticket.lastPurchaseSessionId, ticket.status, ticket.transcript, ticket.openedAt, ticket.closedAt, ticket.lastActivityAt]);
}

export async function getTicket(db: Queryable, id: string): Promise<Ticket | null> {
  const result = await db.query<TicketRow>(SQL_SELECT_TICKET, [id]);
  const row = result.rows[0];
  return row ? toTicket(row) : null;
}

export async function closeTicket(db: Queryable, id: string, closedAt: number): Promise<void> {
  await db.query(SQL_UPDATE_TICKET_STATUS, [id, 'closed', closedAt]);
}
