import type {
  Quest,
  QuestObjective,
  QuestObjectiveProgress,
  QuestWithProgress,
  UserQuestProgress,
  UserQuestState,
  WorldObject,
  WorldObjectAdjacent,
} from '@digiworld/shared/quest';
import type { Biome } from '@digiworld/shared/world';
import type { Element } from '@digiworld/shared/digimon';
import type { DbExecutor } from '../db/executor.js';
import { one, q, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';

type QuestRow = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly name_pt: string | null;
  readonly description_pt: string | null;
  readonly required_level: number;
  readonly data: string | Quest;
  readonly created_at: number;
  readonly updated_at: number;
};

type WorldObjectRow = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly lat: number;
  readonly lon: number;
  readonly kind: WorldObject['kind'];
  readonly scale: number;
  readonly tint: string | null;
  readonly quest_id: string | null;
  readonly dungeon_id: string | null;
  readonly passable: 0 | 1;
  readonly label: string | null;
  readonly elements: string | null;
  readonly min_level: number | null;
  readonly max_level: number | null;
  readonly created_at: number;
  readonly updated_at: number;
};

type ProgressRow = {
  readonly user_id: string;
  readonly quest_id: string;
  readonly current_step_index: number;
  readonly current_dialogue_node_id: string | null;
  readonly choices_made: string | Readonly<Record<string, string>>;
  readonly started_at: number;
  readonly completed_at: number | null;
  readonly objective_progress: string | null;
  readonly claimed_at: number | null;
};

type WorldObjectInput = {
  readonly x: number;
  readonly y: number;
  readonly lat: number;
  readonly lon: number;
  readonly kind: WorldObject['kind'];
  readonly scale: number;
  readonly tint?: string;
  readonly questId?: string;
  readonly dungeonId?: string;
  readonly passable: boolean;
  readonly label?: string;
  readonly elements?: readonly Element[];
  readonly minLevel?: number;
  readonly maxLevel?: number;
};

const SQL_LIST_QUESTS = `SELECT * FROM quests ORDER BY created_at DESC`;
const SQL_GET_QUEST = `SELECT * FROM quests WHERE id = ?`;
const SQL_INSERT_QUEST = `INSERT INTO quests (id, name, description, required_level, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_QUEST = `UPDATE quests SET name = ?, description = ?, required_level = ?, data = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE_QUEST = `DELETE FROM quests WHERE id = ?`;
const SQL_LIST_AVAILABLE_QUESTS = `
  SELECT q.* FROM quests q
   WHERE q.required_level <= ?
     AND NOT EXISTS (
       SELECT 1 FROM user_quest_progress p
        WHERE p.user_id = ? AND p.quest_id = q.id AND p.completed_at IS NOT NULL
     )
   ORDER BY q.required_level, q.created_at
`;
const SQL_LIST_WORLD_OBJECTS = `SELECT * FROM world_objects ORDER BY created_at DESC`;
const SQL_GET_WORLD_OBJECT = `SELECT * FROM world_objects WHERE id = ?`;
const SQL_INSERT_WORLD_OBJECT = `INSERT INTO world_objects (id, x, y, lat, lon, kind, scale, tint, quest_id, dungeon_id, passable, label, elements, min_level, max_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_WORLD_OBJECT = `UPDATE world_objects SET x = ?, y = ?, lat = ?, lon = ?, kind = ?, scale = ?, tint = ?, quest_id = ?, dungeon_id = ?, passable = ?, label = ?, elements = ?, min_level = ?, max_level = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE_WORLD_OBJECT = `DELETE FROM world_objects WHERE id = ?`;
const SQL_BLOCKING_WORLD_OBJECT_AT = `SELECT * FROM world_objects WHERE x = ? AND y = ? AND passable = 0 LIMIT 1`;
const SQL_ADJACENT_QUEST = `
  SELECT q.id AS id, q.name AS name
    FROM world_objects o
    JOIN quests q ON q.id = o.quest_id
   WHERE o.quest_id IS NOT NULL
     AND ((o.x = ? AND o.y = ?) OR (o.x = ? AND o.y = ?) OR (o.x = ? AND o.y = ?) OR (o.x = ? AND o.y = ?))
   ORDER BY o.created_at
   LIMIT 1
`;
const SQL_GET_PROGRESS = `SELECT * FROM user_quest_progress WHERE user_id = ? AND quest_id = ?`;
const SQL_INSERT_PROGRESS = `INSERT INTO user_quest_progress (user_id, quest_id, current_step_index, current_dialogue_node_id, choices_made, started_at, completed_at, objective_progress, claimed_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)`;
const SQL_UPDATE_PROGRESS = `UPDATE user_quest_progress SET current_step_index = ?, current_dialogue_node_id = ?, choices_made = ?, completed_at = ? WHERE user_id = ? AND quest_id = ?`;
const SQL_LIST_PROGRESS_FOR_USER = `SELECT * FROM user_quest_progress WHERE user_id = ?`;
const SQL_UPDATE_OBJECTIVE_PROGRESS = `UPDATE user_quest_progress SET objective_progress = ?, completed_at = ? WHERE user_id = ? AND quest_id = ?`;
const SQL_MARK_CLAIMED = `UPDATE user_quest_progress SET claimed_at = ? WHERE user_id = ? AND quest_id = ? AND completed_at IS NOT NULL AND claimed_at IS NULL`;
const SQL_GRANT_CLAIM_CREDITS = `INSERT INTO player_wallet (user_id, credits, streak_day, last_claim_at, premium_until, updated_at) VALUES (?, ?, 0, NULL, NULL, ?) ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at`;
const SQL_GRANT_CLAIM_ITEM = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;

