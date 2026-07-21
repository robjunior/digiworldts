/**
 * Roster: a player's owned Digimon and their active 3-slot party.
 *
 * Contract:
 *   - Every player, on registration, gets THREE random Rookies from the
 *     XML catalog as a starter roster (auto-assigned to party slots 0/1/2).
 *     If the catalog has fewer than 3 usable templates the seed is deferred
 *     — the player sees a friendly "waiting for catalog" state and the
 *     admin can fill it in later.
 *
 *   - GET  /api/roster                    → owned + template details + party
 *   - POST /api/roster/party              → { slot: 0|1|2, monId }  swap in
 *   - POST /api/roster/party/remove       → { slot }                clear
 *   - POST /api/roster/rename/:id         → { nickname }            rename
 *
 * Battle uses `loadPartyLoadout(userId)` to resolve the 3 slots into
 * BattleUnits (see src/battle/engine.ts).
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type RosterRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { loadCatalog } from '../digimon/xml.js';
import { PARTY_SIZE, SKILLS_PER_DIGIMON, type Skill, type TemplateDigimon } from '../digimon/types.js';
import { xpToReach } from '../progression/xp.js';
import type { Loadout, LoadoutMember } from '../battle/engine.js';
import { evolveRoster, getEvolutionOptions } from './evolve.js';

// ============================================================================
// SQL
// ============================================================================
const SQL_SELECT_ALL = `SELECT * FROM player_roster WHERE user_id = ? ORDER BY created_at`;
const SQL_SELECT_BY_ID = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_INSERT = `INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, atk_bonus, def_bonus, spd_bonus, status, slot_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, 5, 0, 0, 0, 0, 0, ?, ?, ?, ?)`;
const SQL_UPDATE_STATUS_SLOT = `UPDATE player_roster SET status = ?, slot_index = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_CLEAR_SLOT = `UPDATE player_roster SET status = 'resting', slot_index = NULL, updated_at = ? WHERE user_id = ? AND slot_index = ?`;
const SQL_UPDATE_NICKNAME = `UPDATE player_roster SET nickname = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_COUNT = `SELECT COUNT(*) AS n FROM player_roster WHERE user_id = ?`;
const SQL_CLEAR_REVIVE_AT = `UPDATE player_roster SET revive_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_SELECT_INVENTORY_QTY = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - 1, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= 1`;
const SQL_UPDATE_EQUIPPED_SKILLS = `UPDATE player_roster SET equipped_skill_ids = ?, updated_at = ? WHERE id = ? AND user_id = ?`;

const REVIVE_ITEM_ID = 'itm-digi-revive';

function parseJsonStringArray(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

export type LearnedSkillEntry = {
  key: string;
  skill: Skill;
  sourceTemplateId: string;
  sourceTemplateName: string;
  sourceStage: string;
  source: 'current' | 'history';
};

function skillKey(templateId: string, skillId: string): string {
  return `${templateId}:${skillId}`;
}

export function learnedSkillsFor(currentTpl: TemplateDigimon, historyIds: readonly string[], catalog: readonly TemplateDigimon[]): LearnedSkillEntry[] {
  const templateById = new Map(catalog.map((t) => [t.id, t] as const));
  const seen = new Set<string>();
  const out: LearnedSkillEntry[] = [];
  const collect = (tpl: TemplateDigimon, source: 'current' | 'history'): void => {
    for (const s of tpl.skillPool) {
      const key = skillKey(tpl.id, s.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        skill: s,
        sourceTemplateId: tpl.id,
        sourceTemplateName: tpl.name,
        sourceStage: tpl.stage,
        source,
      });
    }
  };
  collect(currentTpl, 'current');
  for (const id of historyIds) {
    const tpl = templateById.get(id);
    if (tpl) collect(tpl, 'history');
  }
  return out;
}

function normalizeEquippedKey(entry: string, currentTemplateId: string): string {
  return entry.includes(':') ? entry : skillKey(currentTemplateId, entry);
}

// ============================================================================
// Views
// ============================================================================

export type RosterView = {
  id: string;
  catalogId: string;
  nickname: string;
  level: number;
  xp: number;
  xpFloor: number;
  xpNext: number;
  statBonus: { hp: number; en: number; atk: number; def: number; int: number; spd: number };
  mood: number;
  status: 'resting' | 'training' | 'party';
  slot: number | null;
  reviveAt: number | null;
  listedAt: number | null;
  evolutionHistory: string[];
  equippedSkillIds: string[] | null;
  template: TemplateDigimon | null;
};

function rowToView(row: RosterRow, template: TemplateDigimon | null): RosterView {
  const stage = template?.stage ?? 'Rookie';
  const equippedRaw = parseJsonStringArray(row.equipped_skill_ids);
  return {
    id: row.id,
    catalogId: row.catalog_id,
    nickname: row.nickname,
    level: row.level,
    xp: row.xp,
    xpFloor: xpToReach(row.level, stage),
    xpNext: xpToReach(row.level + 1, stage),
    statBonus: {
      hp: row.hp_bonus,
      en: row.en_bonus,
      atk: row.atk_bonus,
      def: row.def_bonus,
      int: row.int_bonus,
      spd: row.spd_bonus,
    },
    mood: row.mood,
    status: row.status,
    slot: row.slot_index,
    reviveAt: row.revive_at,
    listedAt: row.listed_at,
    evolutionHistory: parseJsonStringArray(row.evolution_history),
    equippedSkillIds: equippedRaw.length > 0 ? equippedRaw : null,
    template,
  };
}

// ============================================================================
// Seeding
// ============================================================================

function pickStarterTemplates(all: TemplateDigimon[], count: number): TemplateDigimon[] {
  const rookies = all.filter((t) => t.stage === 'Rookie');
  const pool = rookies.length >= count ? rookies : all;
  if (pool.length < count) return [];
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Called at register time. Non-throwing: if the catalog isn't ready yet the
 * player will see the "empty roster" state and can seed manually later.
 */
