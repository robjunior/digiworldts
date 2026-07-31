import test from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { getDb, closeDbAdapter } from '../src/db/adapter.js';
import { run, tx, q, one } from '../src/db/index.js';
import { shopPlugin, seedShopItems } from '../src/social/shop.js';
import { coinMarketPlugin } from '../src/market/coins.js';
import { newId } from '../src/util/ids.js';

// We mock requireAuth by intercepting the requests. Fastify decorators are cleaner.
// Actually, fastify plugins are isolated. We can override requireAuth if it's dependency injected? 
// No, it's hardcoded. We can instead mock `requireAuth` using `test:mock` if we are on node 20+.
// Or just seed a valid session!
// To seed a session we need the fastify-cookie setup.
import fastifyCookie from '@fastify/cookie';
import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';

test('Currency and Shop Smoke Test', async (t) => {
  // DB setup
  const fs = await import('node:fs');
  if (fs.existsSync('/tmp/dw-currency-smoke.db')) fs.unlinkSync('/tmp/dw-currency-smoke.db');
  await getDb();

  await seedShopItems();

  const app = Fastify();
  await app.register(fastifyCookie, { secret: 'test-secret-that-is-at-least-32-chars-long', hook: 'onRequest' });
  await app.register(shopPlugin);
  await app.register(coinMarketPlugin);

  // Helper to create a user and get a signed cookie
  async function createUser() {
    const id = newId('usr');
    const pwd = await hashPassword('pass');
    await run(`INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, 
      [id, 'user_' + id, 'User ' + id, pwd, Date.now(), Date.now()]);
    
    const sess = await createSession({ userId: id, userAgent: 'test', ip: '127.0.0.1' });
    const signed = app.signCookie(sess.token);
    return { id, token: sess.token, cookie: `digiworld_sid=${signed}` };
  }

  const u1 = await createUser();
  const u2 = await createUser();

  await run(`INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 1000, 500, 0, ?) ON CONFLICT(user_id) DO UPDATE SET credits = 1000, netcore = 500`, [u1.id, Date.now()]);
  
  await run(`INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, created_at)
    VALUES ('itm-test-cred', 'Cred Item', 'desc', 100, 100, 'credits', 'misc', 0, 0, 0, 0, 'consumable', 'product', '{}', 1, 0)`);
    
  await run(`INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, created_at)
    VALUES ('itm-test-net', 'Net Item', 'desc', 200, 200, 'netcore', 'misc', 0, 0, 0, 0, 'consumable', 'product', '{}', 1, 0)`);

  await run(`INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, created_at)
    VALUES ('itm-test-once', 'Once Item', 'desc', 50, 50, 'credits', 'misc', 0, 0, 1, 0, 'consumable', 'product', '{}', 1, 0)`);

  await t.test('buy with sufficient funds in credits', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-cred', qty: 2 } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.credits, 800);
  });

  await t.test('buy with sufficient funds in netcore', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-net', qty: 1 } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.netcore, 300);
  });

  await t.test('buy with insufficient funds', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-net', qty: 10 } });
    assert.strictEqual(res.statusCode, 402);
  });

  await t.test('buy non-product class item', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-heal-small', qty: 1 } });
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('one-time purchase twice gets 409', async () => {
    const res1 = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-once', qty: 1 } });
    assert.strictEqual(res1.statusCode, 200);

    const res2 = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-once', qty: 1 } });
    assert.strictEqual(res2.statusCode, 409);
  });

  await t.test('concurrent double-buy of one-time item', async () => {
    await run(`INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 1000, 500, 0, ?) ON CONFLICT(user_id) DO UPDATE SET credits = 1000, netcore = 500`, [u2.id, Date.now()]);
    const p1 = app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u2.cookie }, payload: { itemId: 'itm-test-once', qty: 1 } });
    const p2 = app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u2.cookie }, payload: { itemId: 'itm-test-once', qty: 1 } });
    
    const results = await Promise.all([p1, p2]);
    const codes = results.map(r => r.statusCode).sort();
    assert.deepStrictEqual(codes, [200, 409]);
  });

  await t.test('buy qty overflow attempt', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shop/buy', headers: { cookie: u1.cookie }, payload: { itemId: 'itm-test-cred', qty: 99999999 } });
    assert.strictEqual(res.statusCode, 400); // Zod caught max 99
  });

  await t.test('post sell offer -> Credits escrowed', async () => {
    await run(`UPDATE player_wallet SET credits = 100, netcore = 100 WHERE user_id = ?`, [u1.id]);
    const res = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 2, pricePerLot: 100 } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.id);
    const w = await one<{ credits: number }>(`SELECT credits FROM player_wallet WHERE user_id = ?`, u1.id);
    assert.strictEqual(w?.credits, 50); // 100 - (2 * 25)
  });

  await t.test('post buy offer -> NetCore escrowed', async () => {
    await run(`UPDATE player_wallet SET credits = 100, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    const res = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'buy', lots: 2, pricePerLot: 200 } });
    assert.strictEqual(res.statusCode, 200);
    const w = await one<{ netcore: number }>(`SELECT netcore FROM player_wallet WHERE user_id = ?`, u1.id);
    assert.strictEqual(w?.netcore, 600); // 1000 - (2 * 200)
  });

  await t.test('posting with insufficient balance', async () => {
    await run(`UPDATE player_wallet SET credits = 10, netcore = 10 WHERE user_id = ?`, [u1.id]);
    const res1 = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 1, pricePerLot: 100 } });
    assert.strictEqual(res1.statusCode, 402);
    const res2 = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'buy', lots: 1, pricePerLot: 100 } });
    assert.strictEqual(res2.statusCode, 402);
  });

  await t.test('partial fill', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u2.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 4, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    const fillRes = await app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 1 } });
    assert.strictEqual(fillRes.statusCode, 200);

    const w1 = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u1.id);
    const w2 = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u2.id);

    // u1 escrowed 100 credits. 1 lot was sold, so u1 gets 100 netcore.
    assert.strictEqual(w1?.credits, 900); 
    assert.strictEqual(w1?.netcore, 1100); 

    // u2 paid 100 netcore, got 25 credits.
    assert.strictEqual(w2?.credits, 1025);
    assert.strictEqual(w2?.netcore, 900);
    
    const offer = await one<{ lots_remaining: number }>(`SELECT lots_remaining FROM coin_offers WHERE id = ?`, offerId);
    assert.strictEqual(offer?.lots_remaining, 3);
  });

  await t.test('full fill sets completed_at and removes it from book', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u2.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'buy', lots: 2, pricePerLot: 150 } });
    const offerId = offerRes.json().id;

    const fillRes = await app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 2 } });
    assert.strictEqual(fillRes.statusCode, 200);

    const offer = await one<{ completed_at: number | null }>(`SELECT completed_at FROM coin_offers WHERE id = ?`, offerId);
    assert.notStrictEqual(offer?.completed_at, null);
  });

  await t.test('cancel refunds exactly lots_remaining worth of escrow', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u2.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 4, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    await app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 1 } });
    
    const cancelRes = await app.inject({ method: 'POST', url: `/api/market/coins/cancel/${offerId}`, headers: { cookie: u1.cookie } });
    assert.strictEqual(cancelRes.statusCode, 200);

    const w1 = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u1.id);
    // Escrow was 100 (4 * 25). 1 lot sold (u1 gets 100 NC, loses 25 credits). 3 lots refunded (75 credits).
    // Final: credits = 1000 - 100 + 75 = 975. Netcore = 1000 + 100 = 1100.
    assert.strictEqual(w1?.credits, 975);
    assert.strictEqual(w1?.netcore, 1100);
  });

  await t.test('concurrency: two Promise.all fills racing for the last lot', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u2.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 1, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    const w1Before = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u1.id);
    const w2Before = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u2.id);
    
    const p1 = app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 1 } });
    const p2 = app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 1 } });
    
    const results = await Promise.all([p1, p2]);
    const codes = results.map(r => r.statusCode).sort();
    assert.deepStrictEqual(codes, [200, 409]); // One success, one failure

    const offer = await one<{ lots_remaining: number }>(`SELECT lots_remaining FROM coin_offers WHERE id = ?`, offerId);
    assert.strictEqual(offer?.lots_remaining, 0); // No negative lots

    const w1After = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u1.id);
    const w2After = await one<{ credits: number; netcore: number }>(`SELECT credits, netcore FROM player_wallet WHERE user_id = ?`, u2.id);

    // Conservation check
    const totCredBefore = (w1Before?.credits ?? 0) + (w2Before?.credits ?? 0);
    const totNCBefore = (w1Before?.netcore ?? 0) + (w2Before?.netcore ?? 0);
    const totCredAfter = (w1After?.credits ?? 0) + (w2After?.credits ?? 0);
    const totNCAfter = (w1After?.netcore ?? 0) + (w2After?.netcore ?? 0);
    
    // Total includes the escrowed amount which was still in the system but removed from wallet. Wait, w1Before already has the escrow removed.
    // 1000 (after escrow 975) + 1000 = 1975 credits.
    assert.strictEqual(totCredBefore + 25, totCredAfter);
    assert.strictEqual(totNCBefore, totNCAfter);
  });

  await t.test('self-fill rejected', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 1, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    const fillRes = await app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u1.cookie }, payload: { lots: 1 } });
    assert.strictEqual(fillRes.statusCode, 400);
  });

  await t.test('cancel by non-owner rejected', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 1, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    const cancelRes = await app.inject({ method: 'POST', url: `/api/market/coins/cancel/${offerId}`, headers: { cookie: u2.cookie } });
    assert.strictEqual(cancelRes.statusCode, 409); // not-found-or-already-cancelled
  });

  await t.test('filling an already-cancelled offer', async () => {
    await run(`UPDATE player_wallet SET credits = 1000, netcore = 1000 WHERE user_id = ?`, [u1.id]);
    const offerRes = await app.inject({ method: 'POST', url: '/api/market/coins/offer', headers: { cookie: u1.cookie }, payload: { side: 'sell', lots: 1, pricePerLot: 100 } });
    const offerId = offerRes.json().id;

    await app.inject({ method: 'POST', url: `/api/market/coins/cancel/${offerId}`, headers: { cookie: u1.cookie } });
    const fillRes = await app.inject({ method: 'POST', url: `/api/market/coins/fill/${offerId}`, headers: { cookie: u2.cookie }, payload: { lots: 1 } });
    assert.strictEqual(fillRes.statusCode, 409);
  });

  await closeDbAdapter();
});
