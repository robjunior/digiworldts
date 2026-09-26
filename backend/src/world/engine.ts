/**
 * World engine stubs - dungeon/world feature removed, these are no-ops.
 */

export async function partyLeadElement(userId: string): Promise<string | null> {
  return null;
}

export async function partyRating(userId: string): Promise<{ meanLevel: number }> {
  return { meanLevel: 1 };
}

export async function teleportPlayer(userId: string, x: number, y: number, ex?: unknown): Promise<void> {
  // No-op - dungeon world teleport removed
}