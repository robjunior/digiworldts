---
tags:
  - digiworld/adr
aliases:
  - Dual Currency Split
  - NetCore vs Credits ADR
  - ADR-003
created: 2026-07-31
updated: 2026-08-01
status: Accepted
grounded-in:
  - backend/src/market/coins.ts
  - backend/src/service/routes.ts
  - backend/src/db/migrations/042_dual_currency_columns.sql
  - backend/src/db/migrations/043_dual_currency_tables.pg.sql
verified-at-commit: 4e70621
---

# 2026-07-25 — Dual currency split (NetCore + Credits)

> [!info] Status
> **Accepted** and shipped. Landed with `27cf2e0 feat(currency): NetCore
> + Credits split with player-to-player coin market` plus migrations
> `042_dual_currency_columns.sql` + `043_dual_currency_tables.*.sql` +
> `044_market_listings_netcore.sql`.

## Context

A game needs a currency for gameplay reward. A game with premium
purchases needs SOMETHING that connects real money to in-game value.
The obvious model — ONE currency, "in-game money", with paid packs that
sell it — has a well-documented failure mode: **gameplay economy
manipulation directly moves paid inventory**.

Symptoms of the one-currency model:

- A farming exploit lets a player generate arbitrary amounts of the
  currency. The exploit is now a **cash conversion** — the exploiter
  sells to legitimate players who avoid buying packs. Refunds cascade,
  the paid supply is now inflated, the exchange rate against real money
  becomes ambiguous.
- A rebalance that increases gameplay drop rates is now a **de-facto
  pack devaluation**. Marketing has to price against the current drop
  rate; balance patches trigger customer service inquiries about
  refunds.
- Fraud recovery (chargeback → invalidate the pack that funded the
  spend) requires unwinding downstream trades, which requires a merkle
  audit trail per transaction, which is more infrastructure than a
  casual MMO justifies.

DigiWorld ships a PIX-based Discord bot for purchases. The paid
inventory must be clearly separable from what gameplay produces. And
the design must support **player-to-player currency trades** so
someone who wants premium inventory but not real money can still get
there.

## Decision

**Two separate wallets, one shared player.** `player_wallet(user_id,
credits, netcore, updated_at)`:

- **NetCore (NTC)** — earned. Every gameplay reward (PvP wins, PvE
  wins, quests, dailies, adventure) grants NetCore. **Nothing in
  gameplay grants Credits.**
- **Credits (CR)** — bought. The ONLY mint path is
  `POST /api/service/wallet-credit`, the bearer-authenticated M2M
  endpoint the Discord bot calls after a MercadoPago PIX payment
  settles. Idempotency-ledgered in `service_grant_log`.

Player-to-player trades happen on a **coin market** with lot-based
order books (`coin_offers` table). One lot = 25 Credits at a
player-chosen `price_per_lot` in NetCore. Poster escrows the asset at
post time; filler pays the other side atomically.

Every gameplay-side shop entry can be priced in NTC, CR, or both. The
CR-priced ones are the "premium" ones; the NTC-priced ones are the
grind-out.

## Consequences

### Positive

- **Total Credits supply is fixed by real money in.** Every CR in
  existence came from a `service_grant_log` row that traces back to a
  MercadoPago settle. Auditable: sum every CR in every wallet, compare
  to sum of `service_grant_log.credits`, they must match. Discrepancy
  = bug.
- **A gameplay exploit can only inflate NetCore.** The exploiter can
  dump NTC to buy CR on the coin market, but they DIDN'T mint the CR
  — they bought it from a player who already had it. Total CR is
  unchanged.
- **Chargebacks are contained.** A charged-back payment triggers a
  `POST /api/service/wallet-credit-refund` (verify — behavior TBD).
  We deduct the CR from the buyer's wallet. If they already spent it,
  the wallet goes negative or the refund is capped at balance —
  either way, the blast radius stops at the exchanger's downstream
  trades, not every subsequent trade.
- **Player-set exchange rate.** No server-fixed rate to defend against
  players — the market sets it. A price shift on PIX (e.g. currency
  fluctuation) auto-propagates through the market as players
  re-price.
- **Rebalance safety.** Boosting NetCore drop rates makes NetCore
  cheaper against CR (via the market). It doesn't devalue Credits
  purchases directly, which insulates the paid economy from gameplay
  tuning.

### Negative

- **The UI has to explain two currencies.** New players see NTC and
  CR labels immediately. First-time UX cost is real — we compensate
  with tooltips + a "what's the difference" onboarding step (TODO —
  verify it landed).
- **The coin market is more complex than a shop.** Order book UI +
  fill/cancel semantics + escrow math have real support cost. We
  ship it Tibia-style (sell offers + buy offers, discrete lots) to
  keep the model simple; still non-trivial.
- **Two atomic-write paths** for balance changes. Every buy / sell /
  fill uses guarded `UPDATE wallet SET credits = credits - ? WHERE
  credits >= ?` for BOTH currencies — the code path is duplicated in
  two axes. Refactoring toward a single "wallet write" abstraction
  is a follow-up.

### Neutral

- **`CREDITS_PER_BRL` (default 100) is snapshotted per purchase.**
  Changing the env value never rewrites already-paid orders, so
  historical audit is stable. But it means "the price of Credits"
  can drift over time — customers who paid in 2024 got a different
  CR/BRL ratio than 2026 buyers.
- **Coin market fees.** Currently zero — 100% of the trade lands at
  the counterparty. Adding a house cut later is a follow-up (would
  create a NetCore sink, useful for economy balance).

## Rejected alternatives

### One currency

The default. Rejected for the reasons in Context — real money and
gameplay-manipulable inventory can't share a supply pool without
constant audit + rebalance overhead. See "Symptoms" above.

### Three currencies (NetCore, Credits, and a "coin market" internal token)

Some MMOs use a third asset as the market medium (e.g., Tibia Coins in
addition to gold and event tokens). Rejected because it adds cognitive
overhead without a corresponding win — DigiWorld doesn't have the
scale to justify a market-only unit that ISN'T also the paid
currency. Direct NTC ↔ CR trading is simpler.

### Fixed exchange rate

Instead of a market, publish an official "X NetCore = 1 Credit" rate
and let players convert at that rate. Rejected because:

1. A fixed rate turns the game economy into a money-printer OR a
   bottleneck depending on which direction we set it.
2. It shifts price-discovery risk from the market (players) to the
   operator. Every rebalance patch would need a companion rate patch.
3. It doesn't support arbitrage — a player who wants to unload NTC
   for CR now has to compete with the server for the sale.

### Coin market with continuous prices (no lots)

Instead of `pricePerLot × lots_remaining`, allow continuous NTC/CR
ratios per trade. Rejected because the discrete-lot model keeps the
order book manageable (< 100 open offers, easy to scan) and matches
the mental model players already have from other games.

## Related

- [[Currency]] — the system reference
- [[HTTP Surface#Shop, Daily, Friends]] — the shop endpoints
- [[HTTP Surface#Service (M2M for the Discord bot)]] — the mint path
- Discord bot payment flow — [`discord/src/payments/`](discord/src/payments/)
