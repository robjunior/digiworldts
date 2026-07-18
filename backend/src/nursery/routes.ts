import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type ResourceRow, type RosterRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { log } from '../util/log.js';
import type { TemplateDigimon } from '../digimon/types.js';

const MAX_PETS_PER_MON_PER_DAY = 3;
const PET_MOOD_DELTA = 5;
const FEED_MOOD_DELTA = 8;
const FEED_MEAT_COST = 5;

const SQL_SELECT_ALL = `SELECT * FROM player_roster WHERE user_id = ? ORDER BY created_at`;
const SQL_SELECT_BY_ID = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_MEAT = `SELECT amount FROM resources WHERE user_id = ? AND resource = 'Meat'`;
const SQL_UPDATE_PET = `UPDATE player_roster SET mood = ?, pets_today = ?, pets_day = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_MOOD = `UPDATE player_roster SET mood = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_DEDUCT_MEAT = `UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = 'Meat' AND amount >= ?`;

function todayKeyUTC(now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function petsTodayFor(row: RosterRow, todayKey: string): number {
  return row.pets_day === todayKey ? row.pets_today : 0;
}

function clampMood(v: number): number {
  return Math.max(0, Math.min(100, v));
}

type NurseryMonView = {
  id: string;
  catalogId: string;
  nickname: string;
  level: number;
  mood: number;
  petsToday: number;
  canPet: boolean;
  template: TemplateDigimon | null;
};

async function readMeat(userId: string): Promise<number> {
  const row = await one<{ amount: number }>(SQL_SELECT_MEAT, userId);
  return row?.amount ?? 0;
}

export const nurseryPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/nursery', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const catalog = loadCatalog();
    const templateById = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) templateById.set(t.id, t);

    const rows = await q<RosterRow>(SQL_SELECT_ALL, user.id);
    const today = todayKeyUTC(Date.now());
    const mons: NurseryMonView[] = rows
      .filter((row) => row.listed_at === null)
      .map((row) => {
        const petsToday = petsTodayFor(row, today);
        return {
          id: row.id,
          catalogId: row.catalog_id,
          nickname: row.nickname,
          level: row.level,
          mood: row.mood,
          petsToday,
          canPet: petsToday < MAX_PETS_PER_MON_PER_DAY,
          template: templateById.get(row.catalog_id) ?? null,
        };
      });
    const meat = await readMeat(user.id);
    return reply.send({
      mons,
      meat: Math.floor(meat),
      maxPetsPerDay: MAX_PETS_PER_MON_PER_DAY,
      petMoodDelta: PET_MOOD_DELTA,
      feedMoodDelta: FEED_MOOD_DELTA,
      feedMeatCost: FEED_MEAT_COST,
    });
  });

  app.post<{ Params: { monId: string } }>('/api/nursery/pet/:monId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const monId = req.params.monId;
    const target = await one<RosterRow>(SQL_SELECT_BY_ID, monId, user.id);
    if (!target) return reply.code(404).send({ error: 'mon-not-found' });
    if (target.listed_at !== null) return reply.code(409).send({ error: 'mon-listed', message: 'This Digimon is on the market.' });

    const now = Date.now();
    const today = todayKeyUTC(now);
    const currentPets = petsTodayFor(target, today);
    if (currentPets >= MAX_PETS_PER_MON_PER_DAY) {
      return reply.code(409).send({
        error: 'pet-limit',
        message: `Already petted ${MAX_PETS_PER_MON_PER_DAY} times today. Come back tomorrow.`,
      });
    }
    const newMood = clampMood(target.mood + PET_MOOD_DELTA);
    const newPetsToday = currentPets + 1;
    await run(SQL_UPDATE_PET, [newMood, newPetsToday, today, now, monId, user.id]);
    log.info('nursery.pet.ok', { userId: user.id, monId, mood: newMood, petsToday: newPetsToday });
    return reply.send({
      ok: true,
      mood: newMood,
      petsToday: newPetsToday,
      maxPetsPerDay: MAX_PETS_PER_MON_PER_DAY,
    });
  });

  app.post<{ Params: { monId: string } }>('/api/nursery/feed/:monId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const monId = req.params.monId;
    const target = await one<RosterRow>(SQL_SELECT_BY_ID, monId, user.id);
    if (!target) return reply.code(404).send({ error: 'mon-not-found' });
    if (target.listed_at !== null) return reply.code(409).send({ error: 'mon-listed', message: 'This Digimon is on the market.' });

    const now = Date.now();
    let newMood = target.mood;
    let remainingMeat = 0;
    let ok = false;
    await tx(async (t) => {
      const dec = await t.run(SQL_DEDUCT_MEAT, [FEED_MEAT_COST, now, user.id, FEED_MEAT_COST]);
      if (dec.changes === 0) {
        return;
      }
      newMood = clampMood(target.mood + FEED_MOOD_DELTA);
      await t.run(SQL_UPDATE_MOOD, [newMood, now, monId, user.id]);
      const remain = await t.one<{ amount: number }>(SQL_SELECT_MEAT, [user.id]);
      remainingMeat = Math.floor(remain?.amount ?? 0);
      ok = true;
    });
    if (!ok) {
      return reply.code(409).send({
        error: 'no-meat',
        message: `Not enough Meat. Need ${FEED_MEAT_COST}. Collect from your Farm.`,
      });
    }
    log.info('nursery.feed.ok', { userId: user.id, monId, mood: newMood, meat: remainingMeat });
    return reply.send({ ok: true, mood: newMood, meat: remainingMeat });
  });
};
