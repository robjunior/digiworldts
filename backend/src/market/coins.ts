import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { q, one, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';

const CREDITS_PER_LOT = 25;

const SQL_SELECT_SELL_OFFERS = `
  SELECT c.id, c.side, c.lots_remaining, c.price_per_lot, c.user_id, u.display_name AS seller_name
    FROM coin_offers c
    JOIN users u ON u.id = c.user_id
   WHERE c.side = 'sell' AND c.lots_remaining > 0 AND c.cancelled_at IS NULL AND c.completed_at IS NULL
   ORDER BY c.price_per_lot ASC, c.created_at ASC
   LIMIT 50
`;

const SQL_SELECT_BUY_OFFERS = `
  SELECT c.id, c.side, c.lots_remaining, c.price_per_lot, c.user_id, u.display_name AS seller_name
    FROM coin_offers c
    JOIN users u ON u.id = c.user_id
   WHERE c.side = 'buy' AND c.lots_remaining > 0 AND c.cancelled_at IS NULL AND c.completed_at IS NULL
   ORDER BY c.price_per_lot DESC, c.created_at ASC
   LIMIT 50
`;

const SQL_SELECT_MY_OFFERS = `
  SELECT c.id, c.side, c.lots_remaining, c.price_per_lot, c.user_id, u.display_name AS seller_name
    FROM coin_offers c
    JOIN users u ON u.id = c.user_id
   WHERE c.user_id = ? AND c.lots_remaining > 0 AND c.cancelled_at IS NULL AND c.completed_at IS NULL
   ORDER BY c.created_at DESC
`;

const SQL_SELECT_WALLET = `SELECT credits, netcore FROM player_wallet WHERE user_id = ?`;

const SQL_SELECT_LAST_PRICE = `
  SELECT price_per_lot FROM coin_offers WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1
`;

const OfferBody = z.object({
  side: z.enum(['sell', 'buy']),
  lots: z.number().int().positive().max(10000),
  pricePerLot: z.number().int().positive().max(1000000000),
});

const FillBody = z.object({
  lots: z.number().int().positive(),
});

type OfferRow = {
  id: string;
  side: 'sell' | 'buy';
  lots_remaining: number;
  price_per_lot: number;
  user_id: string;
  seller_name: string;
};

function toView(row: OfferRow, myUserId: string) {
  return {
    id: row.id,
    side: row.side,
    sellerName: row.seller_name,
    lotsRemaining: row.lots_remaining,
    pricePerLot: row.price_per_lot,
    totalNetcore: row.lots_remaining * row.price_per_lot,
    isMine: row.user_id === myUserId,
  };
}

export const coinMarketPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/market/coins', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const sellRows = await q<OfferRow>(SQL_SELECT_SELL_OFFERS);
    const buyRows = await q<OfferRow>(SQL_SELECT_BUY_OFFERS);
    const myRows = await q<OfferRow>(SQL_SELECT_MY_OFFERS, user.id);
    const wallet = (await one<{ credits: number; netcore: number }>(SQL_SELECT_WALLET, user.id)) ?? { credits: 0, netcore: 0 };
    const lastPriceRow = await one<{ price_per_lot: number }>(SQL_SELECT_LAST_PRICE);

    return reply.send({
      lotSize: CREDITS_PER_LOT,
      sellOffers: sellRows.map((r) => toView(r, user.id)),
      buyOffers: buyRows.map((r) => toView(r, user.id)),
      myOffers: myRows.map((r) => toView(r, user.id)),
      wallet,
      lastPrice: lastPriceRow?.price_per_lot ?? null,
    });
  });

  app.post('/api/market/coins/offer', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = OfferBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input' });
    }
    const { side, lots, pricePerLot } = parsed.data;
    const now = Date.now();
    const id = newId('cof');
    
    let ok = false;
    await tx(async (t) => {
      if (side === 'sell') {
        const creditsToEscrow = lots * CREDITS_PER_LOT;
        const res = await t.run(
          `UPDATE player_wallet SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?`,
          [creditsToEscrow, now, user.id, creditsToEscrow]
        );
        if (res.changes === 0) return;
      } else {
        const netcoreToEscrow = lots * pricePerLot;
        const res = await t.run(
          `UPDATE player_wallet SET netcore = netcore - ?, updated_at = ? WHERE user_id = ? AND netcore >= ?`,
          [netcoreToEscrow, now, user.id, netcoreToEscrow]
        );
        if (res.changes === 0) return;
      }

      await t.run(
        `INSERT INTO coin_offers (id, user_id, side, lots_total, lots_remaining, price_per_lot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, side, lots, lots, pricePerLot, now]
      );
      ok = true;
    });

    if (!ok) {
      return reply.code(402).send({ error: 'insufficient-funds' });
    }
    return reply.send({ ok: true, id });
  });

  app.post<{ Params: { id: string } }>('/api/market/coins/cancel/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const offerId = req.params.id;
    if (!offerId) return reply.code(400).send({ error: 'invalid-input' });
    const now = Date.now();

    let ok = false;
    await tx(async (t) => {
      const offer = await t.query<{ side: string; lots_remaining: number; price_per_lot: number }>(
        `SELECT side, lots_remaining, price_per_lot FROM coin_offers WHERE id = ? AND user_id = ? AND cancelled_at IS NULL AND completed_at IS NULL`,
        [offerId, user.id]
      );
      if (offer.length === 0) return;
      const off = offer[0]!;

      const res = await t.run(
        `UPDATE coin_offers SET cancelled_at = ? WHERE id = ? AND user_id = ? AND cancelled_at IS NULL AND completed_at IS NULL AND lots_remaining > 0`,
        [now, offerId, user.id]
      );
      if (res.changes !== 1) return;

      if (off.side === 'sell') {
        const creditsToRefund = off.lots_remaining * CREDITS_PER_LOT;
        await t.run(
          `UPDATE player_wallet SET credits = credits + ?, updated_at = ? WHERE user_id = ?`,
          [creditsToRefund, now, user.id]
        );
      } else {
        const netcoreToRefund = off.lots_remaining * off.price_per_lot;
        await t.run(
          `UPDATE player_wallet SET netcore = netcore + ?, updated_at = ? WHERE user_id = ?`,
          [netcoreToRefund, now, user.id]
        );
      }
      ok = true;
    });

    if (!ok) {
      return reply.code(409).send({ error: 'not-found-or-already-cancelled' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/market/coins/fill/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const offerId = req.params.id;
    if (!offerId) return reply.code(400).send({ error: 'invalid-input' });
    const parsed = FillBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input' });
    }
    const { lots } = parsed.data;
    const now = Date.now();

    let resultError: string | null = null;
    await tx(async (t) => {
      const offerRows = await t.query<{ user_id: string; side: string; price_per_lot: number }>(
        `SELECT user_id, side, price_per_lot FROM coin_offers WHERE id = ?`,
        [offerId]
      );
      if (offerRows.length === 0) {
        resultError = 'not-found';
        return;
      }
      const offer = offerRows[0]!;
      if (offer.user_id === user.id) {
        resultError = 'self-fill';
        return;
      }

      const res = await t.run(
        `UPDATE coin_offers SET lots_remaining = lots_remaining - ?, completed_at = CASE WHEN lots_remaining - ? = 0 THEN ? ELSE completed_at END WHERE id = ? AND cancelled_at IS NULL AND completed_at IS NULL AND lots_remaining >= ?`,
        [lots, lots, now, offerId, lots]
      );
      if (res.changes === 0) {
        resultError = 'conflict';
        return;
      }

      if (offer.side === 'sell') {
        // Filler buys Credits, pays NetCore
        const netcoreToPay = lots * offer.price_per_lot;
        const creditsToReceive = lots * CREDITS_PER_LOT;

        const pRes = await t.run(
          `UPDATE player_wallet SET netcore = netcore - ?, updated_at = ? WHERE user_id = ? AND netcore >= ?`,
          [netcoreToPay, now, user.id, netcoreToPay]
        );
        if (pRes.changes === 0) {
          throw new Error('insufficient-funds'); // Rollback tx
        }
        await t.run(
          `UPDATE player_wallet SET credits = credits + ?, updated_at = ? WHERE user_id = ?`,
          [creditsToReceive, now, user.id]
        );
        // Seller receives NetCore
        await t.run(
          `UPDATE player_wallet SET netcore = netcore + ?, updated_at = ? WHERE user_id = ?`,
          [netcoreToPay, now, offer.user_id]
        );
      } else {
        // Filler sells Credits, receives NetCore
        const creditsToPay = lots * CREDITS_PER_LOT;
        const netcoreToReceive = lots * offer.price_per_lot;

        const pRes = await t.run(
          `UPDATE player_wallet SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?`,
          [creditsToPay, now, user.id, creditsToPay]
        );
        if (pRes.changes === 0) {
          throw new Error('insufficient-funds'); // Rollback tx
        }
        await t.run(
          `UPDATE player_wallet SET netcore = netcore + ?, updated_at = ? WHERE user_id = ?`,
          [netcoreToReceive, now, user.id]
        );
        // Buyer (offer owner) receives Credits
        await t.run(
          `UPDATE player_wallet SET credits = credits + ?, updated_at = ? WHERE user_id = ?`,
          [creditsToPay, now, offer.user_id]
        );
      }
    }).catch(e => {
      if (e instanceof Error && e.message === 'insufficient-funds') {
        resultError = 'insufficient-funds';
      } else {
        throw e;
      }
    });

    if (resultError === 'self-fill') return reply.code(400).send({ error: 'cannot-fill-own-offer' });
    if (resultError === 'insufficient-funds') return reply.code(402).send({ error: 'insufficient-funds' });
    if (resultError === 'conflict' || resultError === 'not-found') return reply.code(409).send({ error: 'conflict' });

    return reply.send({ ok: true });
  });
};
