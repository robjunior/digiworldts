/**
 * Dungeon presence — cluster-scoped "who is in which dungeon and where".
 *
 * Scope: the dungeon GROUP when the dungeon belongs to one (the composed
 * world renders every map of the group, so a player crossing into a neighbor
 * map must stay visible) — the dungeon id itself otherwise.
 *
 * Keys:   `dungeon:presence:{scope}:{userId}` → KV JSON (60s TTL, refreshed
 *         by WS ping heartbeat and by every server-validated move).
 * Chan:   `dungeon:chan:{scope}` → pub/sub fanout for position deltas
 *         (`dungeon:player-update` / `dungeon:player-left`). One subscription
 *         per node (`psubscribe dungeon:chan:*`), fanout to local sockets
 *         currently joined to that scope.
 *
 * Presence is display-only: positions enter the store from `dungeon:join`
 * (client-provided initial cell + party) and from the authoritative move
 * endpoint. Nothing here feeds game rules.
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
  readonly dungeonId: string;
  readonly leaderCatalogId?: string;
  readonly party?: readonly string[];
  readonly trail?: readonly { readonly x: number; readonly y: number }[];
};

/** Presence scope for a dungeon: the group when grouped, the dungeon id otherwise. */
export async function dungeonPresenceScope(dungeonId: string): Promise<string | null> {
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) return null;
  return dungeon.dungeonGroupId !== null ? `group:${dungeon.dungeonGroupId}` : `dungeon:${dungeon.id}`;
}

const presenceKey = (scope: string, userId: string): string => `${PREFIX}${scope}:${userId}`;
const channel = (scope: string): string => `${CHAN_PREFIX}${scope}`;

export async function setDungeonPresence(scope: string, player: DungeonPresencePlayer): Promise<void> {
  const cluster = await getCluster();
  await cluster.set(presenceKey(scope, player.userId), JSON.stringify(player), TTL_SEC);
}

export async function removeDungeonPresence(scope: string, userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(presenceKey(scope, userId));
}

export async function refreshDungeonPresence(scope: string, userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.expire(presenceKey(scope, userId), TTL_SEC);
}

export async function dungeonPresenceSnapshot(scope: string): Promise<DungeonPresencePlayer[]> {
  const cluster = await getCluster();
  const keys = await cluster.keys(`${PREFIX}${scope}:*`);
  const raws = await Promise.all(keys.map((key) => cluster.get(key)));
  const players: DungeonPresencePlayer[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try { players.push(JSON.parse(raw) as DungeonPresencePlayer); } catch { /* skip corrupt entry */ }
  }
  return players;
}

export async function publishDungeonPayload(scope: string, payload: unknown): Promise<void> {
  const cluster = await getCluster();
  await cluster.publish(channel(scope), JSON.stringify(payload));
}

/**
 * Called by the move endpoint after a server-validated move. Refreshes the
 * mover's presence TTL (only when a join already registered it — movers
 * without a live socket must not materialize in the snapshot) and fans out
 * the new cell. A warp into a neighbor map of the same group keeps the
 * entry (same scope) and re-announces with the target dungeon's coordinates
 * so the mover stays visible across the composed world.
 */
export async function announceDungeonMove(
  userId: string,
  displayName: string,
  dungeonId: string,
  x: number,
  y: number,
  warpToDungeonId: string | null,
  party: readonly string[],
  trail: readonly { readonly x: number; readonly y: number }[],
): Promise<void> {
  const targetId = warpToDungeonId ?? dungeonId;
  const scope = await dungeonPresenceScope(targetId);
  if (scope === null) return;
  const target = await getDungeon(targetId);
  const player: DungeonPresencePlayer = {
    userId,
    displayName,
    x,
    y,
    gridX: target?.gridX ?? 0,
    gridY: target?.gridY ?? 0,
    dungeonId: targetId,
    party,
    // Contract: trail[0] is the leader's own cell (trail[i] ↔ party[i]).
    // The client sends the trail as of the previous render (the cell the
    // leader is leaving), so prepend the authoritative new cell here —
    // otherwise receivers render the fileira one cell too far behind.
    trail: [{ x, y }, ...trail].slice(0, 3),
  };
  // Snapshots read the KV, so a move must refresh the store entry too — but
  // only when a join registered it (movers without a live socket must not
  // materialize).
  const cluster = await getCluster();
  if ((await cluster.get(presenceKey(scope, userId))) !== null) {
    await setDungeonPresence(scope, player);
  }
  await publishDungeonPayload(scope, {
    type: 'dungeon:player-update',
    dungeonId: targetId,
    player,
    blockedBy: await listBlockedUserIds(userId),
  });
}
