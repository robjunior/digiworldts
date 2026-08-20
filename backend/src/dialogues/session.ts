import type { DialogueDefinition, DialogueNode } from '@digiworld/shared/dialogue';
import { DIALOGUE_END_NODE } from '@digiworld/shared/dialogue';

import { getCluster } from '../cluster/index.js';
import { log } from '../util/log.js';
import { partyLeadElement, partyRating } from '../world/engine.js';
import { getBalances } from '../wallet/repo.js';
import { getDialogue } from './repo.js';
import { applyEntryActions, evaluateCondition, visibleChoices, type DialogueRuntimeContext } from './runtime.js';
import { bumpTalkObjectives } from '../quests/repo.js';
import { emit } from '../telemetry/emit.js';

const CURSOR_TTL_SEC = 30 * 60;
const LOCK_TTL_SEC = 10;

const cursorKey = (userId: string): string => `dlg:cursor:${userId}`;
const lockKey = (userId: string): string => `dlg:lock:${userId}`;

type Cursor = { readonly dialogueId: string; readonly nodeId: string };

export type DialogueView = {
  readonly dialogueId: string;
  readonly nodeId: string;
  /**
   * Ids only. The client already holds the definition and renders from it;
   * letting it draw a hidden choice buys nothing, because advancing into one
   * is refused here.
   */
  readonly allowedChoiceIds: readonly string[];
  readonly done: boolean;
};

export type AdvanceFailure =
  | 'no-cursor'
  | 'wrong-dialogue'
  | 'unknown-dialogue'
  | 'unknown-node'
  | 'choice-not-available'
  | 'busy';

export type DialogueResult =
  | { readonly ok: true; readonly view: DialogueView }
  | { readonly ok: false; readonly error: AdvanceFailure };

async function buildContext(userId: string, displayName: string, dialogueId: string): Promise<DialogueRuntimeContext> {
  const [rating, balances, leadElement] = await Promise.all([
    partyRating(userId),
    getBalances(userId),
    partyLeadElement(userId),
  ]);
  return {
    userId,
    dialogueId,
    facts: {
      level: rating.meanLevel,
      ntc: balances.netcore,
      credits: balances.credits,
      party_lead_element: leadElement ?? '',
    },
    variables: { player_name: displayName },
  };
}

/** Follows jumps until one lands, so a @goto chain cannot be entered by the client. */
async function resolveNode(
  definition: DialogueDefinition,
  nodeId: string,
  ctx: DialogueRuntimeContext,
): Promise<DialogueNode | null> {
  const seen = new Set<string>();
  let current = nodeId;
  for (;;) {
    if (current === DIALOGUE_END_NODE || seen.has(current)) return null;
    seen.add(current);
    const node = definition.nodes[current];
    if (node === undefined) return null;
    let jumped: string | null = null;
    for (const jump of node.jumps) {
      if (jump.condition === null || (await evaluateCondition(jump.condition, ctx))) {
        jumped = jump.target;
        break;
      }
    }
    if (jumped === null) return node;
    current = jumped;
  }
}

async function enter(
  definition: DialogueDefinition,
  node: DialogueNode,
  ctx: DialogueRuntimeContext,
): Promise<DialogueView> {
  await applyEntryActions(node, ctx);
  if (node.speaker !== null) {
    await bumpTalkObjectives(ctx.userId, node.speaker.npcId);
    emit({
      event: 'dialogue.choice',
      userId: ctx.userId,
      distinctId: ctx.userId,
      props: {
        dialogue_id: definition.dialogueId,
        node_id: node.id,
        npc_id: node.speaker.npcId,
      },
    });
  }
  const choices = await visibleChoices(node, ctx);
  return {
    dialogueId: definition.dialogueId,
    nodeId: node.id,
    allowedChoiceIds: choices.map((choice) => choice.id),
    done: false,
  };
}

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | 'busy'> {
  const cluster = await getCluster();
  const token = await cluster.lock(lockKey(userId), LOCK_TTL_SEC);
  if (token === null) return 'busy';
  try {
    return await fn();
  } finally {
    await cluster.unlock(lockKey(userId), token);
  }
}

export async function startDialogue(
  userId: string,
  displayName: string,
  dialogueId: string,
): Promise<DialogueResult> {
  const outcome = await withUserLock(userId, async (): Promise<DialogueResult> => {
    const stored = await getDialogue(dialogueId);
    if (stored === null || stored.status !== 'published') return { ok: false, error: 'unknown-dialogue' };
    const ctx = await buildContext(userId, displayName, dialogueId);
    const node = await resolveNode(stored.definition, stored.definition.startNodeId, ctx);
    if (node === null) return { ok: false, error: 'unknown-node' };
    const view = await enter(stored.definition, node, ctx);
    const cluster = await getCluster();
    await cluster.set(cursorKey(userId), JSON.stringify({ dialogueId, nodeId: node.id }), CURSOR_TTL_SEC);
    log.info('dialogue.start', { userId, dialogueId, nodeId: node.id });
    return { ok: true, view };
  });
  return outcome === 'busy' ? { ok: false, error: 'busy' } : outcome;
}

export async function advanceDialogue(
  userId: string,
  displayName: string,
  dialogueId: string,
  choiceId: string,
): Promise<DialogueResult> {
  const outcome = await withUserLock(userId, async (): Promise<DialogueResult> => {
    const cluster = await getCluster();
    const raw = await cluster.get(cursorKey(userId));
    if (raw === null) return { ok: false, error: 'no-cursor' };
    const cursor = JSON.parse(raw) as Cursor;
    if (cursor.dialogueId !== dialogueId) return { ok: false, error: 'wrong-dialogue' };

    const stored = await getDialogue(dialogueId);
    if (stored === null) return { ok: false, error: 'unknown-dialogue' };
    const current = stored.definition.nodes[cursor.nodeId];
    if (current === undefined) return { ok: false, error: 'unknown-node' };

    const ctx = await buildContext(userId, displayName, dialogueId);
    const allowed = await visibleChoices(current, ctx);
    const choice = allowed.find((c) => c.id === choiceId);
    if (choice === undefined) return { ok: false, error: 'choice-not-available' };

    const next = await resolveNode(stored.definition, choice.target, ctx);
    if (next === null) {
      await cluster.del(cursorKey(userId));
      log.info('dialogue.end', { userId, dialogueId, from: cursor.nodeId, choiceId });
      return {
        ok: true,
        view: { dialogueId, nodeId: DIALOGUE_END_NODE, allowedChoiceIds: [], done: true },
      };
    }

    const view = await enter(stored.definition, next, ctx);
    await cluster.set(cursorKey(userId), JSON.stringify({ dialogueId, nodeId: next.id }), CURSOR_TTL_SEC);
    return { ok: true, view };
  });
  return outcome === 'busy' ? { ok: false, error: 'busy' } : outcome;
}

export async function abandonDialogue(userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(cursorKey(userId));
}
