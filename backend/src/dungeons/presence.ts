/**
 * Dungeon presence stubs - dungeon feature removed, these are no-ops.
 */

export const CHAN_PREFIX = 'dungeon:scope';
export const CHAN_PATTERN = 'dungeon:*';
export function dungeonPresenceScope(userId: string): string {
  return `dungeon:${userId}`;
}

export function dungeonPresenceSnapshot(): Set<string> {
  return new Set<string>();
}

export function publishDungeonPayload(channel: string, payload: object): void {
  // No-op
}

export function refreshDungeonPresence(userId: string): void {
  // No-op
}

export function removeDungeonPresence(userId: string): void {
  // No-op
}

export function setDungeonPresence(userId: string, presence: unknown): void {
  // No-op
}

export function announceDungeonMove(correlationId: string, message: string): void {
  // No-op
}