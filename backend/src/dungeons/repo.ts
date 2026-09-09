/**
 * Dungeon repo stubs - dungeon feature removed, these are no-ops.
 */
import type { DungeonMoveResponse } from '@digiworld/shared/world';

export async function moveRun(
  _userId: string,
  _dungeonId: string,
  _x: number,
  _y: number,
): Promise<{ ok: boolean; kind: 'ok'; run: boolean }> {
  return { ok: true, kind: 'ok', run: true };
}
