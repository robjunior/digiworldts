/**
 * Canonical evolution assignment — the content-delivery lever for the launch roster.
 *
 * Every evolution edge in the catalog is item-gated (`no-item-assigned` blocks an
 * edge with no `requiredItemId`). So to make a Rookie→Champion path actually
 * evolvable, the canonical edge must carry an item. This module assigns the existing
 * generic Champion evolution chip (`itm-digi-chip-champion`, see social/shop.ts
 * SEED_ITEMS) to the ONE curated canonical Rookie→Champion edge per roster family,
 * leaving every other edge of that Rookie item-less (still blocked).
 *
 * Cost scales with the champion's rarity tier (epic costs 3 chips) — the effort axis
 * for the launch economy. Rarity-tuned chips (rare/epic `itm-digi-chip-*`) that would
 * also drive the evolution rarity-bonus are a documented follow-up.
 */
import type { TemplateDigimon } from '../digimon/xml.js';
import type { RosterSpecies } from './roster.js';

export const EVO_CHIP_CHAMPION = 'itm-digi-chip-champion';

/** Curated canonical Rookie -> champion (by species name). Both must exist and the
 *  edge must be real in the catalog, or the pair is skipped (family evolves via
 *  wild/hatch only). */
export const CANONICAL_ROOKIE_TO_CHAMPION: Readonly<Record<string, string>> = {
  agumon: 'Greymon',
  gabumon: 'Garurumon',
  gomamon: 'Ikkakumon',
  palmon: 'Togemon',
  biyomon: 'Birdramon',
  patamon: 'Angemon',
  tentomon: 'Kabuterimon',
  hagurumon: 'Guardromon',
  terriermon: 'Gargomon',
  guilmon: 'Growlmon',
  gaomon: 'Gaogamon',
  veemon: 'ExVeemon',
  coronamon: 'Firamon',
  renamon: 'Kyubimon',
  lalamon: 'Sunflowmon',
  dorumon: 'Dorugamon',
  lopmon: 'Wendigomon',
  demidevimon: 'Devimon',
  lunamon: 'Lekismon',
  bearmon: 'Grizzlymon',
};

export function chipQtyForTier(tier: RosterSpecies['tier']): number {
  return tier === 'epic' ? 3 : tier === 'rare' ? 2 : 1;
}

/**
 * Returns a NEW digimons array with EVERY launch-roster Rookie→Champion edge assigned
 * the Champion evolution chip — neither the Rookie nor the Champion path is locked.
 * An edge is gated (item-less, `no-item-assigned`) ONLY when its target is not a
 * roster Champion (Ultimate/Mega/off-roster are unreachable in the champion-cap meta
 * anyway). Cost scales with the target champion's rarity tier (epic costs 3 chips).
 */
export function applyLaunchEvolutionKeys(
  digimons: readonly TemplateDigimon[],
  speciesByShortName: ReadonlyMap<string, RosterSpecies>,
): { digimons: TemplateDigimon[]; assigned: string[]; skipped: string[] } {
  const assigned: string[] = [];
  const skipped: string[] = [];
  const idToInfo = new Map<string, { name: string; stage: string }>();
  for (const t of digimons) idToInfo.set(t.id, { name: t.name, stage: t.stage });
  const next = digimons.map((t) => {
    if (t.stage !== 'Rookie' || !t.evolvesInto || t.evolvesInto.length === 0) return t;
    let changed = false;
    const evolvesInto = t.evolvesInto.map((e) => {
      if (e.requiredItemId !== undefined) return e; // already item-gated (idempotent)
      const target = idToInfo.get(e.targetId);
      if (!target) return e;
      const species = speciesByShortName.get(target.name);
      // Only Rookie→Champion within the launch roster is a live path.
      if (!species || target.stage !== 'Champion') return e;
      const qty = chipQtyForTier(species.tier);
      changed = true;
      assigned.push(`${t.name}→${target.name} (${species.tier}, ×${qty})`);
      return { ...e, requiredItemId: EVO_CHIP_CHAMPION, requiredItemQty: qty };
    });
    return changed ? { ...t, evolvesInto } : t;
  });
  return { digimons: next, assigned, skipped };
}