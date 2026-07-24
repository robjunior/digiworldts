/**
 * Spectator registry — one ZSET per active match tracking who's watching.
 *
 * Storage:
 *   battle:spectators:{matchId}  → ZSET (member=userId, score=joinedAt),
 *                                  TTL 30 min (same as battle snapshot)
 *
 * Max MAX_SPECTATORS_PER_MATCH viewers per match — the ZSET check + zadd is
 * NOT atomic under the current cluster interface, so on rare bursts we may
 * accept one or two above the cap. That's acceptable at N=20 with per-match
 * fanout costs; if the cap gets tighter we'd need a Lua CAS on Redis.
 *
 * Players in the match cannot register as spectators — they get their side's
 * view via the normal wsdeliver:{userId} channel. The `joinSpectate` guard
 * silently accepts a player-as-spectator call as a no-op so the WS handler
 * doesn't need to know the player identity ahead of time.
 */
import { getCluster } from '../cluster/index.js';

const MAX_SPECTATORS_PER_MATCH = 20;
const SPECTATOR_TTL_SEC = 30 * 60;

const K_SPECTATORS = (matchId: string): string => `battle:spectators:${matchId}`;
const K_BATTLE_SNAP = (matchId: string): string => `battle:snap:${matchId}`;

export type JoinResult =
  | { ok: true; status: 'joined' | 'already-in-match'; count: number }
  | { ok: false; error: 'full' | 'not-found' };

export async function joinSpectate(matchId: string, userId: string): Promise<JoinResult> {
  const cluster = await getCluster();

  const rawSnap = await cluster.get(K_BATTLE_SNAP(matchId));
  if (!rawSnap) return { ok: false, error: 'not-found' };

  let snap: { playerA: string; playerB: string };
  try {
    snap = JSON.parse(rawSnap) as { playerA: string; playerB: string };
  } catch {
    return { ok: false, error: 'not-found' };
  }

  if (snap.playerA === userId || snap.playerB === userId) {
    return { ok: true, status: 'already-in-match', count: 0 };
  }

  const existing = await cluster.zrange(K_SPECTATORS(matchId), 0, -1);
  const isAlready = existing.some((e) => e.member === userId);
  if (!isAlready && existing.length >= MAX_SPECTATORS_PER_MATCH) {
    return { ok: false, error: 'full' };
  }
  await cluster.zadd(K_SPECTATORS(matchId), Date.now(), userId);
  await cluster.expire(K_SPECTATORS(matchId), SPECTATOR_TTL_SEC);
  return { ok: true, status: 'joined', count: isAlready ? existing.length : existing.length + 1 };
}

export async function leaveSpectate(matchId: string, userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.zrem(K_SPECTATORS(matchId), userId);
}

export async function listSpectators(matchId: string): Promise<string[]> {
  const cluster = await getCluster();
  const rows = await cluster.zrange(K_SPECTATORS(matchId), 0, -1);
  return rows.map((r) => r.member);
}

export async function spectatorCount(matchId: string): Promise<number> {
  const cluster = await getCluster();
  return cluster.zcard(K_SPECTATORS(matchId));
}

export async function clearSpectators(matchId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(K_SPECTATORS(matchId));
}

export { MAX_SPECTATORS_PER_MATCH };
