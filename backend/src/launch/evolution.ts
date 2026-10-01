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

/** A roster Champion's drop-only fragment shop-item definition (enabled=0 → not in shop, grind only). */
export type EvolutionFragmentItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly payload: string;
  readonly sortOrder: number;
};

/**
 * One fragment shop-item per roster Champion species. These exist so inventory, the
 * evolution gate, and loot grants reference a real shop_items row; they are NOT
 * purchasable (drop-only).
 */
export function buildEvolutionFragmentItems(
  digimons: readonly TemplateDigimon[],
  speciesByShortName: ReadonlyMap<string, RosterSpecies>,
): EvolutionFragmentItem[] {
  const seen = new Set<string>();
  const out: EvolutionFragmentItem[] = [];
  for (const t of digimons) {
    if (t.stage !== 'Champion' || !speciesByShortName.has(t.name)) continue;
    const id = fragmentItemIdFor(t.name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: fragmentItemNameFor(t.name),
      description: `A fragment of ${t.name}. Collect ${EVO_FRAGMENTS_PER_EVOLUTION} to digivolve a Rookie into this Champion. Drops at a low rate from wild ${t.name} and its rookie pre-evolution.`,
      payload: JSON.stringify({ evolution_fragment: t.name }),
      sortOrder: 0,
    });
  }
  return out;
}

/** One evolution-key shop-item definition for a roster Champion. */
export type EvolutionKeyItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly payload: string;
  readonly target: string;
  readonly sortOrder: number;
};

/**
 * One evolution-key shop-item per roster Champion species. These are the items
 * consumed by evolution edges (requiredItemId) and crafted at the Rare Factory
 * from 5× the matching fragment.
 */
export function buildEvolutionKeyItems(
  digimons: readonly TemplateDigimon[],
  speciesByShortName: ReadonlyMap<string, RosterSpecies>,
): EvolutionKeyItem[] {
  const seen = new Set<string>();
  const out: EvolutionKeyItem[] = [];
  for (const t of digimons) {
    if (t.stage !== 'Champion' || !speciesByShortName.has(t.name)) continue;
    const id = `itm-evo-${t.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: `${t.name} Evolution Key`,
      description: `A key that unlocks evolution into ${t.name}. Consumed on evolution. Craft 5× ${t.name} Evolution Fragment at the Rare Factory.`,
      payload: JSON.stringify({ evolution_key: t.name.toLowerCase().replace(/[^a-z0-9]/g, ''), target: t.id }),
      target: t.id,
      sortOrder: 0,
    });
  }
  return out;
}

/** One evolution-fragment loot entry (per dropper species). */
export type EvolutionFragmentLoot = {
  readonly id: string;
  readonly catalogId: string;
  readonly itemId: string;
  readonly dropPct: number;
  readonly qtyMin: number;
  readonly qtyMax: number;
};

/**
 * catalog_loot_entries for the fragment drop economy. Two dropper classes, both at a
 * low rate:
 *   - the Champion itself drops its own fragment ("o próprio digimon pode dropar seu fragmento");
 *   - a canonical Rookie antecessor drops its canonical Champion's fragment.
 */
export function buildEvolutionFragmentLoot(
  digimons: readonly TemplateDigimon[],
  speciesByShortName: ReadonlyMap<string, RosterSpecies>,
): EvolutionFragmentLoot[] {
  const byName = new Map<string, TemplateDigimon>();
  for (const t of digimons) byName.set(t.name, t);
  const out: EvolutionFragmentLoot[] = [];
  const add = (dropperName: string, fragSpecies: string): void => {
    const dropper = byName.get(dropperName);
    const champion = byName.get(fragSpecies);
    if (!dropper || !champion) return;
    const itemId = fragmentItemIdFor(fragSpecies);
    out.push({
      id: `cle-frag-${dropper.id}-${itemId}`,
      catalogId: dropper.id,
      itemId,
      dropPct: EVO_FRAGMENT_DROP_PCT,
      qtyMin: 1,
      qtyMax: 1,
    });
  };
  // Antecessores: each canonical Rookie drops its canonical Champion's fragment.
  for (const [rookieName, champName] of Object.entries(CANONICAL_ROOKIE_TO_CHAMPION)) {
    add(rookieName, champName);
  }
  // Self-drops: every roster Champion drops its own fragment.
  for (const [name] of speciesByShortName) {
    const sp = byName.get(name);
    if (!sp || sp.stage !== 'Champion') continue;
    add(name, name);
  }
  return out;
}

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