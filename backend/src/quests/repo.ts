import type {
  DialogueNodeId,
  Quest,
  UserQuestProgress,
  WorldObject,
  WorldObjectAdjacent,
} from '@digiworld/shared/quest';
import { one, q, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';

type QuestRow = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly required_level: number;
  readonly data: string | Quest;
  readonly created_at: number;
  readonly updated_at: number;
};

type WorldObjectRow = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: WorldObject['kind'];
  readonly scale: number;
  readonly tint: string | null;
  readonly quest_id: string | null;
  readonly passable: 0 | 1;
  readonly label: string | null;
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
};

type WorldObjectInput = {
  readonly x: number;
  readonly y: number;
  readonly kind: WorldObject['kind'];
  readonly scale: number;
  readonly tint?: string;
  readonly questId?: string;
  readonly passable: boolean;
  readonly label?: string;
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
const SQL_INSERT_WORLD_OBJECT = `INSERT INTO world_objects (id, x, y, kind, scale, tint, quest_id, passable, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_WORLD_OBJECT = `UPDATE world_objects SET x = ?, y = ?, kind = ?, scale = ?, tint = ?, quest_id = ?, passable = ?, label = ?, updated_at = ? WHERE id = ?`;
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
const SQL_INSERT_PROGRESS = `INSERT INTO user_quest_progress (user_id, quest_id, current_step_index, current_dialogue_node_id, choices_made, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`;
const SQL_UPDATE_PROGRESS = `UPDATE user_quest_progress SET current_step_index = ?, current_dialogue_node_id = ?, choices_made = ?, completed_at = ? WHERE user_id = ? AND quest_id = ?`;

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

function questFromRow(row: QuestRow): Quest {
  if (typeof row.data !== 'string') return row.data;
  return JSON.parse(row.data) as Quest;
}

function worldObjectFromRow(row: WorldObjectRow): WorldObject {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    kind: row.kind,
    scale: row.scale,
    passable: row.passable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.tint !== null ? { tint: row.tint } : {}),
    ...(row.quest_id !== null ? { questId: row.quest_id } : {}),
    ...(row.label !== null ? { label: row.label } : {}),
  };
}

function progressFromRow(row: ProgressRow): UserQuestProgress {
  return {
    userId: row.user_id,
    questId: row.quest_id,
    currentStepIndex: row.current_step_index,
    currentDialogueNodeId: row.current_dialogue_node_id as DialogueNodeId | null,
    choicesMade: parseJsonObject(row.choices_made),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function listQuests(): Promise<Quest[]> {
  return (await q<QuestRow>(SQL_LIST_QUESTS)).map(questFromRow);
}

export async function getQuest(id: string): Promise<Quest | null> {
  const row = await one<QuestRow>(SQL_GET_QUEST, id);
  return row ? questFromRow(row) : null;
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

export async function listAvailableQuests(userId: string, requiredLevel: number): Promise<Quest[]> {
  return (await q<QuestRow>(SQL_LIST_AVAILABLE_QUESTS, requiredLevel, userId)).map(questFromRow);
}

export async function startQuest(userId: string, questId: string): Promise<{ readonly quest: Quest; readonly progress: UserQuestProgress } | null> {
  return tx(async (t) => {
    const questRow = await t.one<QuestRow>(SQL_GET_QUEST, [questId]);
    if (!questRow) return null;
    const existing = await t.one<ProgressRow>(SQL_GET_PROGRESS, [userId, questId]);
    if (existing) return { quest: questFromRow(questRow), progress: progressFromRow(existing) };
    const quest = questFromRow(questRow);
    const now = Date.now();
    const firstDialogue = quest.intro.rootNodeId;
    await t.run(SQL_INSERT_PROGRESS, [userId, questId, 0, firstDialogue, '{}', now]);
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
  await run(SQL_INSERT_WORLD_OBJECT, object.id, object.x, object.y, object.kind, object.scale, object.tint ?? null, object.questId ?? null, object.passable ? 1 : 0, object.label ?? null, now, now);
  return object;
}

export async function updateWorldObject(id: string, input: WorldObjectInput): Promise<WorldObject | null> {
  const existing = await getWorldObject(id);
  if (!existing) return null;
  const now = Date.now();
  const result = await run(SQL_UPDATE_WORLD_OBJECT, input.x, input.y, input.kind, input.scale, input.tint ?? null, input.questId ?? null, input.passable ? 1 : 0, input.label ?? null, now, id);
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
