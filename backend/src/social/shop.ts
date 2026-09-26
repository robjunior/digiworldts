/**
 * In-game shop: a small catalog of consumables + cosmetics purchasable
 * with Credits (premium) or NetCore (earned). Seeded on server boot via `seedShopItems()`.
 *
 *   GET  /api/shop            → { featured, quick, catalog, categories, wallet, inventory }
 *   POST /api/shop/buy        → { itemId, qty } — deduct currency, add to inventory
 *   POST /api/shop/apply      → { itemId, monId? } — spend 1 item as a pending_buff
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
import { rarityFromRankOrCommon } from '@digiworld/shared/item-rarity';
import { grantTeamSlots, BASE_TEAM_LIMIT, MAX_TEAM_LIMIT } from '../teams/engine.js';

// ============================================================================
// SQL
// ============================================================================
const SQL_SELECT_ITEMS = `SELECT * FROM shop_items WHERE enabled = 1 AND status = 'published' ORDER BY sort_order ASC, name ASC`;
const SQL_SELECT_PRODUCTS = `SELECT * FROM shop_items WHERE enabled = 1 AND status = 'published' AND class = 'product' ORDER BY sort_order ASC, name ASC`;
const SQL_SELECT_ITEM = `SELECT * FROM shop_items WHERE id = ? AND enabled = 1 AND status = 'published'`;
const SQL_INSERT_ITEM = `INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, rarity, item_type, drop_pool, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`;
const SQL_SELECT_INVENTORY = `SELECT i.user_id, i.item_id, i.qty, i.updated_at, s.name, s.description, s.rarity
     FROM player_inventory i JOIN shop_items s ON s.id = i.item_id
     WHERE i.user_id = ? ORDER BY s.name`;
const SQL_SELECT_INVENTORY_ITEMS = `SELECT i.user_id, i.item_id, i.qty, i.updated_at, s.name, s.description, s.class, s.rarity
     FROM player_inventory i JOIN shop_items s ON s.id = i.item_id
     WHERE i.user_id = ? AND s.class = 'item' AND i.qty > 0 ORDER BY s.name`;
const SQL_SELECT_INVENTORY_ITEM = `SELECT * FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_UPSERT_INVENTORY = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= ?`;
const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_UPDATE_WALLET_CREDITS = `UPDATE player_wallet SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?`;
const SQL_UPDATE_WALLET_NETCORE = `UPDATE player_wallet SET netcore = netcore - ?, updated_at = ? WHERE user_id = ? AND netcore >= ?`;
const SQL_INSERT_TRAINING_BUILDING = `INSERT INTO farm_buildings (id, user_id, kind, building_type, resource, level, rate_per_hour, capacity, produced, last_touch, upgrade_cost, created_at) VALUES (?, ?, ?, ?, 'Meat', 1, 1, 1, 0, ?, ?, ?)`;
const SQL_SELECT_ROSTER_MON = `SELECT id, user_id FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_ROSTER_MON_FULL = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_CURRENT_HPEN = `UPDATE player_roster SET current_hp = ?, current_en = ?, updated_at = ? WHERE id = ?`;
const SQL_INSERT_SHOP_PURCHASE = `INSERT INTO player_shop_purchases (user_id, item_id, purchased_at)
SELECT ?, id, ? FROM shop_items
WHERE id = ? AND enabled = 1 AND status = 'published' AND class = 'product' AND one_time = 1
ON CONFLICT(user_id, item_id) DO NOTHING`;
const SQL_SELECT_PURCHASES = `SELECT item_id FROM player_shop_purchases WHERE user_id = ?`;
const SQL_GRANT_PREMIUM = `UPDATE player_wallet SET premium_until = ?, updated_at = ? WHERE user_id = ?`;

const SQL_SELECT_BUNDLES = `SELECT * FROM shop_bundles WHERE enabled = 1 ORDER BY sort_order ASC, name ASC`;
const SQL_SELECT_BUNDLE = `SELECT * FROM shop_bundles WHERE id = ? AND enabled = 1`;
const SQL_SELECT_BUNDLE_ITEMS = `SELECT bi.bundle_id, bi.item_id, bi.qty, bi.sort_order,
       s.name, s.description, s.price, s.currency, s.kind, s.class, s.payload, s.shop_category
  FROM shop_bundle_items bi
  JOIN shop_items s ON s.id = bi.item_id
 WHERE bi.bundle_id = ? AND s.enabled = 1 AND s.status = 'published'
 ORDER BY bi.sort_order ASC, s.name ASC`;

type BundleRow = {
  id: string;
  name: string;
  description: string;
  currency: string;
  discount_pct: number;
  shop_category: string;
  sort_order: number;
  featured: number;
  quick_offer: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

type BundleItemJoinRow = {
  bundle_id: string;
  item_id: string;
  qty: number;
  sort_order: number;
  name: string;
  description: string;
  price: number;
  currency: string;
  kind: string;
  class: string;
  payload: string;
  shop_category: string;
};

type BundleItemView = {
  itemId: string;
  name: string;
  description: string;
  qty: number;
  unitPrice: number;
  sprite: string | null;
  mono: string | null;
};

type BundleView = {
  id: string;
  name: string;
  description: string;
  currency: string;
  discountPct: number;
  shopCategory: string;
  featured: boolean;
  quickOffer: boolean;
  items: BundleItemView[];
  originalPrice: number;
  discountedPrice: number;
  savings: number;
};

function bundlePriceFromItems(items: readonly { price: number; qty: number }[], discountPct: number): { originalPrice: number; discountedPrice: number } {
  const originalPrice = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const clamped = Math.max(0, Math.min(100, discountPct));
  const discountedPrice = Math.max(0, Math.round(originalPrice * (1 - clamped / 100)));
  return { originalPrice, discountedPrice };
}

async function loadBundlesForShop(): Promise<BundleView[]> {
  const bundles = await q<BundleRow>(SQL_SELECT_BUNDLES);
  const result: BundleView[] = [];
  for (const b of bundles) {
    const items = await q<BundleItemJoinRow>(SQL_SELECT_BUNDLE_ITEMS, b.id);
    if (items.length === 0) continue;
    const itemViews: BundleItemView[] = items.map((it) => {
      let payload: { sprite?: string; mono?: string } = {};
      try { payload = JSON.parse(it.payload) as { sprite?: string; mono?: string }; } catch {}
      return {
        itemId: it.item_id,
        name: it.name,
        description: it.description,
        qty: it.qty,
        unitPrice: it.price,
        sprite: payload.sprite ?? null,
        mono: payload.mono ?? null,
      };
    });
    const { originalPrice, discountedPrice } = bundlePriceFromItems(items, b.discount_pct);
    result.push({
      id: b.id,
      name: b.name,
      description: b.description,
      currency: b.currency,
      discountPct: b.discount_pct,
      shopCategory: b.shop_category,
      featured: b.featured === 1,
      quickOffer: b.quick_offer === 1,
      items: itemViews,
      originalPrice,
      discountedPrice,
      savings: originalPrice - discountedPrice,
    });
  }
  return result;
}

// ============================================================================
// Seed items
// ============================================================================
type SeedItem = Omit<ShopItemRow, 'created_at' | 'enabled' | 'is_quest_item' | 'rarity'> & {
  currency?: string;
  price?: number;
  shop_category?: string;
  featured?: number;
  quick_offer?: number;
  one_time?: number;
  sort_order?: number;
  rarity?: number;
  item_type?: string;
  drop_pool?: string | null;
};

const SEED_ITEMS: Array<SeedItem> = [
  {
    id: 'itm-heal-small',
    name: 'Small Med-Kit',
    description: 'Restore 40% HP to one Digimon in combat (PVE only).',
    price_credits: 80,
    price: 80,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ heal_pct: 0.4 }),
  },
  {
    id: 'itm-heal-large',
    name: 'Large Med-Kit',
    description: 'Restore all HP to one Digimon in combat (PVE only).',
    price_credits: 220,
    price: 220,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ heal_pct: 1.0 }),
  },
  {
    id: 'itm-digi-revive',
    name: 'Digi-Revive',
    description: 'Instantly wake a fallen Digimon from its recovery timer. Use from the roster page.',
    price_credits: 400,
    price: 400,
    currency: 'credits',
    kind: 'revive',
    class: 'item',
    payload: JSON.stringify({ revive: true }),
  },
  {
    id: 'itm-extraction-scroll',
    name: 'Extraction Scroll',
    description: 'Teleport out of any dungeon instantly with your stash intact. Cannot be used during combat. Very expensive to craft.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'ticket',
    class: 'item',
    payload: JSON.stringify({ extract_dungeon: true }),
    rarity: 3,
    item_type: 'extraction',
  },
  {
    id: 'itm-energy-drink',
    name: 'Energy Drink',
    description: 'Refill EN to full on one Digimon in combat (PVE only).',
    price_credits: 120,
    price: 120,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ en_pct: 1.0 }),
  },
  {
    id: 'itm-provision',
    name: 'Provision',
    description: 'Trail rations for an expedition. Consumed at 10/hour to keep an adventuring party fed and healed on the road.',
    price_credits: 20,
    price: 20,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ provision: true }),
  },
  {
    id: 'itm-xp-boost',
    name: 'Focus Chip',
    description: 'Doubles XP from your next match win.',
    price_credits: 340,
    price: 340,
    currency: 'credits',
    kind: 'consumable',
    class: 'product',
    payload: JSON.stringify({ xp_mult: 2.0, matches: 1 }),
  },
  {
    id: 'itm-cos-badge-gold',
    name: 'Gold Badge',
    description: 'A shiny gold badge that appears next to your name in the lobby.',
    price_credits: 900,
    price: 900,
    currency: 'credits',
    kind: 'cosmetic',
    class: 'product',
    payload: JSON.stringify({ badge: 'gold' }),
  },
  {
    id: 'itm-digi-chip-champion',
    name: 'Champion Chip',
    description: 'Digivolve a Rookie into a Champion. Requires level 20.',
    price_credits: 500,
    price: 500,
    currency: 'credits',
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Champion' }),
  },
  {
    id: 'itm-digi-chip-ultimate',
    name: 'Ultimate Chip',
    description: 'Digivolve a Champion into an Ultimate. Requires level 40.',
    price_credits: 1500,
    price: 1500,
    currency: 'credits',
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Ultimate' }),
  },
  {
    id: 'itm-digi-chip-mega',
    name: 'Mega Chip',
    description: 'Digivolve an Ultimate into a Mega. Requires level 60.',
    price_credits: 4000,
    price: 4000,
    currency: 'credits',
    kind: 'evolve',
    class: 'product',
    payload: JSON.stringify({ stage: 'Mega' }),
  },
  // Evolution-key items for the Starter Evolution booster packs (BT-06/07/08).
  // These are the exact items each evolution edge consumes (requiredItemId) —
  // the content-delivery lever: a digimon's evolution path is blocked until its
  // key item exists and is assigned to the edge in the catalog XML.
  {
    id: 'itm-evo-greymon',
    name: 'Greymon Evolution Key',
    description: 'A fire-forged key that unlocks Agumon’s evolution into Greymon. Consumed on evolution. Available in the Courage Ignition booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'greymon', target: 'skb-326' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 300,
  },
  {
    id: 'itm-evo-tyrannomon',
    name: 'Tyrannomon Evolution Key',
    description: 'A feral key that unlocks Agumon’s evolution into Tyrannomon. Consumed on evolution. Available in the Courage Ignition booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'tyrannomon', target: 'skb-363' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 301,
  },
  {
    id: 'itm-evo-garurumon',
    name: 'Garurumon Evolution Key',
    description: 'A howling key that unlocks Gabumon’s evolution into Garurumon. Consumed on evolution. Available in the Feral Howl booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'garurumon', target: 'skb-12' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 302,
  },
  {
    id: 'itm-evo-kyubimon',
    name: 'Kyubimon Evolution Key',
    description: 'A mystical key that unlocks Gabumon’s evolution into Kyubimon. Consumed on evolution. Available in the Feral Howl booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'kyubimon', target: 'skb-395' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 303,
  },
  {
    id: 'itm-evo-angemon',
    name: 'Angemon Evolution Key',
    description: 'A radiant key that unlocks Patamon’s evolution into Angemon. Consumed on evolution. Available in the Wings of Hope booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'angemon', target: 'skb-87' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 304,
  },
  {
    id: 'itm-evo-devimon',
    name: 'Devimon Evolution Key',
    description: 'A dark key that unlocks Patamon’s evolution into Devimon. Consumed on evolution. Available in the Wings of Hope booster pack.',
    price_credits: 2500,
    price: 2500,
    currency: 'credits',
    kind: 'evolve',
    class: 'item',
    payload: JSON.stringify({ evolution_key: 'devimon', target: 'skb-93' }),
    rarity: 1,
    item_type: 'evolution_key',
    shop_category: 'evolve',
    drop_pool: 'booster-items',
    sort_order: 305,
  },
  {
    id: 'itm-training-station',
    name: 'Training Station',
    description: 'A single-slot facility. Trains one stat at a time. Auto-placed on purchase.',
    price_credits: 500,
    price: 500,
    currency: 'credits',
    kind: 'building_placement',
    class: 'product',
    payload: JSON.stringify({ buildingType: 'training', kind: 'Training Station' }),
  },
  {
    id: 'itm-training-station-premium',
    name: 'Premium Training Station',
    description: 'Trains two stats simultaneously. Auto-placed on purchase.',
    price_credits: 2000,
    price: 2000,
    currency: 'credits',
    kind: 'building_placement',
    class: 'product',
    payload: JSON.stringify({ buildingType: 'training_premium', kind: 'Premium Training Station' }),
  },
  {
    id: 'itm-status-cure',
    name: 'Status Cure',
    description: 'Removes all ailments (burn/poison/weaken/freeze/stun/sleep) from one Digimon in combat (PVE only).',
    price_credits: 160,
    price: 160,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ clear_ailments: true }),
  },
  {
    id: 'itm-atk-buff',
    name: 'Power Chip',
    description: '+15 ATK for one Digimon for the rest of the current match (PVE only).',
    price_credits: 200,
    price: 200,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ atk_bonus: 15 }),
  },
  {
    id: 'itm-def-buff',
    name: 'Guard Chip',
    description: '+15 DEF for one Digimon for the rest of the current match (PVE only).',
    price_credits: 200,
    price: 200,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ def_bonus: 15 }),
  },
  {
    id: 'itm-quest-reward',
    name: 'Quest Reward',
    description: 'A token of achievement awarded for completing quests. Redeemable for goods at the shop.',
    price_credits: 10,
    price: 10,
    currency: 'credits',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ quest_reward: true }),
  },
  {
    id: 'itm-premium-7d',
    name: 'Premium · 7 days',
    description: '+50% production, XP and quest rewards for 7 days, plus auto-crafting and premium training stations.',
    price_credits: 1200,
    price: 1200,
    currency: 'credits',
    kind: 'premium',
    class: 'product',
    shop_category: 'premium',
    featured: 0,
    quick_offer: 0,
    payload: JSON.stringify({ premiumDays: 7 }),
    item_type: 'premium',
  },
  {
    id: 'itm-premium-30d',
    name: 'Premium · 30 days',
    description: '+50% production, XP and quest rewards for 30 days, plus auto-crafting and premium training stations.',
    price_credits: 4000,
    price: 4000,
    currency: 'credits',
    kind: 'premium',
    class: 'product',
    shop_category: 'premium',
    featured: 1,
    quick_offer: 1,
    payload: JSON.stringify({ premiumDays: 30 }),
    item_type: 'premium',
  },
  {
    id: 'itm-team-slot',
    name: 'Extra Team Slot',
    description: 'Adds +1 saved team slot on the Roster screen. Base limit is 3 teams (5 while Premium).',
    price_credits: 200,
    price: 200,
    currency: 'credits',
    kind: 'team_slot',
    class: 'product',
    shop_category: 'upgrade',
    payload: JSON.stringify({ team_slot: true }),
    item_type: 'team_slot',
    sort_order: 10,
  },
];

const ELEMENT_FAMILIES = ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'] as const;
const ATTRIBUTE_FAMILIES = ['vaccine', 'virus', 'data', 'free', 'unknown'] as const;
const FRAGMENT_FAMILIES: readonly string[] = [...ELEMENT_FAMILIES, ...ATTRIBUTE_FAMILIES];
const CYPHER_TIERS = [1, 2, 3] as const;
const RARITY_RANKS = [0, 1, 2, 3, 4] as const;
const RARITY_LABELS: Record<number, string> = { 0: 'Common', 1: 'Uncommon', 2: 'Rare', 3: 'Epic', 4: 'Legendary' };
const TIER_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' };
const FRAGMENT_BASE_PRICE = 40;
const CHIP_BASE_PRICE = 500;
const CYPHER_BASE_PRICE = 800;

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function generateFragmentItems(): SeedItem[] {
  const out: SeedItem[] = [];
  for (const family of FRAGMENT_FAMILIES) {
    for (const rarity of RARITY_RANKS) {
      const label = titleCase(family);
      const rlabel = RARITY_LABELS[rarity]!;
      const priceScale = 1 + rarity * 2;
      out.push({
        id: `itm-shard-${family}-r${rarity}`,
        name: `${rlabel} ${label} Shard`,
        description: `A ${rlabel.toLowerCase()} crystalline fragment aligned to ${label}. Used with Chips at the Rare Factory to craft Cyphers of matching rarity.`,
        price_credits: FRAGMENT_BASE_PRICE * priceScale,
        price: FRAGMENT_BASE_PRICE * priceScale,
        currency: 'credits',
        shop_category: 'fragment',
        kind: 'consumable',
        class: 'item',
        payload: JSON.stringify({ fragment: family }),
        rarity,
        item_type: 'fragment',
        drop_pool: 'shards',
        sort_order: rarity * 100,
      });
    }
  }
  return out;
}

function generateChipItems(): SeedItem[] {
  const chips: readonly { readonly grade: string; readonly stage: string; readonly level: number; readonly price: number }[] = [
    { grade: 'A', stage: 'Champion', level: 20, price: CHIP_BASE_PRICE },
    { grade: 'B', stage: 'Ultimate', level: 40, price: CHIP_BASE_PRICE * 3 },
    { grade: 'C', stage: 'Mega', level: 60, price: CHIP_BASE_PRICE * 8 },
  ];
  return chips.map((chip) => ({
    id: `itm-chip-${chip.grade.toLowerCase()}`,
    name: `${chip.grade}-Class Digi-Chip`,
    description: `A universal Digi-Chip. Combines with an element-tuned Cypher at the Rare Factory to digivolve a Digimon into ${chip.stage} (requires level ${chip.level}).`,
    price_credits: chip.price,
    price: chip.price,
    currency: 'credits',
    shop_category: 'chip',
    kind: 'consumable',
    class: 'item',
    payload: JSON.stringify({ chip_grade: chip.grade, target_stage: chip.stage }),
    item_type: 'chip',
    drop_pool: 'chips',
    sort_order: chip.grade === 'A' ? 0 : chip.grade === 'B' ? 1 : 2,
  }));
}

function generateCypherItems(): SeedItem[] {
  const out: SeedItem[] = [];
  for (const family of ELEMENT_FAMILIES) {
    for (const tier of CYPHER_TIERS) {
      for (const rarity of RARITY_RANKS) {
        const label = titleCase(family);
        const rlabel = RARITY_LABELS[rarity]!;
        const priceScale = 1 + rarity * 2;
        out.push({
          id: `itm-cypher-${family}-t${tier}-r${rarity}`,
          name: `${rlabel} ${label} Cypher ${TIER_ROMAN[tier]}`,
          description: `A ${rlabel.toLowerCase()} evolution key tuned to ${label}, tier ${TIER_ROMAN[tier]}. Consume during evolution to grant an element-affinity bonus.`,
          price_credits: CYPHER_BASE_PRICE * priceScale * tier,
          price: CYPHER_BASE_PRICE * priceScale * tier,
          currency: 'credits',
          shop_category: 'cypher',
          kind: 'evolve',
          class: 'item',
          payload: JSON.stringify({ cypher: family, tier, rarity }),
          rarity,
          item_type: 'evolution_key',
          drop_pool: 'cyphers',
          sort_order: tier * 1000 + rarity * 100,
        });
      }
    }
  }
  return out;
}

/** Called once at server boot. Idempotent (ON CONFLICT DO NOTHING). */
export async function seedShopItems(): Promise<void> {
  const now = Date.now();
  const generated = [...SEED_ITEMS, ...generateFragmentItems(), ...generateChipItems(), ...generateCypherItems()];
  await tx(async (t) => {
    for (const item of generated) {
      await t.run(SQL_INSERT_ITEM, [
        item.id, item.name, item.description, item.price_credits, item.price ?? item.price_credits,
        item.currency ?? 'credits', item.shop_category ?? 'misc', item.featured ?? 0, item.quick_offer ?? 0,
        item.one_time ?? 0, item.sort_order ?? 0, item.kind, item.class, item.payload,
        (item as { rarity?: number }).rarity ?? 0,
        (item as { item_type?: string }).item_type ?? 'consumable',
        (item as { drop_pool?: string | null }).drop_pool ?? null,
        now,
      ]);
    }
  });
  log.info('shop.seed.ok', { items: generated.length });
}