function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonObject(value: string | Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (typeof value !== 'string') return value;
  const parsed: unknown = JSON.parse(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === 'string') out[key] = entry;
    }
    return out;
  }
  return {};
}

function questFromRow(row: QuestRow, locale?: 'en' | 'pt'): Quest {
  const parsed: Quest = typeof row.data !== 'string' ? row.data : (JSON.parse(row.data) as Quest);
  if (locale === 'pt') {
    return {
      ...parsed,
      name: row.name_pt && row.name_pt.length > 0 ? row.name_pt : parsed.name,
      description: row.description_pt && row.description_pt.length > 0 ? row.description_pt : parsed.description,
    };
  }
  return parsed;
}

function parseElementsJson(value: string | null): readonly Element[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is Element => typeof entry === 'string');
  } catch {
    return null;
  }
}

function worldObjectFromRow(row: WorldObjectRow): WorldObject {
  const parsedElements = parseElementsJson(row.elements);
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    lat: row.lat,
    lon: row.lon,
    kind: row.kind,
    scale: row.scale,
    passable: row.passable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.tint !== null ? { tint: row.tint } : {}),
    ...(row.quest_id !== null ? { questId: row.quest_id } : {}),
    ...(row.dungeon_id !== null ? { dungeonId: row.dungeon_id } : {}),
    ...(row.label !== null ? { label: row.label } : {}),
    ...(parsedElements !== null && parsedElements.length > 0 ? { elements: parsedElements } : {}),
    ...(row.min_level !== null ? { minLevel: row.min_level } : {}),
    ...(row.max_level !== null ? { maxLevel: row.max_level } : {}),
  };
}

