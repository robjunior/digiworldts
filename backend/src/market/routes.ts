import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type MarketListingRow, type RosterRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import type { TemplateDigimon } from '../digimon/types.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const MIN_PRICE = 10;
const MAX_PRICE = 1_000_000;
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 60;
const MIN_LEVEL_TO_LIST = 1;

const SQL_SELECT_MON_BY_ID = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_LISTING_BY_ID = `SELECT * FROM market_listings WHERE id = ?`;
const SQL_INSERT_LISTING = `INSERT INTO market_listings (id, mon_id, seller_id, price_credits, listed_at) VALUES (?, ?, ?, ?, ?)`;
const SQL_MARK_LISTING_CANCELED = `UPDATE market_listings SET canceled_at = ? WHERE id = ? AND sold_at IS NULL AND canceled_at IS NULL`;
const SQL_MARK_LISTING_SOLD = `UPDATE market_listings SET sold_at = ?, sold_to = ? WHERE id = ? AND sold_at IS NULL AND canceled_at IS NULL`;
const SQL_SET_MON_LISTED = `UPDATE player_roster SET listed_at = ?, status = 'resting', slot_index = NULL, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_UNLIST_MON = `UPDATE player_roster SET listed_at = NULL, updated_at = ? WHERE id = ?`;
const SQL_TRANSFER_MON = `UPDATE player_roster SET user_id = ?, listed_at = NULL, status = 'resting', slot_index = NULL, equipped_skill_ids = NULL, evolution_history = NULL, updated_at = ? WHERE id = ?`;
const SQL_SELECT_WALLET = `SELECT credits FROM player_wallet WHERE user_id = ?`;
const SQL_UPSERT_WALLET_CREDIT = `INSERT INTO player_wallet (user_id, credits, streak_day, last_claim_at, premium_until, updated_at) VALUES (?, ?, 0, NULL, NULL, ?) ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at`;
const SQL_DEDUCT_WALLET = `UPDATE player_wallet SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?`;
const SQL_SELECT_ACTIVE_MARKET = `
  SELECT l.id AS listing_id, l.price_credits, l.listed_at, l.seller_id,
         m.id AS mon_id, m.catalog_id, m.nickname, m.level, m.xp,
         m.hp_bonus, m.en_bonus, m.atk_bonus, m.def_bonus, m.int_bonus, m.spd_bonus, m.mood,
         u.display_name AS seller_name
    FROM market_listings l
    JOIN player_roster m ON m.id = l.mon_id
    JOIN users u ON u.id = l.seller_id
   WHERE l.sold_at IS NULL AND l.canceled_at IS NULL
`;
const SQL_SELECT_MY_LISTINGS = `
  SELECT l.id AS listing_id, l.price_credits, l.listed_at, l.sold_at, l.canceled_at, l.sold_to,
         m.id AS mon_id, m.catalog_id, m.nickname, m.level, m.hp_bonus, m.en_bonus,
         m.atk_bonus, m.def_bonus, m.int_bonus, m.spd_bonus
    FROM market_listings l
    JOIN player_roster m ON m.id = l.mon_id
   WHERE l.seller_id = ?
   ORDER BY l.listed_at DESC