/** Custom item creation for the admin (kept internal — no HTTP route yet). */
export async function insertCustomItem(input: {
  name: string;
  description: string;
  priceCredits: number;
  kind: string;
  class: 'product' | 'item';
  payload: object;
  // Let admin use the new params if they pass them, for tests/internal.
  currency?: string;
  price?: number;
  shopCategory?: string;
  featured?: number;
  quickOffer?: number;
  oneTime?: number;
  sortOrder?: number;
  rarity?: number;
  itemType?: string;
  dropPool?: string | null;
}): Promise<string> {
  const id = newId('itm');
  const now = Date.now();
  await run(
    SQL_INSERT_ITEM,
    [
      id, input.name, input.description, input.priceCredits, input.price ?? input.priceCredits,
      input.currency ?? 'credits', input.shopCategory ?? 'misc', input.featured ?? 0,
      input.quickOffer ?? 0, input.oneTime ?? 0, input.sortOrder ?? 0,
      input.kind, input.class, JSON.stringify(input.payload), input.rarity ?? 0,
      input.itemType ?? 'consumable', input.dropPool ?? null, now
    ]
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
type InventoryJoinRow = InventoryRow & { name: string; description: string; rarity: number };
type ExtendedShopItemRow = ShopItemRow & { currency: string, price: number, shop_category: string, featured: number, quick_offer: number, one_time: number, sort_order: number };

export const shopPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/shop', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const products = await q<ExtendedShopItemRow>(SQL_SELECT_PRODUCTS);
    const inv = await q<InventoryJoinRow>(SQL_SELECT_INVENTORY, me.id);
    const wallet = await one<WalletRow & { netcore: number }>(SQL_SELECT_WALLET, me.id);
    const purchases = await q<{ item_id: string }>(SQL_SELECT_PURCHASES, me.id);
    const ownedSet = new Set(purchases.map(p => p.item_id));

    const mapItem = (i: ExtendedShopItemRow) => {
      let displayPayload: any = {};
      try { displayPayload = JSON.parse(i.payload); } catch {}
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        currency: i.currency,
        kind: i.kind,
        shopCategory: i.shop_category,
        oneTime: i.one_time === 1,
        owned: i.one_time === 1 ? ownedSet.has(i.id) : false,
        rarity: rarityFromRankOrCommon(i.rarity),
        ...displayPayload
      };
    };

    const categories = Array.from(new Set(products.map(p => p.shop_category)));
    const featuredRaw = products.find(p => p.featured === 1);
    const featured = featuredRaw ? mapItem(featuredRaw) : null;
    const quick = products.filter(p => p.quick_offer === 1).map(mapItem);
    const bundles = await loadBundlesForShop();

    return reply.send({
      featured,
      quick,
      catalog: products.map(mapItem),
      bundles,
      categories,
      wallet: { credits: wallet?.credits ?? 0, netcore: wallet?.netcore ?? 0, premiumUntil: wallet?.premium_until ?? null },
      inventory: inv.map((i) => ({ itemId: i.item_id, name: i.name, description: i.description, qty: i.qty, rarity: rarityFromRankOrCommon(i.rarity) })),
    });
  });

  app.get('/api/items', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const items = await q<InventoryJoinRow & { class?: string; rarity?: number }>(SQL_SELECT_INVENTORY_ITEMS, me.id);
    return reply.send({
      items: items.map((i) => ({ itemId: i.item_id, name: i.name, description: i.description, qty: i.qty, rarity: rarityFromRankOrCommon(i.rarity ?? 0) })),
    });
  });

  app.post('/api/shop/buy', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = BuySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    
    if (parsed.data.qty < 1 || parsed.data.qty > 99 || !Number.isSafeInteger(parsed.data.qty)) {
      return reply.code(400).send({ error: 'invalid qty' });
    }

    const now = Date.now();
    const itemIdStr = parsed.data.itemId;

    try {
      await tx(async (t) => {
        const item = await t.one<ExtendedShopItemRow>(SQL_SELECT_ITEM, [itemIdStr]);
        if (!item) throw new Error('NOT_FOUND');
        if (item.class !== 'product') throw new Error('NOT_A_PRODUCT');
        if (item.currency !== 'credits' && item.currency !== 'netcore') throw new Error('INVALID_CURRENCY');

        let qty = parsed.data.qty;
        if (item.one_time === 1) {
          qty = 1;
          const insertInfo = await t.run(SQL_INSERT_SHOP_PURCHASE, [me.id, now, item.id]);
          if (insertInfo.changes !== 1) {
            throw new Error('ALREADY_OWNED');
          }
        }

        const total = item.price * qty;
        if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) {
          throw new Error('TOTAL_OVERFLOW');
        }

        const walletUpdateSql = item.currency === 'credits' ? SQL_UPDATE_WALLET_CREDITS : SQL_UPDATE_WALLET_NETCORE;
        const walletInfo = await t.run(walletUpdateSql, [total, now, me.id, total]);
        if (walletInfo.changes === 0) {
          throw new Error('INSUFFICIENT_FUNDS');
        }

        // Grant item
        if (item.kind === 'premium') {
          let payload: { premiumDays?: number } = {};
          try { payload = JSON.parse(item.payload) as { premiumDays?: number }; } catch {}
          const days = Math.max(1, Math.min(365, Math.floor(payload.premiumDays ?? 0) || 7));
          const walletRow = await t.one<{ premium_until: number | null }>(`SELECT premium_until FROM player_wallet WHERE user_id = ?`, [me.id]);
          const cur = walletRow?.premium_until ?? 0;
          const base = cur > now ? cur : now;
          const premiumUntil = base + days * 86_400_000;
          await t.run(SQL_GRANT_PREMIUM, [premiumUntil, now, me.id]);
        } else if (item.kind === 'building_placement') {
          let payload: { buildingType?: string; kind?: string } = {};
          try { payload = JSON.parse(item.payload) as { buildingType?: string; kind?: string }; } catch {}
          const buildingType = payload.buildingType === 'training_premium' ? 'training_premium' : 'training';
          const kind = payload.kind ?? 'Training Station';
          for (let i = 0; i < qty; i++) {
            await t.run(SQL_INSERT_TRAINING_BUILDING, [
              newId('bld'), me.id, kind, buildingType, now, item.price, now,
            ]);
          }
        } else if (item.kind === 'team_slot') {
          // `itm-team-slot`: +1 saved team slot, repeatable. Grants the wallet
          // counter directly instead of an inventory row.
          const walletRow = await t.one<{ extra_team_slots: number }>(
            `SELECT extra_team_slots FROM player_wallet WHERE user_id = ?`,
            [me.id],
          );
          const extra = walletRow?.extra_team_slots ?? 0;
          if (extra + qty > MAX_TEAM_LIMIT - BASE_TEAM_LIMIT) {
            throw new Error('TEAM_SLOT_CAP');
          }
          for (let i = 0; i < qty; i++) {
            await grantTeamSlots(me.id, 1);
          }
        } else {
          await t.run(SQL_UPSERT_INVENTORY, [me.id, item.id, qty, now]);
        }
      });
    } catch (err: any) {
      log.warn('shop.buy.failed', { userId: me.id, itemId: itemIdStr, reason: err.message });
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ error: 'item not found' });
      if (err.message === 'NOT_A_PRODUCT') return reply.code(403).send({ error: 'not-a-product', message: 'Items are earned from PVE drops or farm crafting, not purchased.' });
      if (err.message === 'ALREADY_OWNED') return reply.code(409).send({ error: 'already owned' });
      if (err.message === 'INSUFFICIENT_FUNDS') return reply.code(402).send({ error: 'insufficient funds' });
      if (err.message === 'INVALID_CURRENCY') return reply.code(500).send({ error: 'data error: invalid currency' });
      if (err.message === 'TOTAL_OVERFLOW') return reply.code(400).send({ error: 'total price overflow' });
      return reply.code(409).send({ error: 'purchase conflicted — try again' });
    }

    log.info('shop.buy', { userId: me.id, itemId: itemIdStr, qty: parsed.data.qty });
    const wallet = await one<WalletRow & { netcore: number }>(SQL_SELECT_WALLET, me.id);
    return reply.send({ ok: true, credits: wallet?.credits ?? 0, netcore: wallet?.netcore ?? 0 });
  });

  app.post<{ Params: { id: string } }>('/api/shop/buy/bundle/:id', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const bundleId = req.params.id;
    const now = Date.now();
    try {
      await tx(async (t) => {
        const bundle = await t.one<BundleRow>(SQL_SELECT_BUNDLE, [bundleId]);
        if (!bundle) throw new Error('NOT_FOUND');
        const items = await t.query<BundleItemJoinRow>(SQL_SELECT_BUNDLE_ITEMS, [bundleId]);
        if (items.length === 0) throw new Error('EMPTY_BUNDLE');
        if (bundle.currency !== 'credits' && bundle.currency !== 'netcore') {
          throw new Error('INVALID_CURRENCY');
        }
        const { discountedPrice } = bundlePriceFromItems(items, bundle.discount_pct);
        if (!Number.isSafeInteger(discountedPrice) || discountedPrice < 0 || discountedPrice > 2147483647) {
          throw new Error('TOTAL_OVERFLOW');
        }
        const walletUpdateSql = bundle.currency === 'credits' ? SQL_UPDATE_WALLET_CREDITS : SQL_UPDATE_WALLET_NETCORE;
        const walletInfo = await t.run(walletUpdateSql, [discountedPrice, now, me.id, discountedPrice]);
        if (walletInfo.changes === 0) throw new Error('INSUFFICIENT_FUNDS');
        for (const it of items) {
          if (it.kind === 'building_placement') {
            let payload: { buildingType?: string; kind?: string } = {};
            try { payload = JSON.parse(it.payload) as { buildingType?: string; kind?: string }; } catch {}
            const buildingType = payload.buildingType === 'training_premium' ? 'training_premium' : 'training';
            const kind = payload.kind ?? 'Training Station';
            for (let i = 0; i < it.qty; i++) {
              await t.run(SQL_INSERT_TRAINING_BUILDING, [newId('bld'), me.id, kind, buildingType, now, it.price, now]);
            }
          } else {
            await t.run(SQL_UPSERT_INVENTORY, [me.id, it.item_id, it.qty, now]);
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      log.warn('shop.buy.bundle.failed', { userId: me.id, bundleId, reason: message });
      if (message === 'NOT_FOUND') return reply.code(404).send({ error: 'bundle not found' });
      if (message === 'EMPTY_BUNDLE') return reply.code(409).send({ error: 'empty bundle' });
      if (message === 'INSUFFICIENT_FUNDS') return reply.code(402).send({ error: 'insufficient funds' });
      if (message === 'INVALID_CURRENCY') return reply.code(500).send({ error: 'data error: invalid currency' });
      if (message === 'TOTAL_OVERFLOW') return reply.code(400).send({ error: 'total price overflow' });
      return reply.code(409).send({ error: 'purchase conflicted — try again' });
    }
    log.info('shop.buy.bundle.ok', { userId: me.id, bundleId });
    const wallet = await one<WalletRow & { netcore: number }>(SQL_SELECT_WALLET, me.id);
    return reply.send({ ok: true, credits: wallet?.credits ?? 0, netcore: wallet?.netcore ?? 0 });
  });

  app.post('/api/shop/use', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = UseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const owned = await one<InventoryRow>(SQL_SELECT_INVENTORY_ITEM, me.id, parsed.data.itemId);
    if (!owned || owned.qty < parsed.data.qty) {
      return reply.code(409).send({ error: 'not enough of that item' });
    }
    const info = await run(SQL_DECREMENT_INVENTORY, [parsed.data.qty, Date.now(), me.id, parsed.data.itemId, parsed.data.qty]);
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
