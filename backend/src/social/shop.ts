/**
 * In-game shop: a small catalog of consumables + cosmetics purchasable
 * with DigiCredits. Seeded on server boot via `seedShopItems()`.
 *
 *   GET  /api/shop            → { items, inventory, credits }
 *   POST /api/shop/buy        → { itemId, qty? } — deduct credits, add to inventory
 *   POST /api/shop/apply      → { itemId, monId? } — spend 1 item as a pending_buff
 *                                (hp_pct / en_pct target a specific mon; xp_mult
 *                                 is player-wide and consumed on next win)
 *   POST /api/shop/use        → deprecated no-op decrement; kept for backwards compat
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type InventoryRow, type RosterRow, type ShopItemRow, type WalletRow } from '../db/index.js';
import { findTemplate, loadCatalog } from '../digimon/xml.js';
import { scaleStatsForLevel } from '../digimon/element.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { addPendingBuff, type BuffKind } from './buffs.js';

// ============================================================================
// SQL
// ============================================================================
const SQL_SELECT_ITEMS = `SELECT * FROM shop_items WHERE enabled = 1 ORDER BY price_credits ASC`;
const SQL_SELECT_PRODUCTS = `SELECT * FROM shop_items WHERE enabled = 1 AND class = 'product' ORDER BY price_credits ASC`;
const SQL_SELECT_ITEM = `SELECT * FROM shop_items WHERE id = ? AND enabled = 1`;
const SQL_INSERT_ITEM = `INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING`;
const SQL_SELECT_INVENTORY = `SELECT i.user_id, i.item_id, i.qty, i.updated_at, s.name, s.description
     FROM player_inventory i JOIN shop_items s ON s.id = i.item_id
     WHERE i.user_id = ? ORDER BY s.name`;
const SQL_SELECT_INVENTORY_ITEMS = `SELECT i.user_id, i.item_id, i.qty, i.updated_at, s.name, s.description, s.class
     FROM player_inventory i JOIN shop_items s ON s.id = i.item_id
     WHERE i.user_id = ? AND s.class = 'item' AND i.qty > 0 ORDER BY s.name`;
const SQL_SELECT_INVENTORY_ITEM = `SELECT * FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_UPSERT_INVENTORY = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= ?`;
const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_UPDATE_WALLET_CREDITS = `UPDATE player_wallet SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?`;
const SQL_INSERT_TRAINING_BUILDING = `INSERT INTO farm_buildings (id, user_id, kind, building_type, resource, level, rate_per_hour, capacity, produced, last_touch, upgrade_cost, created_at) VALUES (?, ?, ?, ?, 'Meat', 1, 1, 1, 0, ?, ?, ?)`;
const SQL_SELECT_ROSTER_MON = `SELECT id, user_id FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_ROSTER_MON_FULL = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_CURRENT_HPEN = `UPDATE player_roster SET current_hp = ?, current_en = ?, updated_at = ? WHERE id = ?`;

// ============================================================================
// Seed items
// ============================================================================
const SEED_ITEMS: Array<Omit<ShopItemRow, 'created_at' | 'enabled' | 'is_quest_item'>> = [
  {
    id: 'itm-heal-small',
    name: 'Small Med-Kit',
    description: 'Restore 40% HP to one Digimon in combat (PVE only).',
    price_credits: 80,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ heal_pct: 0.4 }),
  },
  {
    id: 'itm-heal-large',
    name: 'Large Med-Kit',
    description: 'Restore all HP to one Digimon in combat (PVE only).',
    price_credits: 220,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ heal_pct: 1.0 }),
  },
  {
    id: 'itm-digi-revive',
    name: 'Digi-Revive',
    description: 'Instantly wake a fallen Digimon from its recovery timer. Use from the roster page.',
    price_credits: 400,
    kind: 'revive',
    class: 'item',
    payload: JSON.stringify({ revive: true }),
  },
  {
    id: 'itm-energy-drink',
    name: 'Energy Drink',
    description: 'Refill EN to full on one Digimon in combat (PVE only).',
    price_credits: 120,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ en_pct: 1.0 }),
  },
  {
    id: 'itm-provision',
    name: 'Provision',
    description: 'Trail rations for an expedition. Consumed at 10/hour to keep an adventuring party fed and healed on the road.',
    price_credits: 20,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ provision: true }),
  },
  {
    id: 'itm-xp-boost',
    name: 'Focus Chip',
    description: 'Doubles XP from your next match win.',
    price_credits: 340,
    kind: 'consumable',
    class: 'product',
    payload: JSON.stringify({ xp_mult: 2.0, matches: 1 }),
  },
  {
    id: 'itm-cos-badge-gold',
    name: 'Gold Badge',
    description: 'A shiny gold badge that appears next to your name in the lobby.',
    price_credits: 900,
    kind: 'cosmetic',
    class: 'product',
    payload: JSON.stringify({ badge: 'gold' }),
  },
  {
    id: 'itm-digi-chip-champion',
    name: 'Champion Chip',
    description: 'Digivolve a Rookie into a Champion. Requires level 20.',
    price_credits: 500,
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Champion' }),
  },
  {
    id: 'itm-digi-chip-ultimate',
    name: 'Ultimate Chip',
    description: 'Digivolve a Champion into an Ultimate. Requires level 40.',
    price_credits: 1500,
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Ultimate' }),
  },
  {
    id: 'itm-digi-chip-mega',
    name: 'Mega Chip',
    description: 'Digivolve an Ultimate into a Mega. Requires level 60.',
    price_credits: 4000,
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Mega' }),
  },
  {
    id: 'itm-training-station',
    name: 'Training Station',
    description: 'A single-slot facility. Trains one stat at a time. Auto-placed on purchase.',
    price_credits: 500,
    kind: 'building_placement',
    class: 'product',
    payload: JSON.stringify({ buildingType: 'training', kind: 'Training Station' }),
  },
  {
    id: 'itm-training-station-premium',
    name: 'Premium Training Station',
    description: 'Trains two stats simultaneously. Auto-placed on purchase.',
    price_credits: 2000,
    kind: 'building_placement',
    class: 'product',
    payload: JSON.stringify({ buildingType: 'training_premium', kind: 'Premium Training Station' }),
  },
  {
    id: 'itm-status-cure',
    name: 'Status Cure',
    description: 'Removes all ailments (burn/poison/weaken/freeze/stun/sleep) from one Digimon in combat (PVE only).',
    price_credits: 160,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ clear_ailments: true }),
  },
  {
    id: 'itm-atk-buff',
    name: 'Power Chip',
    description: '+15 ATK for one Digimon for the rest of the current match (PVE only).',
    price_credits: 200,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ atk_bonus: 15 }),
  },
  {
    id: 'itm-def-buff',
    name: 'Guard Chip',
    description: '+15 DEF for one Digimon for the rest of the current match (PVE only).',
    price_credits: 200,
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ def_bonus: 15 }),
  },
];

/** Called once at server boot. Idempotent (ON CONFLICT DO NOTHING). */
export async function seedShopItems(): Promise<void> {
  const now = Date.now();
  await tx(async (t) => {
    for (const item of SEED_ITEMS) {
      await t.run(SQL_INSERT_ITEM, [item.id, item.name, item.description, item.price_credits, item.kind, item.class, item.payload, now]);
    }
  });
  log.info('shop.seed.ok', { items: SEED_ITEMS.length });
}

