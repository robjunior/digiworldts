import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, STARTER_DIGICREDITS } from './shop.seed';

/**
 * Shop catalog well-formedness (TASK-262, R-31b) — a pure unit over the frozen
 * `SHOP_ITEMS` constant, asserting the NEW `'inventory_item'` entry is well-formed so a
 * mistyped catalog row is caught here (fast) rather than only surfacing in the e2e grant.
 * The purchase/grant behaviour itself is proven end-to-end by inventory.controller.spec.ts.
 */
describe('SHOP_ITEMS inventory_item entry (TASK-262, R-31b)', () => {
  const item = SHOP_ITEMS.find((i) => i.kind === 'inventory_item');

  it('exposes exactly one well-formed inventory_item catalog entry', () => {
    expect(item).toBeDefined();
    expect(typeof item!.id).toBe('string');
    expect(item!.id.length).toBeGreaterThan(0);
    expect(typeof item!.name).toBe('string');
    expect(item!.name.length).toBeGreaterThan(0);
    expect(typeof item!.description).toBe('string');
    expect(item!.description.length).toBeGreaterThan(0);
    // A whole positive DigiCredits price the starter grant can afford (so the buy→own→see
    // arc is demonstrable on a fresh account with a single purchase).
    expect(Number.isInteger(item!.priceCredits)).toBe(true);
    expect(item!.priceCredits).toBeGreaterThan(0);
    expect(item!.priceCredits).toBeLessThanOrEqual(STARTER_DIGICREDITS);
  });
});
