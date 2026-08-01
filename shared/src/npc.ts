/**
 * NPC registry.
 *
 * A dialogue passage points at a speaker via `speaker.npcId` + `speaker.expression`.
 * Before this registry those were free strings, so a typo or a missing portrait
 * failed silently at play time (the dialogue rendered "elder2" as the speaker
 * label and 404'd on the portrait). The registry gives us:
 *
 *   1. A concrete list of legal NPC ids the dialogue importer cross-checks.
 *   2. A per-NPC list of legal expression keys so `@speaker elder confuzzled`
 *      is refused at import instead of rendering with no portrait.
 *   3. A display name the player UI shows instead of the raw id.
 *
 * Portraits live at `public/assets/npc/{id}/{expression}.png` and are served
 * as static files at `/assets/npc/{id}/{expression}.png`. `hasPortrait` on
 * NpcExpression is computed at fetch time from the filesystem, not stored,
 * so uploading/removing a portrait file doesn't require a DB update.
 */

export type NpcExpression = {
  readonly key: string;
  readonly label?: string;
  readonly hasPortrait: boolean;
};

export type Npc = {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly NpcExpression[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export const NPC_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const NPC_EXPRESSION_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const NPC_DEFAULT_EXPRESSION = 'neutral' as const;
