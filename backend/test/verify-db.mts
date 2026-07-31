import { SqliteAdapter } from '../src/db/sqlite.ts';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { runMigrations } from '../src/db/migrator.ts';

const DB_PATH_FRESH = '/tmp/dw-explicit-fresh.db';
const DB_PATH_PRESERVE = '/tmp/dw-explicit-preserve.db';

async function verifyFresh() {
  for (const f of [DB_PATH_FRESH, `${DB_PATH_FRESH}-wal`, `${DB_PATH_FRESH}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  process.env.DB_PATH = DB_PATH_FRESH;
  const a = await SqliteAdapter.create(); // creates schema + runs migrations
  
  const cols = await a.query("PRAGMA table_info(shop_items)");
  console.log("FRESH - columns in shop_items:", cols.map(c => c.name).join(', '));
  
  const master = await a.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='shop_items'");
  console.log("FRESH - sqlite_master for shop_items:\n" + master[0].sql);
  
  await a.close();
}

async function verifyPreserve() {
  for (const f of [DB_PATH_PRESERVE, `${DB_PATH_PRESERVE}-wal`, `${DB_PATH_PRESERVE}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  
  // Seed the DB via a full init to get all tables, THEN insert our data
  // Wait, if we init it, it will be fresh. To simulate an old DB, we must 
  // create the tables with old schemas. But that's hard to do manually.
  // Actually, we can run all migrations up to 041!
  
  // Easiest way: copy schema.sql into a string, run it. 
  // Then run migrations manually? No, migrator runs them.
  // But wait, the user's test scenario:
  // "Data preservation: seed a DB with a player_wallet row (non-zero credits), a shop_items row with price_credits = 500, and a player_inventory row; run the migrator; confirm credits survived, price == 500, netcore == 0, and the inventory row survived with the FK now RESTRICT."
  
  // We can just construct a DB with EXACTLY the old schemas for those tables.
  const raw = new Database(DB_PATH_PRESERVE);
  
  // Base tables
  raw.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, display_name TEXT, password_hash TEXT, is_admin INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);`);
  raw.exec(`INSERT INTO users VALUES ('u1', 'u1', 'u1', 'hash', 0, 0, 0);`);
  
  // OLD wallet
  raw.exec(`CREATE TABLE player_wallet (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    credits INTEGER NOT NULL DEFAULT 0,
    streak_day INTEGER NOT NULL DEFAULT 0,
    last_claim_at INTEGER,
    premium_until INTEGER,
    updated_at INTEGER NOT NULL
  );`);
  raw.exec(`INSERT INTO player_wallet VALUES ('u1', 1234, 0, 0, 0, 0);`);
  
  // OLD shop_items
  raw.exec(`CREATE TABLE shop_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_credits INTEGER NOT NULL CHECK(price_credits>=0),
    kind TEXT NOT NULL,
    class TEXT NOT NULL DEFAULT 'product',
    payload TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );`);
  raw.exec(`INSERT INTO shop_items VALUES ('item1', 'n', 'd', 500, 'k', 'item', '{}', 1, 0);`);
  
  // OLD player_inventory (CASCADE)
  raw.exec(`CREATE TABLE player_inventory (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, item_id)
  );`);
  raw.exec(`INSERT INTO player_inventory VALUES ('u1', 'item1', 5, 0);`);
  
  raw.close();
  
  process.env.DB_PATH = DB_PATH_PRESERVE;
  
  try {
    const a = await SqliteAdapter.create(); 
    
    const w = await a.one("SELECT * FROM player_wallet WHERE user_id = 'u1'");
    console.log("PRESERVE - wallet:", w);
    
    const s = await a.one("SELECT * FROM shop_items WHERE id = 'item1'");
    console.log("PRESERVE - shop_items:", s);
    
    const inv = await a.one("SELECT * FROM player_inventory WHERE user_id = 'u1'");
    console.log("PRESERVE - player_inventory:", inv);
    
    const master = await a.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='player_inventory'");
    console.log("PRESERVE - inventory SQL:\n" + master[0].sql);

    await a.close();
  } catch (e) {
    console.error("Preserve test failed:", e);
  }
}

async function run() {
  await verifyFresh();
  console.log('-------------------------------------------');
  await verifyPreserve();
}

run().catch(console.error);