function progressFromRow(row: ProgressRow): UserQuestProgress {
  return {
    userId: row.user_id,
    questId: row.quest_id,
    currentStepIndex: row.current_step_index,
    currentDialogueNodeId: row.current_dialogue_node_id,
    choicesMade: parseJsonObject(row.choices_made),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function listQuests(locale?: 'en' | 'pt'): Promise<Quest[]> {
  return (await q<QuestRow>(SQL_LIST_QUESTS)).map((row) => questFromRow(row, locale));
}

export async function getQuest(id: string, locale?: 'en' | 'pt'): Promise<Quest | null> {
  const row = await one<QuestRow>(SQL_GET_QUEST, id);
  return row ? questFromRow(row, locale) : null;
}

export async function createQuest(input: Omit<Quest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Quest> {
  const now = Date.now();
  const quest: Quest = { ...input, id: newId('qst'), createdAt: now, updatedAt: now };
  await run(SQL_INSERT_QUEST, quest.id, quest.name, quest.description, quest.requiredLevel, encodeJson(quest), now, now);
  return quest;
}

export async function importQuest(input: Quest | Omit<Quest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Quest> {
  const fresh = { ...input, id: newId('qst'), createdAt: Date.now(), updatedAt: Date.now() };
  await run(SQL_INSERT_QUEST, fresh.id, fresh.name, fresh.description, fresh.requiredLevel, encodeJson(fresh), fresh.createdAt, fresh.updatedAt);
  return fresh;
}

export async function updateQuest(id: string, input: Omit<Quest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Quest | null> {
  const existing = await getQuest(id);
  if (!existing) return null;
  const updated: Quest = { ...input, id, createdAt: existing.createdAt, updatedAt: Date.now() };
  await run(SQL_UPDATE_QUEST, updated.name, updated.description, updated.requiredLevel, encodeJson(updated), updated.updatedAt, id);
  return updated;
}

export async function deleteQuest(id: string): Promise<boolean> {
  return (await run(SQL_DELETE_QUEST, id)).changes > 0;
}

export async function listAvailableQuests(userId: string, requiredLevel: number, locale?: 'en' | 'pt'): Promise<Quest[]> {
  return (await q<QuestRow>(SQL_LIST_AVAILABLE_QUESTS, requiredLevel, userId)).map((row) => questFromRow(row, locale));
}

export type StartQuestResult = { readonly quest: Quest; readonly progress: UserQuestProgress } | null;

/**
 * Takes the caller's handle so a dialogue action can start a quest inside the
 * transaction that also moves items and flags. Opening a nested tx here would
 * put the insert on a different connection, where a rollback upstream would
 * leave the quest started.
 */
export async function startQuestWithin(t: DbExecutor, userId: string, questId: string): Promise<StartQuestResult> {
  const questRow = await t.one<QuestRow>(SQL_GET_QUEST, [questId]);
  if (!questRow) return null;
  const existing = await t.one<ProgressRow>(SQL_GET_PROGRESS, [userId, questId]);
  if (existing) return { quest: questFromRow(questRow), progress: progressFromRow(existing) };
  const quest = questFromRow(questRow);
  const now = Date.now();
  const firstDialogue = quest.introDialogueId;
  const initialObjectiveProgress = quest.objectives && quest.objectives.length > 0
    ? encodeObjectiveProgress(quest.objectives.map(() => ({ counter: 0, doneAt: null })))
    : null;
  await t.run(SQL_INSERT_PROGRESS, [userId, questId, 0, firstDialogue, '{}', now, initialObjectiveProgress]);
  return {
    quest,
    progress: {
      userId,
      questId,
      currentStepIndex: 0,
      currentDialogueNodeId: firstDialogue,
      choicesMade: {},
      startedAt: now,
      completedAt: null,
    },
  };
}

export async function startQuest(userId: string, questId: string): Promise<StartQuestResult> {
  return tx((t) => startQuestWithin(t, userId, questId));
}

function parseObjectiveProgress(raw: string | null, objectiveCount: number): QuestObjectiveProgress[] {
  if (raw === null || raw === '') {
    return Array.from({ length: objectiveCount }, () => ({ counter: 0, doneAt: null as number | null }));
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not-array');
    const out: QuestObjectiveProgress[] = [];
    for (let i = 0; i < objectiveCount; i += 1) {
      const entry = parsed[i];
      if (entry && typeof entry === 'object') {
        const counter = typeof (entry as { counter?: unknown }).counter === 'number' ? (entry as { counter: number }).counter : 0;
        const doneAtRaw = (entry as { doneAt?: unknown }).doneAt;
        const doneAt = typeof doneAtRaw === 'number' ? doneAtRaw : null;
        out.push({ counter, doneAt });
      } else {
        out.push({ counter: 0, doneAt: null });
      }
    }
    return out;
  } catch {
    return Array.from({ length: objectiveCount }, () => ({ counter: 0, doneAt: null as number | null }));
  }
}

function encodeObjectiveProgress(progress: readonly QuestObjectiveProgress[]): string {
  return JSON.stringify(progress);
}

function deriveQuestState(
  quest: Quest,
  meanLevel: number,
  row: ProgressRow | null,
  objectives: readonly (QuestObjective & QuestObjectiveProgress)[],
): UserQuestState {
  if (row !== null && row.claimed_at !== null) return 'claimed';
  if (row === null) {
    return quest.requiredLevel > meanLevel ? 'locked' : 'available';
  }
  const allDone = objectives.length > 0 && objectives.every((o) => o.doneAt !== null);
  if (allDone || row.completed_at !== null) return 'completed';
  return 'active';
}

function questWithProgress(
  quest: Quest,
  meanLevel: number,
  row: ProgressRow | null,
): QuestWithProgress {
  const rawObjectives = quest.objectives ?? [];
  const progress = parseObjectiveProgress(row?.objective_progress ?? null, rawObjectives.length);
  const objectives = rawObjectives.map((obj, i) => {
    const p = progress[i] ?? { counter: 0, doneAt: null as number | null };
    if (obj.kind === 'travel') return { ...obj, counter: p.counter, doneAt: p.doneAt };
    return { ...obj, counter: p.counter, doneAt: p.doneAt };
  });
  return {
    id: quest.id,
    name: quest.name,
    description: quest.description,
    requiredLevel: quest.requiredLevel,
    introDialogueId: quest.introDialogueId,
    giver: quest.giver ?? 'Tamer Guild',
    rewardText: quest.rewardText ?? formatRewardText(quest),
    lockHint: quest.lockHint ?? (quest.requiredLevel > meanLevel ? `Reach party level ${quest.requiredLevel} to unlock` : null),
    objectives,
    state: deriveQuestState(quest, meanLevel, row, objectives),
    startedAt: row?.started_at ?? null,
    completedAt: row?.completed_at ?? null,
    claimedAt: row?.claimed_at ?? null,
  };
}

function formatRewardText(quest: Quest): string {
  const credits = quest.finalReward.guaranteedCredits;
  const itemCount = quest.finalReward.items.length;
  if (credits && itemCount > 0) return `${credits} DigiCredits · ${itemCount} item drops`;
  if (credits) return `${credits} DigiCredits`;
  if (itemCount > 0) return `${itemCount} item drops`;
  return 'Progression reward';
}

export async function listQuestsForUser(userId: string, meanLevel: number, locale?: 'en' | 'pt'): Promise<QuestWithProgress[]> {
  const [quests, progressRows] = await Promise.all([
    q<QuestRow>(SQL_LIST_QUESTS),
    q<ProgressRow>(SQL_LIST_PROGRESS_FOR_USER, userId),
  ]);
  const progressByQuestId = new Map<string, ProgressRow>();
  for (const row of progressRows) progressByQuestId.set(row.quest_id, row);
  return quests
    .map((row) => questFromRow(row, locale))
    .filter((quest) => quest.objectives !== undefined && quest.objectives.length > 0)
    .map((quest) => questWithProgress(quest, meanLevel, progressByQuestId.get(quest.id) ?? null))
    .filter((q) => q.state !== 'claimed');
}

export async function acceptQuest(userId: string, questId: string, meanLevel: number): Promise<QuestWithProgress | null> {
  return tx(async (t) => {
    const questRow = await t.one<QuestRow>(SQL_GET_QUEST, [questId]);
    if (!questRow) return null;
    const quest = questFromRow(questRow);
    if (quest.requiredLevel > meanLevel) return null;
    const existing = await t.one<ProgressRow>(SQL_GET_PROGRESS, [userId, questId]);
    if (existing) return questWithProgress(quest, meanLevel, existing);
    const now = Date.now();
    const firstDialogue = quest.introDialogueId;
    const initialObjectiveProgress = quest.objectives && quest.objectives.length > 0
      ? encodeObjectiveProgress(quest.objectives.map(() => ({ counter: 0, doneAt: null })))
      : null;
    await t.run(SQL_INSERT_PROGRESS, [userId, questId, 0, firstDialogue, '{}', now, initialObjectiveProgress]);
    const fresh: ProgressRow = {
      user_id: userId,
      quest_id: questId,
      current_step_index: 0,
      current_dialogue_node_id: firstDialogue,
      choices_made: '{}',
      started_at: now,
      completed_at: null,
      objective_progress: initialObjectiveProgress,
      claimed_at: null,
    };
    return questWithProgress(quest, meanLevel, fresh);
  });
}

export type QuestClaimResult = {
  readonly ok: boolean;
  readonly creditsGranted: number;
  readonly itemsGranted: readonly { readonly itemId: string; readonly qty: number }[];
};

function weightedPickLootItem(items: readonly { readonly itemId: string; readonly weight: number; readonly minQty: number; readonly maxQty: number }[]): { readonly itemId: string; readonly minQty: number; readonly maxQty: number } | null {
  const totalWeight = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (totalWeight <= 0) return null;
  let r = Math.random() * totalWeight;
  for (const item of items) {
    r -= Math.max(0, item.weight);
    if (r <= 0) return item;
  }
  return items[items.length - 1] ?? null;
}

function randomQtyBetween(min: number, max: number): number {
  const lo = Math.max(0, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export async function claimQuest(userId: string, questId: string): Promise<QuestClaimResult> {
  return tx(async (t) => {
    const questRow = await t.one<QuestRow>(SQL_GET_QUEST, [questId]);
    if (!questRow) return { ok: false, creditsGranted: 0, itemsGranted: [] };
    const quest = questFromRow(questRow);
    const now = Date.now();
    const marked = await t.run(SQL_MARK_CLAIMED, [now, userId, questId]);
    if (marked.changes === 0) return { ok: false, creditsGranted: 0, itemsGranted: [] };

    let creditsGranted = 0;
    const guaranteedCredits = quest.finalReward.guaranteedCredits ?? 0;
    if (guaranteedCredits > 0) {
      await t.run(SQL_GRANT_CLAIM_CREDITS, [userId, guaranteedCredits, now]);
      creditsGranted = guaranteedCredits;
    }

    const itemsGranted: { itemId: string; qty: number }[] = [];
    const pickCount = Math.max(0, quest.finalReward.pickCount);
    if (pickCount > 0 && quest.finalReward.items.length > 0) {
      const accumulator = new Map<string, number>();
      for (let i = 0; i < pickCount; i += 1) {
        const picked = weightedPickLootItem(quest.finalReward.items);
        if (!picked) continue;
        const qty = randomQtyBetween(picked.minQty, picked.maxQty);
        if (qty <= 0) continue;
        accumulator.set(picked.itemId, (accumulator.get(picked.itemId) ?? 0) + qty);
      }
      for (const [itemId, qty] of accumulator) {
        await t.run(SQL_GRANT_CLAIM_ITEM, [userId, itemId, qty, now]);
        itemsGranted.push({ itemId, qty });
      }
    }

    return { ok: true, creditsGranted, itemsGranted };
  });
}

async function applyObjectiveUpdate(
  userId: string,
  update: (quest: Quest, progress: QuestObjectiveProgress[]) => { readonly changed: boolean; readonly progress: readonly QuestObjectiveProgress[] },
): Promise<void> {
  const progressRows = await q<ProgressRow>(SQL_LIST_PROGRESS_FOR_USER, userId);
  const active = progressRows.filter((r) => r.completed_at === null && r.claimed_at === null);
  if (active.length === 0) return;
  const now = Date.now();
  for (const row of active) {
    const questRow = await one<QuestRow>(SQL_GET_QUEST, row.quest_id);
    if (!questRow) continue;
    const quest = questFromRow(questRow);
    const objectiveCount = quest.objectives?.length ?? 0;
    if (objectiveCount === 0) continue;
    const currentProgress = parseObjectiveProgress(row.objective_progress, objectiveCount);
    const { changed, progress: nextProgress } = update(quest, [...currentProgress]);
    if (!changed) continue;
    const allDone = nextProgress.every((p) => p.doneAt !== null);
    await run(
      SQL_UPDATE_OBJECTIVE_PROGRESS,
      encodeObjectiveProgress(nextProgress),
      allDone ? now : null,
      userId,
      row.quest_id,
    );
  }
}

export async function bumpTravelObjectives(userId: string, biome: Biome): Promise<void> {
  await applyObjectiveUpdate(userId, (quest, progress) => {
    let changed = false;
    const now = Date.now();
    quest.objectives?.forEach((obj, i) => {
      if (obj.kind !== 'travel') return;
      if (obj.biome !== biome) return;
      const p = progress[i];
      if (!p || p.doneAt !== null) return;
      progress[i] = { counter: 1, doneAt: now };
      changed = true;
    });
    return { changed, progress };
  });
}

export async function bumpDefeatObjectives(
  userId: string,
  biome: Biome,
  element: Element,
  hits = 1,
): Promise<void> {
  await applyObjectiveUpdate(userId, (quest, progress) => {
    let changed = false;
    const now = Date.now();
    quest.objectives?.forEach((obj, i) => {
      if (obj.kind !== 'defeat') return;
      if (obj.biome !== biome) return;
      if (obj.element !== undefined && obj.element !== element) return;
      const p = progress[i];
      if (!p || p.doneAt !== null) return;
      const next = Math.min(obj.count, p.counter + hits);
      progress[i] = { counter: next, doneAt: next >= obj.count ? now : null };
      changed = true;
    });
    return { changed, progress };
  });
}

export async function updateQuestProgress(progress: UserQuestProgress): Promise<void> {
  await run(
    SQL_UPDATE_PROGRESS,
    progress.currentStepIndex,
    progress.currentDialogueNodeId,
    encodeJson(progress.choicesMade),
    progress.completedAt,
    progress.userId,
    progress.questId,
  );
}

export async function getQuestProgress(userId: string, questId: string): Promise<UserQuestProgress | null> {
  const row = await one<ProgressRow>(SQL_GET_PROGRESS, userId, questId);
  return row ? progressFromRow(row) : null;
}

export async function listWorldObjects(): Promise<WorldObject[]> {
  return (await q<WorldObjectRow>(SQL_LIST_WORLD_OBJECTS)).map(worldObjectFromRow);
}

export async function getWorldObject(id: string): Promise<WorldObject | null> {
  const row = await one<WorldObjectRow>(SQL_GET_WORLD_OBJECT, id);
  return row ? worldObjectFromRow(row) : null;
}

export async function createWorldObject(input: WorldObjectInput): Promise<WorldObject> {
  const now = Date.now();
  const object: WorldObject = { ...input, id: newId('obj'), createdAt: now, updatedAt: now };
  const elementsJson = input.elements && input.elements.length > 0 ? JSON.stringify(input.elements) : null;
  await run(SQL_INSERT_WORLD_OBJECT, object.id, object.x, object.y, object.lat, object.lon, object.kind, object.scale, object.tint ?? null, object.questId ?? null, object.dungeonId ?? null, object.passable ? 1 : 0, object.label ?? null, elementsJson, object.minLevel ?? null, object.maxLevel ?? null, now, now);
  return object;
}

export async function updateWorldObject(id: string, input: WorldObjectInput): Promise<WorldObject | null> {
  const existing = await getWorldObject(id);
  if (!existing) return null;
  const now = Date.now();
  const elementsJson = input.elements && input.elements.length > 0 ? JSON.stringify(input.elements) : null;
  const result = await run(SQL_UPDATE_WORLD_OBJECT, input.x, input.y, input.lat, input.lon, input.kind, input.scale, input.tint ?? null, input.questId ?? null, input.dungeonId ?? null, input.passable ? 1 : 0, input.label ?? null, elementsJson, input.minLevel ?? null, input.maxLevel ?? null, now, id);
  if (result.changes === 0) return null;
  return { ...input, id, createdAt: existing.createdAt, updatedAt: now };
}

export async function deleteWorldObject(id: string): Promise<boolean> {
  return (await run(SQL_DELETE_WORLD_OBJECT, id)).changes > 0;
}

export async function blockingWorldObjectAt(x: number, y: number): Promise<WorldObject | null> {
  const row = await one<WorldObjectRow>(SQL_BLOCKING_WORLD_OBJECT_AT, x, y);
  return row ? worldObjectFromRow(row) : null;
}

export async function adjacentQuestAt(x: number, y: number): Promise<WorldObjectAdjacent | null> {
  return one<WorldObjectAdjacent>(SQL_ADJACENT_QUEST, x, y - 1, x, y + 1, x - 1, y, x + 1, y);
}
