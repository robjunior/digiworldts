/**
 * Dungeon presence stubs - dungeon feature removed, these are no-ops.
 */

export const CHAN_PREFIX = 'dungeon:scope';
export const CHAN_PATTERN = 'dungeon:*';
export function dungeonPresenceScope(dungeonId: string): string | null {
  return dungeonId ? `${CHAN_PREFIX}:${dungeonId}` : null;
}
export function dungeonPresenceSnapshot(): Set<string> {
  return new Set<string>();
}
export function publishDungeonPayload(scope: string, _payload: unknown): void {}
export function refreshDungeonPresence(_scope: string, _userId: string): void {}
export function removeDungeonPresence(_scope: string, _userId: string): void {}
export function setDungeonPresence(_scope: string, _player: unknown): void {}
export function announceDungeonMove(_userId: string, _displayName: string, _dungeonId: string, _x: number, _y: number, _warpToDungeonId: string | null, _party: unknown[], _trail: unknown[]): void {}
