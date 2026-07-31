-- 043_credit_debt.pg.sql
-- Chargebacks are not optional: the bank pulls the money whether or not the player
-- still holds the credits. player_wallet has CHECK (credits >= 0), so a wallet can
-- never carry the shortfall itself. This ledger holds what could not be clawed back,
-- and /buy refuses to sell while a row here is outstanding.

CREATE TABLE IF NOT EXISTS commerce.credit_debt (
  user_id TEXT PRIMARY KEY,
  amount INT NOT NULL CHECK (amount > 0),
  reason TEXT,
  purchase_session_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