export async function seedStarterRoster(userId: string): Promise<{ seeded: number; reason?: string }> {
  const existingRow = await one<{ n: number }>(SQL_COUNT, userId);
  const existing = existingRow?.n ?? 0;
  if (existing > 0) return { seeded: 0, reason: 'roster-exists' };
  const catalog = loadCatalog();
  const starters = pickStarterTemplates(catalog.digimons, PARTY_SIZE);
  if (starters.length === 0) return { seeded: 0, reason: 'catalog-empty' };
  const now = Date.now();
  await tx(async (t) => {
    for (let i = 0; i < starters.length; i++) {
      const tpl = starters[i]!;
      await t.run(SQL_INSERT, [
        newId('mon'),
        userId,
        tpl.id,
        tpl.name,
        'party',
        i,
        now,
        now,
      ]);
    }
  });
  log.info('roster.seed.ok', { userId, count: starters.length });
  return { seeded: starters.length };
}

// ============================================================================
// Loadout resolution (used by battle/routes.ts)
// ============================================================================

export async function loadPartyLoadout(userId: string): Promise<Loadout | { error: string; missing: number[] }> {
  const rows = (await q<RosterRow>(SQL_SELECT_ALL, userId)).filter((r) => r.slot_index !== null);
  const catalog = loadCatalog();
  const templateById = new Map<string, TemplateDigimon>();
  for (const t of catalog.digimons) templateById.set(t.id, t);

  const bySlot = new Map<number, RosterRow>();
  for (const r of rows) {
    if (r.slot_index !== null && r.slot_index >= 0 && r.slot_index < PARTY_SIZE) {
      bySlot.set(r.slot_index, r);
    }
  }

  const members: LoadoutMember[] = [];
  const missing: number[] = [];
  for (let slot = 0; slot < PARTY_SIZE; slot++) {
    const row = bySlot.get(slot);
    if (!row) {
      missing.push(slot);
      continue;
    }
    const template = templateById.get(row.catalog_id);
    if (!template) {
      missing.push(slot);
      continue;
    }
    const equippedIds = parseJsonStringArray(row.equipped_skill_ids);
    const member: LoadoutMember = {
      monId: row.id,
      templateId: template.id,
      template,
      level: row.level,
      nickname: row.nickname,
      statBonus: {
        hp: row.hp_bonus,
        en: row.en_bonus,
        atk: row.atk_bonus,
        def: row.def_bonus,
        int: row.int_bonus,
        spd: row.spd_bonus,
      },
    };
    if (equippedIds.length > 0) {
      const historyIds = parseJsonStringArray(row.evolution_history);
      const learned = learnedSkillsFor(template, historyIds, catalog.digimons);
      const learnedByKey = new Map(learned.map((e) => [e.key, e.skill] as const));
      const resolved = equippedIds
        .map((entry) => normalizeEquippedKey(entry, template.id))
        .map((key) => learnedByKey.get(key))
        .filter((s): s is Skill => Boolean(s));
      if (resolved.length > 0) member.equippedSkills = resolved;
    }
    members.push(member);
  }

  if (members.length !== PARTY_SIZE) {
    return { error: 'incomplete-party', missing };
  }
  return { playerId: userId, members: [members[0]!, members[1]!, members[2]!] };
}

