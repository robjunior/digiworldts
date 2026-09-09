/**
 * Dungeon repo stubs - dungeon feature removed, these are no-ops.
 */
import type { DungeonMoveResponse } from '@digiworld/shared/world';

export async function moveRun(
  dungeonId: string,
  playerId: string,
  move: unknown,
  correlationId: string,
): Promise<{ ok: boolean; result?: DungeonMoveResponse; error?: string }> {
  return {
    ok: true,
    result: {
      run: false,
      triggeredEncounterId: null,
      pickedUpItemId: null,
    } as DungeonMoveResponse,
  };
}
