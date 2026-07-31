# Discord product catalog

`products.json` is deploy-time configuration. Copy `products.example.json` to `products.json`, replace every placeholder, and keep real SKUs, prices, and product names out of source control.

The Discord service uses this file for display metadata only. The backend `shop_items.id` referenced by `shopItemId` remains the source of truth for the reward that a paid purchase grants.

## Top-level fields

- `_readme`: Optional operator note. The example points back to this file.
- `products`: Array of product entries shown by `/shop` and later purchase flows.

## Product fields

- `sku` (required string): Operator-owned product identifier used by Discord commerce flows. Replace the example placeholder before deploy.
- `displayName` (required object): Localized display name with both `pt` and `en` strings.
- `description` (optional object): Localized longer text with both `pt` and `en` strings when present.
- `priceBrlCents` (required integer, minimum `0`): Price in BRL cents. No other currency is supported in this contract.
- `currency` (optional string): When present, it must be `BRL`. Omit it unless an operator tool wants an explicit currency marker.
- `shopItemId` (required string): Foreign key to the backend `shop_items.id` entry that defines the actual gameplay grant.
- `kind` (required string): Must be `credits` — the sole supported product kind in this phase (REV-1.1 dropped `item` and `premium` variants; items and premium are bought in-game with DigiCredits).
- `creditsAmount` (required integer, minimum `1`): Amount of DigiCredits granted by this pack when the PIX payment is confirmed.
- `expiresMinutes` (optional integer): Per-product PIX expiration override in minutes. When omitted, the service default is used.
- `enabled` (optional boolean, default `true`): Set to `false` to hide a configured product without deleting it.

Validate changes against `products.schema.json` before deploy. `products.json` is gitignored intentionally because real catalog data belongs to the operator.
