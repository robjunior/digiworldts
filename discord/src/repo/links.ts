import type { DiscordLink, DiscordLinkState, Queryable } from './types.js';

type LinkRow = {
  readonly discord_id: string;
  readonly user_id: string | null;
  readonly state: DiscordLinkState;
  readonly oauth_state: string | null;
  readonly access_token: string | null;
  readonly refresh_token: string | null;
  readonly token_expires_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
};

type LinkedTokenInput = {
  readonly discordId: string;
  readonly userId: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: number | null;
  readonly now: number;
};

const SQL_SELECT_BY_DISCORD = `SELECT * FROM discord_links WHERE discord_id = $1`;
const SQL_MARK_LINKED = `
  INSERT INTO discord_links (discord_id, user_id, state, oauth_state, access_token, refresh_token, token_expires_at, created_at, updated_at)
  VALUES ($1, $2, 'linked', NULL, $3, $4, $5, $6, $6)
  ON CONFLICT (discord_id) DO UPDATE SET
    user_id = excluded.user_id,
    state = 'linked',
    oauth_state = NULL,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    token_expires_at = excluded.token_expires_at,
    updated_at = excluded.updated_at
`;
const SQL_MARK_UNLINKED = `
  UPDATE discord_links
     SET state = 'unlinked', oauth_state = NULL, access_token = NULL, refresh_token = NULL, token_expires_at = NULL, updated_at = $2
   WHERE discord_id = $1
`;

function toDiscordLink(row: LinkRow): DiscordLink {
  return {
    discordId: row.discord_id,
    userId: row.user_id,
    state: row.state,
    oauthState: row.oauth_state,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLinkByDiscordId(db: Queryable, discordId: string): Promise<DiscordLink | null> {
  const result = await db.query<LinkRow>(SQL_SELECT_BY_DISCORD, [discordId]);
  const row = result.rows[0];
  return row ? toDiscordLink(row) : null;
}

export async function markLinkLinked(db: Queryable, input: LinkedTokenInput): Promise<void> {
  await db.query(SQL_MARK_LINKED, [input.discordId, input.userId, input.accessToken, input.refreshToken, input.tokenExpiresAt, input.now]);
}

export async function markLinkUnlinked(db: Queryable, discordId: string, now: number): Promise<void> {
  await db.query(SQL_MARK_UNLINKED, [discordId, now]);
}