`;

type MarketRowJoined = {
  listing_id: string;
  price_credits: number;
  listed_at: number;
  seller_id: string;
  seller_name: string;
  mon_id: string;
  catalog_id: string;
  nickname: string;
  level: number;
  xp: number;
  hp_bonus: number;
  en_bonus: number;
  atk_bonus: number;
  def_bonus: number;
  int_bonus: number;
  spd_bonus: number;
  mood: number;
};

type MarketListingView = {
  listingId: string;
  monId: string;
  catalogId: string;
  nickname: string;
  level: number;
  xp: number;
  mood: number;
  statBonus: { hp: number; en: number; atk: number; def: number; int: number; spd: number };
  price: number;
  listedAt: number;
  seller: { id: string; displayName: string };
  isMine: boolean;
  template: TemplateDigimon | null;
};

type MyListingView = {
  listingId: string;
  monId: string;
  catalogId: string;
  nickname: string;
  level: number;
  price: number;
  listedAt: number;
  status: 'active' | 'sold' | 'canceled';
  soldAt: number | null;
  soldTo: string | null;
  template: TemplateDigimon | null;
};

const BrowseSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
  stage: z.string().optional(),
  element: z.string().optional(),
  minLevel: z.coerce.number().int().min(1).optional(),
  maxLevel: z.coerce.number().int().max(99).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().max(MAX_PRICE).optional(),
  q: z.string().trim().max(48).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'level_desc']).default('newest'),
});

const ListSchema = z.object({
  monId: z.string().min(3),
  price: z.number().int().min(MIN_PRICE).max(MAX_PRICE),
});

export const marketPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/market', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = BrowseSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-query', details: parsed.error.issues });
    }
    const { page, perPage, stage, element, minLevel, maxLevel, minPrice, maxPrice, q: search, sort } = parsed.data;

    const conds: string[] = [];
    const params: unknown[] = [];
    if (minPrice != null) { conds.push('l.price_credits >= ?'); params.push(minPrice); }
    if (maxPrice != null) { conds.push('l.price_credits <= ?'); params.push(maxPrice); }
    if (minLevel != null) { conds.push('m.level >= ?'); params.push(minLevel); }
    if (maxLevel != null) { conds.push('m.level <= ?'); params.push(maxLevel); }
    if (search) { conds.push('LOWER(m.nickname) LIKE LOWER(?)'); params.push(`%${search}%`); }

    const sqlBase = SQL_SELECT_ACTIVE_MARKET + (conds.length ? ' AND ' + conds.join(' AND ') : '');
    const rows = await q<MarketRowJoined>(sqlBase, ...params);

    const catalog = loadCatalog();
    const templateById = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) templateById.set(t.id, t);

    const enriched: MarketListingView[] = rows
      .map((row) => {
        const template = templateById.get(row.catalog_id) ?? null;
        return {
          listingId: row.listing_id,
          monId: row.mon_id,
          catalogId: row.catalog_id,
          nickname: row.nickname,
          level: row.level,
          xp: row.xp,
          mood: row.mood,
          statBonus: {
            hp: row.hp_bonus, en: row.en_bonus, atk: row.atk_bonus,
            def: row.def_bonus, int: row.int_bonus, spd: row.spd_bonus,
          },
          price: row.price_credits,
          listedAt: row.listed_at,
          seller: { id: row.seller_id, displayName: row.seller_name },
          isMine: row.seller_id === user.id,
          template,
        };
      })
      .filter((v) => {
        if (stage && v.template?.stage !== stage) return false;
        if (element && v.template?.element !== element) return false;
        return true;
      });

    switch (sort) {
      case 'price_asc':  enriched.sort((a, b) => a.price - b.price); break;
      case 'price_desc': enriched.sort((a, b) => b.price - a.price); break;
      case 'level_desc': enriched.sort((a, b) => b.level - a.level); break;
      case 'newest':
      default:           enriched.sort((a, b) => b.listedAt - a.listedAt); break;
    }

    const total = enriched.length;
    const start = (page - 1) * perPage;
    const items = enriched.slice(start, start + perPage);
    return reply.send({ items, total, page, perPage, sort });
  });

  app.get('/api/market/mine', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const rows = await q<{
      listing_id: string; price_credits: number; listed_at: number;
      sold_at: number | null; canceled_at: number | null; sold_to: string | null;
      mon_id: string; catalog_id: string; nickname: string; level: number;
      hp_bonus: number; en_bonus: number; atk_bonus: number;
      def_bonus: number; int_bonus: number; spd_bonus: number;
    }>(SQL_SELECT_MY_LISTINGS, user.id);
    const catalog = loadCatalog();
    const templateById = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) templateById.set(t.id, t);
    const listings: MyListingView[] = rows.map((row) => ({
      listingId: row.listing_id,
      monId: row.mon_id,
      catalogId: row.catalog_id,
      nickname: row.nickname,
      level: row.level,
      price: row.price_credits,
      listedAt: row.listed_at,
      status: row.sold_at ? 'sold' : row.canceled_at ? 'canceled' : 'active',
      soldAt: row.sold_at,
      soldTo: row.sold_to,
      template: templateById.get(row.catalog_id) ?? null,
    }));
    return reply.send({ listings });
  });

  app.post('/api/market/list', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = ListSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    }
    const { monId, price } = parsed.data;
    const mon = await one<RosterRow>(SQL_SELECT_MON_BY_ID, monId, user.id);
    if (!mon) return reply.code(404).send({ error: 'mon-not-found' });
    if (mon.listed_at !== null) {
      return reply.code(409).send({ error: 'already-listed', message: 'This Digimon is already on the market.' });
    }
    if (mon.status === 'party') {
      return reply.code(409).send({ error: 'in-party', message: 'Remove this Digimon from your party first.' });
    }
    if (mon.status === 'training') {
      return reply.code(409).send({ error: 'in-training', message: 'End the training session first.' });
    }
    const now = Date.now();
    if (mon.revive_at !== null && mon.revive_at > now) {
      return reply.code(409).send({ error: 'downed', message: 'This Digimon is recovering. Wait or revive first.' });
    }
    if (mon.level < MIN_LEVEL_TO_LIST) {
      return reply.code(409).send({ error: 'level-too-low', message: `Digimon must be at least level ${MIN_LEVEL_TO_LIST}.` });
    }

    const listingId = newId('mkt');
    await tx(async (t) => {
      await t.run(SQL_INSERT_LISTING, [listingId, monId, user.id, price, now]);
      await t.run(SQL_SET_MON_LISTED, [now, now, monId, user.id]);
    });
    log.info('market.list.ok', { userId: user.id, monId, listingId, price });
    return reply.code(201).send({ ok: true, listingId, monId, price });
  });

  app.post<{ Params: { listingId: string } }>('/api/market/cancel/:listingId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const listing = await one<MarketListingRow>(SQL_SELECT_LISTING_BY_ID, req.params.listingId);
    if (!listing) return reply.code(404).send({ error: 'listing-not-found' });
    if (listing.seller_id !== user.id) return reply.code(403).send({ error: 'not-your-listing' });
    if (listing.sold_at !== null) return reply.code(409).send({ error: 'already-sold' });
    if (listing.canceled_at !== null) return reply.code(409).send({ error: 'already-canceled' });

    const now = Date.now();
    await tx(async (t) => {
      const res = await t.run(SQL_MARK_LISTING_CANCELED, [now, listing.id]);
      if (res.changes === 0) throw new Error('race: listing state changed');
      await t.run(SQL_UNLIST_MON, [now, listing.mon_id]);
    });
    log.info('market.cancel.ok', { userId: user.id, listingId: listing.id, monId: listing.mon_id });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { listingId: string } }>('/api/market/buy/:listingId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const listing = await one<MarketListingRow>(SQL_SELECT_LISTING_BY_ID, req.params.listingId);
    if (!listing) return reply.code(404).send({ error: 'listing-not-found' });
    if (listing.sold_at !== null) return reply.code(409).send({ error: 'already-sold' });
    if (listing.canceled_at !== null) return reply.code(409).send({ error: 'already-canceled' });
    if (listing.seller_id === user.id) return reply.code(409).send({ error: 'cannot-buy-own' });

    const wallet = await one<{ credits: number }>(SQL_SELECT_WALLET, user.id);
    const buyerCredits = wallet?.credits ?? 0;
    if (buyerCredits < listing.price_credits) {
      return reply.code(402).send({ error: 'insufficient-credits', message: `Need ${listing.price_credits} DigiCredits (you have ${buyerCredits}).` });
    }

    const now = Date.now();
    let raced = false;
    await tx(async (t) => {
      const dec = await t.run(SQL_DEDUCT_WALLET, [listing.price_credits, now, user.id, listing.price_credits]);
      if (dec.changes === 0) { raced = true; return; }
      const sold = await t.run(SQL_MARK_LISTING_SOLD, [now, user.id, listing.id]);
      if (sold.changes === 0) { raced = true; return; }
      await t.run(SQL_UPSERT_WALLET_CREDIT, [listing.seller_id, listing.price_credits, now]);
      await t.run(SQL_TRANSFER_MON, [user.id, now, listing.mon_id]);
    });
    if (raced) {
      return reply.code(409).send({ error: 'race', message: 'Listing state changed. Refresh and try again.' });
    }
    log.info('market.buy.ok', {
      buyerId: user.id, sellerId: listing.seller_id,
      listingId: listing.id, monId: listing.mon_id, price: listing.price_credits,
    });
    return reply.send({ ok: true, monId: listing.mon_id, price: listing.price_credits });
  });
};
