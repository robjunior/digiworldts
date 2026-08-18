/**
 * Dungeon presence — cluster-scoped "who is in which dungeon and where".
 *
 * Keys:   `dungeon:presence:{dungeonId}:{userId}` → KV JSON (15s TTL,
 *         refreshed by WS ping heartbeat and by every server-validated move).
 * Chan:   `dungeon:chan:{dungeonId}` → pub/sub fanout for position deltas
 *         (`dungeon:player-update` / `dungeon:player-left`). One subscription
 *         per node (`psubscribe dungeon:chan:*`), fanout to local sockets
 *         currently joined to that dungeon.
 *
 * Presence is display-only: positions enter the store from `dungeon:join`
 * (client-provided initial cell) and from the authoritative move endpoint.
 * Nothing here feeds game rules.
 */
import { getCluster } from '../cluster/index.js';
import { listBlockedUserIds } from '../social/friends.js';
import { getDungeon } from './repo.js';

const PREFIX = 'dungeon:presence:';
export const CHAN_PREFIX = 'dungeon:chan:';
export const CHAN_PATTERN = `${CHAN_PREFIX}*`;
// The client WS ping runs every 25s — the TTL must outlive two missed pings
// or idle players would ghost out between heartbeats.
const TTL_SEC = 60;

export type DungeonPresencePlayer = {
  readonly userId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly leaderCatalogId?: string;
};

const presenceKey = (dungeonId: string, userId: string): string => `${PREFIX}${dungeonId}:${userId}`;

export async function setDungeonPresence(dungeonId: string, player: DungeonPresencePlayer): Promise<void> {
  const cluster = await getCluster();
  await cluster.set(presenceKey(dungeonId, player.userId), JSON.stringify(player), TTL_SEC);
}

export async function removeDungeonPresence(dungeonId: string, userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(presenceKey(dungeonId, userId));
}

export async function dungeonPresenceSnapshot(dungeonId: string): Promise<DungeonPresencePlayer[]> {
  const cluster = await getCluster();
  const keys = await cluster.keys(`${PREFIX}${dungeonId}:*`);
  const raws = await Promise.all(keys.map((key) => cluster.get(key)));
  const players: DungeonPresencePlayer[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try { players.push(JSON.parse(raw) as DungeonPresencePlayer); } catch { /* skip corrupt entry */ }
  }
  return players;
}

export async function publishDungeonPayload(dungeonId: string, payload: unknown): Promise<void> {
  const cluster = await getCluster();
  await cluster.publish(`${CHAN_PREFIX}${dungeonId}`, JSON.stringify(payload));
}

/**
 * Called by the move endpoint after a server-validated move. Refreshes the
 * mover's presence TTL (only when a join already registered it — movers
 * without a live socket must not materialize in the snapshot) and fans out
 * the new cell. A warp removes the mover from this dungeon instead; the
 * frontend announces the re-entry in the target dungeon via `dungeon:join`.
 */
export async function announceDungeonMove(
  userId: string,
  displayName: string,
  dungeonId: string,
  x: number,
  y: number,
  warpToDungeonId: string | null,
): Promise<void> {
  if (warpToDungeonId !== null) {
    await removeDungeonPresence(dungeonId, userId);
    await publishDungeonPayload(dungeonId, { type: 'dungeon:player-left', dungeonId, userId });
    return;
  }
  const cluster = await getCluster();
  if ((await cluster.get(presenceKey(dungeonId, userId))) !== null) {
    await cluster.expire(presenceKey(dungeonId, userId), TTL_SEC);
  }
  const dungeon = await getDungeon(dungeonId);
  await publishDungeonPayload(dungeonId, {
    type: 'dungeon:player-update',
    dungeonId,
    player: {
      userId,
      displayName,
      x,
      y,
      gridX: dungeon?.gridX ?? 0,
      gridY: dungeon?.gridY ?? 0,
    },
    blockedBy: await listBlockedUserIds(userId),
  });
}