/** Custom item creation for the admin (kept internal — no HTTP route yet). */
export async function insertCustomItem(input: {
  name: string;
  description: string;
  priceCredits: number;
  kind: string;
  class: 'product' | 'item';
  payload: object;
}): Promise<string> {
  const id = newId('itm');
  await run(
    SQL_INSERT_ITEM,
    id,
    input.name,
    input.description,
    input.priceCredits,
    input.kind,
    input.class,
    JSON.stringify(input.payload),
    Date.now(),
  );
  return id;
}

// ============================================================================
// Input schemas + effect decoder
// ============================================================================
const BuySchema = z.object({ itemId: z.string().min(3), qty: z.number().int().min(1).max(99).default(1) });
const UseSchema = z.object({ itemId: z.string().min(3), qty: z.number().int().min(1).max(99).default(1) });
const ApplySchema = z.object({ itemId: z.string().min(3), monId: z.string().min(3).optional() });

type EffectDecoded =
  | { kind: 'hp_pct'; magnitude: number; requiresMon: true }
  | { kind: 'en_pct'; magnitude: number; requiresMon: true }
  | { kind: 'xp_mult'; magnitude: number; requiresMon: false }
  | { kind: null; magnitude: 0; requiresMon: false };

function decodeItemEffect(payloadJson: string): EffectDecoded {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return { kind: null, magnitude: 0, requiresMon: false };
  }
  if (typeof payload.heal_pct === 'number' && payload.heal_pct > 0) {
    return { kind: 'hp_pct', magnitude: payload.heal_pct, requiresMon: true };
  }
  if (typeof payload.en_pct === 'number' && payload.en_pct > 0) {
    return { kind: 'en_pct', magnitude: payload.en_pct, requiresMon: true };
  }
  if (typeof payload.xp_mult === 'number' && payload.xp_mult > 1) {
    return { kind: 'xp_mult', magnitude: payload.xp_mult, requiresMon: false };
  }
  return { kind: null, magnitude: 0, requiresMon: false };
}

