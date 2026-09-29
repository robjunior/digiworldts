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
 * Returns a NEW digimons array with the canonical Rookie→Champion edges assigned the
 * Champion evolution chip. Pairs with no real edge (or a champion not on the roster)
 * are skipped and reported. Roster species/tier map ensures the champion exists.
 */
export function applyLaunchEvolutionKeys(
  digimons: readonly TemplateDigimon[],
  speciesByShortName: ReadonlyMap<string, RosterSpecies>,
): { digimons: TemplateDigimon[]; assigned: string[]; skipped: string[] } {
  const assigned: string[] = [];
  const skipped: string[] = [];
  const next = digimons.map((t) => {
    const targetName = t.stage === 'Rookie' ? CANONICAL_ROOKIE_TO_CHAMPION[t.name.toLowerCase()] : undefined;
    if (!targetName || !t.evolvesInto || t.evolvesInto.length === 0) return t;
    const targetSpecies = speciesByShortName.get(targetName);
    if (!targetSpecies) return t; // canonical champion not on the launch roster — family farms it via wild/hatch
    const targetId = digimons.find((x) => x.name === targetName)?.id;
    if (!targetId) return t;
    const edge = t.evolvesInto.find((e) => e.targetId === targetId);
    if (!edge) {
      skipped.push(`${t.name}→${targetName} (no edge)`);
      return t;
    }
    const qty = chipQtyForTier(targetSpecies.tier);
    assigned.push(`${t.name}→${targetName} (${targetSpecies.tier}, ×${qty})`);
    return {
      ...t,
      evolvesInto: t.evolvesInto.map((e) =>
        e === edge ? { ...e, requiredItemId: EVO_CHIP_CHAMPION, requiredItemQty: qty } : e,
      ),
    };
  });
  return { digimons: next, assigned, skipped };
}