/** Compute the mean party level (for matchmaking brackets). */
export async function partyAverageLevel(userId: string): Promise<number> {
  const rows = (await q<RosterRow>(SQL_SELECT_ALL, userId)).filter((r) => r.slot_index !== null);
  if (rows.length === 0) return 1;
  const sum = rows.reduce((s, r) => s + r.level, 0);
  return Math.max(1, Math.round(sum / rows.length));
}

// ============================================================================
// HTTP plugin
// ============================================================================

const PartySchema = z.object({
  slot: z.number().int().min(0).max(PARTY_SIZE - 1),
  monId: z.string().min(3),
});

const RenameSchema = z.object({
  nickname: z.string().trim().min(1).max(24),
});

const RemoveSchema = z.object({
  slot: z.number().int().min(0).max(PARTY_SIZE - 1),
});

const EvolveSchema = z.object({
  targetCatalogId: z.string().min(1),
});

const SkillsSchema = z.object({
  skillIds: z.array(z.string().min(1)).min(1).max(SKILLS_PER_DIGIMON),
});

export const rosterPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/roster', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const catalog = loadCatalog();
    const templateById = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) templateById.set(t.id, t);
    const rows = await q<RosterRow>(SQL_SELECT_ALL, user.id);
    const views = rows.map((r) => rowToView(r, templateById.get(r.catalog_id) ?? null));
    return reply.send({ roster: views });
  });

  app.post('/api/roster/seed', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const outcome = await seedStarterRoster(user.id);
    if (outcome.seeded === 0 && outcome.reason === 'catalog-empty') {
      return reply.code(409).send({ error: 'catalog-empty', message: 'catalog is empty — ask the admin to seed it' });
    }
    return reply.send(outcome);
  });

  app.post('/api/roster/party', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = PartySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const { slot, monId } = parsed.data;
    const target = await one<RosterRow>(SQL_SELECT_BY_ID, monId, user.id);
    if (!target) return reply.code(404).send({ error: 'mon not found' });
    const now = Date.now();
    if (target.revive_at !== null && target.revive_at > now) {
      return reply.code(409).send({ error: 'mon-downed', message: 'This Digimon is recovering. Wait or use a Digi-Revive item.', reviveAt: target.revive_at });
    }
    if (target.listed_at !== null) {
      return reply.code(409).send({ error: 'mon-listed', message: 'This Digimon is on the market. Cancel the listing first.' });
    }
    if (target.status !== 'resting' && target.status !== 'party') {
      return reply.code(409).send({
        error: 'mon-busy',
        status: target.status,
        message: `This Digimon is currently ${target.status === 'training' ? 'training — collect the session first' : `busy (${target.status})`}.`,
      });
    }
    await tx(async (t) => {
      await t.run(SQL_CLEAR_SLOT, [now, user.id, slot]);
      await t.run(SQL_UPDATE_STATUS_SLOT, ['party', slot, now, monId, user.id]);
    });
    return reply.send({ ok: true });
  });

  app.post('/api/roster/party/remove', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = RemoveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    await run(SQL_CLEAR_SLOT, Date.now(), user.id, parsed.data.slot);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/roster/rename/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid nickname' });
    const now = Date.now();
    const info = await run(SQL_UPDATE_NICKNAME, parsed.data.nickname, now, req.params.id, user.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'mon not found' });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { monId: string } }>('/api/roster/revive/:monId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const monId = req.params.monId;
    const target = await one<RosterRow>(SQL_SELECT_BY_ID, monId, user.id);
    if (!target) return reply.code(404).send({ error: 'mon not found' });
    const now = Date.now();
    if (target.revive_at === null || target.revive_at <= now) {
      return reply.code(409).send({ error: 'not-downed', message: 'This Digimon is already ready.' });
    }
    const stock = await one<{ qty: number }>(SQL_SELECT_INVENTORY_QTY, user.id, REVIVE_ITEM_ID);
    if (!stock || stock.qty < 1) {
      return reply.code(409).send({ error: 'no-item', message: 'Buy a Digi-Revive from the shop.' });
    }
    await tx(async (t) => {
      const dec = await t.run(SQL_DECREMENT_INVENTORY, [now, user.id, REVIVE_ITEM_ID]);
      if (dec.changes === 0) throw new Error('inventory race');
      await t.run(SQL_CLEAR_REVIVE_AT, [now, monId, user.id]);
    });
    log.info('roster.revive.ok', { userId: user.id, monId });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { monId: string } }>('/api/roster/:monId/evolutions', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const gate = await getEvolutionOptions(req.params.monId, user.id);
    if (!gate) return reply.code(404).send({ error: 'mon not found' });
    return reply.send(gate);
  });

  app.post<{ Params: { monId: string } }>('/api/roster/:monId/evolve', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = EvolveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await evolveRoster(req.params.monId, user.id, parsed.data.targetCatalogId);
    if (!result.ok) {
      const gateReasons = new Set(['no-chip', 'invalid target', 'level-too-low', 'no-paths', 'stage-cap', 'race-conflict']);
      const code = result.error === 'mon not found' ? 404 : gateReasons.has(result.error) ? 409 : 500;
      return reply.code(code).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.get<{ Params: { monId: string } }>('/api/roster/:monId/skills', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const row = await one<RosterRow>(SQL_SELECT_BY_ID, req.params.monId, user.id);
    if (!row) return reply.code(404).send({ error: 'mon not found' });
    const catalog = loadCatalog();
    const currentTpl = catalog.digimons.find((t) => t.id === row.catalog_id);
    if (!currentTpl) return reply.code(500).send({ error: 'template missing' });
    const historyIds = parseJsonStringArray(row.evolution_history);
    const learnedSkills = learnedSkillsFor(currentTpl, historyIds, catalog.digimons);
    const fromCurrent = learnedSkills.filter((e) => e.source === 'current').map((e) => e.key);
    const fromHistory = learnedSkills.filter((e) => e.source === 'history').map((e) => e.key);
    const rawEquipped = parseJsonStringArray(row.equipped_skill_ids);
    const learnedKeys = new Set(learnedSkills.map((e) => e.key));
    const normalizedEquipped = rawEquipped
      .map((entry) => normalizeEquippedKey(entry, row.catalog_id))
      .filter((key) => learnedKeys.has(key));
    const equipped = normalizedEquipped.length > 0
      ? normalizedEquipped
      : currentTpl.skillPool.slice(0, SKILLS_PER_DIGIMON).map((s) => skillKey(currentTpl.id, s.id));
    return reply.send({
      monId: row.id,
      currentCatalogId: row.catalog_id,
      currentStage: currentTpl.stage,
      currentName: currentTpl.name,
      history: historyIds,
      learnedSkills,
      equipped,
      groupings: { fromCurrent, fromHistory },
      maxEquipped: SKILLS_PER_DIGIMON,
    });
  });

  app.put<{ Params: { monId: string }; Body: unknown }>('/api/roster/:monId/skills', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = SkillsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const { skillIds } = parsed.data;
    const row = await one<RosterRow>(SQL_SELECT_BY_ID, req.params.monId, user.id);
    if (!row) return reply.code(404).send({ error: 'mon not found' });
    const catalog = loadCatalog();
    const currentTpl = catalog.digimons.find((t) => t.id === row.catalog_id);
    if (!currentTpl) return reply.code(500).send({ error: 'template missing' });
    const historyIds = parseJsonStringArray(row.evolution_history);
    const learned = learnedSkillsFor(currentTpl, historyIds, catalog.digimons);
    const learnedKeys = new Set(learned.map((e) => e.key));
    const normalized = skillIds.map((entry) => normalizeEquippedKey(entry, row.catalog_id));
    const unique = Array.from(new Set(normalized));
    if (unique.length !== normalized.length) return reply.code(400).send({ error: 'duplicate-skill' });
    for (const key of normalized) {
      if (!learnedKeys.has(key)) return reply.code(400).send({ error: 'skill-not-learned', skillKey: key });
    }
    await run(SQL_UPDATE_EQUIPPED_SKILLS, JSON.stringify(normalized), Date.now(), req.params.monId, user.id);
    log.info('roster.skills.update', { userId: user.id, monId: req.params.monId, skillKeys: normalized });
    return reply.send({ ok: true, equipped: normalized });
  });
};
