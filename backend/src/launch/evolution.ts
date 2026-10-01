/**
 * Canonical evolution assignment — evolution gated by digimon-specific fragments.
 *
 * Every evolution edge in the catalog is item-gated (`no-item-assigned` blocks an
 * edge with no `requiredItemId`). To make a Rookie→Champion path evolvable the edge
 * must carry an item. This module replaces the old generic evolution chips
 * (`itm-digi-chip-*`) with PER-DIGIMON fragments (`itm-evo-frag-<species>`): a Rookie
 * needs EVO_FRAGMENTS_PER_EVOLUTION of its target Champion's fragment to evolve.
 *
 * Fragments are drop-only gamble rewards from the wild (see adventure/engine.ts): a
 * Champion drops its own fragment, and a canonical Rookie antecessor drops its
 * canonical Champion's fragment, both at a low rate — the "grind" of the launch
 * economy.
 */
import type { TemplateDigimon } from '../digimon/xml.js';
import type { RosterSpecies } from './roster.js';

/** Flat fragment cost to digivolve a Rookie → Champion (the whole item = 5 fragments). */
export const EVO_FRAGMENTS_PER_EVOLUTION = 5;

/** Low per-encounter drop rate (percent, <100) for an evolution fragment. */
export const EVO_FRAGMENT_DROP_PCT = 10;

/** Curated canonical Rookie -> champion (resolved to real catalog ids at seed time). */
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

/** The digimon-specific fragment item id for a species (e.g. Greymon → `itm-evo-frag-greymon`). */
export function fragmentItemIdFor(name: string): string {
  return `itm-evo-frag-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** Display name of a species' evolution fragment. */
export function fragmentItemNameFor(name: string): string {
  return `${name} Evolution Fragment`;
}

// Legacy evolution fragment/key builders removed — replaced by the 3-item system
// (elemental essences, rarity cores, archetype sigils) in evolution/items.ts.

/**
 * Returns a NEW digimons array with EVERY launch-roster Rookie→Champion edge assigned
 * the target Champion's evolution fragment (qty EVO_FRAGMENTS_PER_EVOLUTION). Booster-key
 * edges (`itm-evo-<name>`, the separate booster content-delivery lever) are preserved
 * untouched. Idempotent — an edge already carrying exactly its fragment is skipped.
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
      const target = idToInfo.get(e.targetId);
      if (!target) return e;
      const species = speciesByShortName.get(target.name);
      // Only Rookie→Champion within the launch roster is a live path.
      if (!species || target.stage !== 'Champion') return e;
      // Preserve booster-key edges (separate content-delivery lever), never clobber them.
      if (
        e.requiredItemId !== undefined && e.requiredItemId !== null &&
        e.requiredItemId.startsWith('itm-evo-') && !e.requiredItemId.startsWith('itm-evo-frag-')
      ) {
        return e;
      }
      const fragId = fragmentItemIdFor(target.name);
      if (e.requiredItemId === fragId && e.requiredItemQty === EVO_FRAGMENTS_PER_EVOLUTION) return e; // idempotent
      changed = true;
      assigned.push(`${t.name}→${target.name} (${fragId}, ×${EVO_FRAGMENTS_PER_EVOLUTION})`);
      return { ...e, requiredItemId: fragId, requiredItemQty: EVO_FRAGMENTS_PER_EVOLUTION };
    });
    return changed ? { ...t, evolvesInto } : t;
  });
  return { digimons: next, assigned, skipped };
}