// ============================================================================
// Plugin
// ============================================================================
type InventoryJoinRow = InventoryRow & { name: string; description: string };

export const shopPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/shop', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const products = await q<ShopItemRow>(SQL_SELECT_PRODUCTS);
    const inv = await q<InventoryJoinRow>(SQL_SELECT_INVENTORY, me.id);
    const wallet = await one<WalletRow>(SQL_SELECT_WALLET, me.id);
    return reply.send({
      products: products.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        priceCredits: i.price_credits,
        kind: i.kind,
        class: i.class,
      })),
      inventory: inv.map((i) => ({ itemId: i.item_id, name: i.name, description: i.description, qty: i.qty })),
      credits: wallet?.credits ?? 0,
    });
  });

  app.get('/api/items', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const items = await q<InventoryJoinRow & { class?: string }>(SQL_SELECT_INVENTORY_ITEMS, me.id);
    return reply.send({
      items: items.map((i) => ({ itemId: i.item_id, name: i.name, description: i.description, qty: i.qty })),
    });
  });

  app.post('/api/shop/buy', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = BuySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const item = await one<ShopItemRow>(SQL_SELECT_ITEM, parsed.data.itemId);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    if (item.class !== 'product') {
      return reply.code(403).send({ error: 'not-a-product', message: 'Items are earned from PVE drops or farm crafting, not purchased.' });
    }
    const total = item.price_credits * parsed.data.qty;
    const wallet = await one<WalletRow>(SQL_SELECT_WALLET, me.id);
    const credits = wallet?.credits ?? 0;
    if (credits < total) return reply.code(402).send({ error: 'insufficient credits', needed: total - credits });
    const now = Date.now();
    try {
      await tx(async (t) => {
        const info = await t.run(SQL_UPDATE_WALLET_CREDITS, [total, now, me.id, total]);
        if (info.changes === 0) throw new Error('credit deduction race');
        if (item.kind === 'building_placement') {
          let payload: { buildingType?: string; kind?: string } = {};
          try { payload = JSON.parse(item.payload) as { buildingType?: string; kind?: string }; } catch {}
          const buildingType = payload.buildingType === 'training_premium' ? 'training_premium' : 'training';
          const kind = payload.kind ?? 'Training Station';
          for (let i = 0; i < parsed.data.qty; i++) {
            await t.run(SQL_INSERT_TRAINING_BUILDING, [
              newId('bld'), me.id, kind, buildingType, now, item.price_credits, now,
            ]);
          }
        } else {
          await t.run(SQL_UPSERT_INVENTORY, [me.id, item.id, parsed.data.qty, now]);
        }
      });
    } catch {
      return reply.code(409).send({ error: 'purchase conflicted — try again' });
    }
    log.info('shop.buy', { userId: me.id, itemId: item.id, qty: parsed.data.qty, spent: total });
    return reply.send({ ok: true, credits: credits - total });
  });

  app.post('/api/shop/use', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = UseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const owned = await one<InventoryRow>(SQL_SELECT_INVENTORY_ITEM, me.id, parsed.data.itemId);
    if (!owned || owned.qty < parsed.data.qty) {
      return reply.code(409).send({ error: 'not enough of that item' });
    }
    const info = await run(SQL_DECREMENT_INVENTORY, parsed.data.qty, Date.now(), me.id, parsed.data.itemId, parsed.data.qty);
    if (info.changes === 0) {
      return reply.code(409).send({ error: 'consume failed — refresh inventory' });
    }
    return reply.send({ ok: true });
  });

  app.post('/api/shop/apply', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = ApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const { itemId, monId } = parsed.data;

    const item = await one<ShopItemRow>(SQL_SELECT_ITEM, itemId);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const decoded = decodeItemEffect(item.payload);
    if (decoded.kind === null) {
      return reply.code(400).send({ error: 'this item has no combat effect (cosmetic only)' });
    }
    if (decoded.requiresMon && !monId) {
      return reply.code(400).send({ error: 'this item must target a Digimon (monId required)' });
    }
    if (monId) {
      const mon = await one<{ id: string; user_id: string }>(SQL_SELECT_ROSTER_MON, monId, me.id);
      if (!mon) return reply.code(404).send({ error: 'that Digimon is not on your roster' });
    }

    const owned = await one<InventoryRow>(SQL_SELECT_INVENTORY_ITEM, me.id, itemId);
    if (!owned || owned.qty < 1) return reply.code(409).send({ error: 'you do not own that item' });

    const targetMonId: string | null = decoded.requiresMon ? monId ?? null : null;
    const effectKind: BuffKind = decoded.kind;

    try {
      if ((decoded.kind === 'hp_pct' || decoded.kind === 'en_pct') && monId) {
        const monRow = await one<RosterRow>(SQL_SELECT_ROSTER_MON_FULL, monId, me.id);
        if (!monRow) return reply.code(404).send({ error: 'that Digimon is not on your roster' });
        const now = Date.now();
        if (monRow.revive_at !== null && monRow.revive_at > now) {
          return reply.code(409).send({ error: 'mon-downed', message: 'This Digimon is downed. Use a Digi-Revive from the roster page first.' });
        }
        const catalog = loadCatalog();
        const tpl = findTemplate(catalog, monRow.catalog_id);
        if (!tpl) return reply.code(500).send({ error: 'catalog template missing' });
        const scaled = scaleStatsForLevel(tpl.baseStats, monRow.level, {
          hp: monRow.hp_bonus,
          en: monRow.en_bonus,
          atk: monRow.atk_bonus,
          def: monRow.def_bonus,
          int: monRow.int_bonus,
          spd: monRow.spd_bonus,
        });
        const curHp = monRow.current_hp ?? scaled.hp;
        const curEn = monRow.current_en ?? scaled.en;
        let newHp = curHp;
        let newEn = curEn;
        if (decoded.kind === 'hp_pct') {
          newHp = Math.min(scaled.hp, curHp + Math.round(scaled.hp * decoded.magnitude));
        } else {
          newEn = Math.min(scaled.en, curEn + Math.round(scaled.en * decoded.magnitude));
        }
        await tx(async (t) => {
          const info = await t.run(SQL_DECREMENT_INVENTORY, [1, now, me.id, itemId, 1]);
          if (info.changes === 0) throw new Error('race');
          await t.run(SQL_UPDATE_CURRENT_HPEN, [newHp, newEn, now, monId]);
        });
      } else {
        await tx(async (t) => {
          const info = await t.run(SQL_DECREMENT_INVENTORY, [1, Date.now(), me.id, itemId, 1]);
          if (info.changes === 0) throw new Error('race');
        });
        await addPendingBuff({
          userId: me.id,
          monId: targetMonId,
          effectKind,
          magnitude: decoded.magnitude,
          sourceItem: itemId,
        });
      }
    } catch {
      return reply.code(409).send({ error: 'apply conflicted — try again' });
    }
    log.info('shop.apply', { userId: me.id, itemId, effectKind, monId: targetMonId });
    return reply.send({
      ok: true,
      applied: { effectKind, magnitude: decoded.magnitude, monId: targetMonId },
    });
  });
};
