import type { PromoCode, PromoRedemption, Queryable } from './types.js';

type PromoCodeRow = {
  readonly id: string;
  readonly code: string;
  readonly kind: 'fixed_brl';
  readonly discount_brl_cents: number;
  readonly max_uses: number | null;
  readonly uses_count: number;
  readonly starts_at: number | null;
  readonly expires_at: number | null;
  readonly disabled_at: number | null;
  readonly created_by: string | null;
  readonly created_at: number;
};

type RedemptionRow = {
  readonly user_id: string;
  readonly code_id: string;
  readonly purchase_session_id: string | null;
  readonly redeemed_at: number;
};

const SQL_INSERT_PROMO = `
  INSERT INTO promo_codes (id, code, kind, discount_brl_cents, max_uses, uses_count, starts_at, expires_at, disabled_at, created_by, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;
const SQL_SELECT_PROMO = `SELECT * FROM promo_codes WHERE id = $1`;
const SQL_DISABLE_PROMO = `UPDATE promo_codes SET disabled_at = $2 WHERE id = $1`;
const SQL_INSERT_REDEMPTION = `INSERT INTO promo_redemptions (user_id, code_id, purchase_session_id, redeemed_at) VALUES ($1, $2, $3, $4)`;
const SQL_SELECT_REDEMPTION = `SELECT * FROM promo_redemptions WHERE user_id = $1 AND code_id = $2`;

function toPromo(row: PromoCodeRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    discountBrlCents: row.discount_brl_cents,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    disabledAt: row.disabled_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toRedemption(row: RedemptionRow): PromoRedemption {
  return {
    userId: row.user_id,
    codeId: row.code_id,
    purchaseSessionId: row.purchase_session_id,
    redeemedAt: row.redeemed_at,
  };
}

export async function insertPromoCode(db: Queryable, promo: PromoCode): Promise<void> {
  await db.query(SQL_INSERT_PROMO, [promo.id, promo.code, promo.kind, promo.discountBrlCents, promo.maxUses, promo.usesCount, promo.startsAt, promo.expiresAt, promo.disabledAt, promo.createdBy, promo.createdAt]);
}

export async function getPromoCode(db: Queryable, id: string): Promise<PromoCode | null> {
  const result = await db.query<PromoCodeRow>(SQL_SELECT_PROMO, [id]);
  const row = result.rows[0];
  return row ? toPromo(row) : null;
}

export async function disablePromoCode(db: Queryable, id: string, disabledAt: number): Promise<void> {
  await db.query(SQL_DISABLE_PROMO, [id, disabledAt]);
}

export async function insertPromoRedemption(db: Queryable, redemption: PromoRedemption): Promise<void> {
  await db.query(SQL_INSERT_REDEMPTION, [redemption.userId, redemption.codeId, redemption.purchaseSessionId, redemption.redeemedAt]);
}

export async function getPromoRedemption(db: Queryable, userId: string, codeId: string): Promise<PromoRedemption | null> {
  const result = await db.query<RedemptionRow>(SQL_SELECT_REDEMPTION, [userId, codeId]);
  const row = result.rows[0];
  return row ? toRedemption(row) : null;
}
