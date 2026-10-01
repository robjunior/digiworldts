/**
 * Evolution item system — 3 item types required for every evolution:
 *
 * 1. ELEMENTAL ESSENCE (e.g. "Fire Essence") — per element of the TARGET digimon.
 *    Craftable at the Rare Factory from fragments dropped by digimons of the
 *    previous stage. One essence per element.
 *
 * 2. RARITY CORE (e.g. "Rare Core") — per rarity of the TARGET digimon.
 *    Purchasable in the shop for netcore. One core per rarity tier.
 *
 * 3. ARCHETYPE SIGIL (e.g. "Puppet Sigil") — per `type` field of the TARGET
 *    digimon in the catalog (Puppet, Mammal, Beast Man, etc.). Purchasable in
 *    the shop for netcore, plus a ultra-rare drop: 0.02% from the target
 *    digimon itself, 0.01% from its previous-stage antecessor.
 *
 * All three are required to evolve. Only published digimons are considered.
 */
import type { TemplateDigimon } from '../digimon/xml.js';
import type { Rarity } from '@digiworld/shared/item-rarity';

// ── Elemental Essences ──────────────────────────────────────────────────────

export type ElementalEssence = {
  readonly id: string;
  readonly element: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
};

const ELEMENT_SLUGS: Record<string, string> = {
  fire: 'fire',
  water: 'water',
  plant: 'plant',
  ice: 'ice',
  electricity: 'electricity',
  earth: 'earth',
  steel: 'steel',
  wind: 'wind',
  light: 'light',
  dark: 'dark',
  null: 'null',
};

export function buildElementalEssences(): ElementalEssence[] {
  const out: ElementalEssence[] = [];
  for (const [element, slug] of Object.entries(ELEMENT_SLUGS)) {
    out.push({
      id: `itm-essence-${slug}`,
      element,
      name: `${element.charAt(0).toUpperCase() + element.slice(1)} Essence`,
      description: `A concentrated ${element} essence. Required to evolve into a ${element}-element Digimon. Craft 5× ${element} Fragments at the Rare Factory.`,
      sortOrder: 0,
    });
  }
  return out;
}

// ── Rarity Cores ────────────────────────────────────────────────────────────

export type RarityCore = {
  readonly id: string;
  readonly rarity: Rarity;
  readonly name: string;
  readonly description: string;
  readonly priceNetcore: number;
  readonly sortOrder: number;
};

const RARITY_CORES: { rarity: Rarity; label: string; price: number }[] = [
  { rarity: 'common', label: 'Common', price: 500 },
  { rarity: 'rare', label: 'Rare', price: 1500 },
  { rarity: 'epic', label: 'Epic', price: 4000 },
  { rarity: 'legendary', label: 'Legendary', price: 10000 },
];

export function buildRarityCores(): RarityCore[] {
  return RARITY_CORES.map(({ rarity, label, price }) => ({
    id: `itm-core-${rarity}`,
    rarity,
    name: `${label} Core`,
    description: `A ${label.toLowerCase()} rarity core. Required to evolve into a ${label.toLowerCase()}-rarity Digimon. Purchasable for netcore.`,
    priceNetcore: price,
    sortOrder: 0,
  }));
}

// ── Archetype Sigils ────────────────────────────────────────────────────────

export type ArchetypeSigil = {
  readonly id: string;
  readonly archetype: string;
  readonly name: string;
  readonly description: string;
  readonly priceNetcore: number;
  readonly sortOrder: number;
};

/**
 * Build one sigil per unique `type` value found in published digimons.
 * Sigils are purchasable for netcore and drop ultra-rarely from the target
 * digimon (0.02%) and its previous-stage antecessor (0.01%).
 */
export function buildArchetypeSigils(digimons: readonly TemplateDigimon[]): ArchetypeSigil[] {
  const seen = new Set<string>();
  const out: ArchetypeSigil[] = [];
  for (const t of digimons) {
    if (!t.type || (t.status ?? 'published') !== 'published') continue;
    const slug = t.type.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const id = `itm-sigil-${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      archetype: t.type,
      name: `${t.type} Sigil`,
      description: `A ${t.type} archetype sigil. Required to evolve into a ${t.type} Digimon. Purchasable for netcore. Ultra-rare drop from ${t.type} Digimon.`,
      priceNetcore: 2000,
      sortOrder: 0,
    });
  }
  return out;
}

// ── Fragment drops (previous stage → target element) ───────────────────────

export type FragmentDrop = {
  readonly id: string;
  readonly catalogId: string;
  readonly itemId: string;
  readonly dropPct: number;
  readonly qtyMin: number;
  readonly qtyMax: number;
};

/**
 * Fragment drops for the elemental essence crafting economy. Each digimon
 * drops fragments of its OWN element (used to craft essences for digimons of
 * that element). The target digimon drops at a higher rate (10%), the
 * previous-stage antecessor at a lower rate (5%).
 */
export function buildFragmentDrops(
  digimons: readonly TemplateDigimon[],
): FragmentDrop[] {
  const byId = new Map(digimons.map((t) => [t.id, t]));
  const out: FragmentDrop[] = [];
  const seen = new Set<string>();

  for (const t of digimons) {
    if ((t.status ?? 'published') !== 'published') continue;
    if (!t.element) continue;
    const slug = ELEMENT_SLUGS[t.element] ?? t.element;
    const itemId = `itm-frag-${slug}`;

    // Self-drop: the digimon drops its own element's fragment at 10%
    const selfId = `cle-frag-${t.id}-${itemId}`;
    if (!seen.has(selfId)) {
      seen.add(selfId);
      out.push({
        id: selfId,
        catalogId: t.id,
        itemId,
        dropPct: 10,
        qtyMin: 1,
        qtyMax: 1,
      });
    }

    // Antecessor drop: previous-stage digimon drops the next stage's fragment at 5%
    // (e.g. Agumon drops fire fragments for Greymon)
    for (const edge of t.evolvesInto ?? []) {
      const target = byId.get(edge.targetId);
      if (!target || !target.element) continue;
      const targetSlug = ELEMENT_SLUGS[target.element] ?? target.element;
      const targetItemId = `itm-frag-${targetSlug}`;
      const antId = `cle-frag-${t.id}-${targetItemId}`;
      if (seen.has(antId)) continue;
      seen.add(antId);
      out.push({
        id: antId,
        catalogId: t.id,
        itemId: targetItemId,
        dropPct: 5,
        qtyMin: 1,
        qtyMax: 1,
      });
    }
  }
  return out;
}

// ── Archetype sigil drops (ultra-rare) ─────────────────────────────────────

export type SigilDrop = {
  readonly id: string;
  readonly catalogId: string;
  readonly itemId: string;
  readonly dropPct: number;
  readonly qtyMin: number;
  readonly qtyMax: number;
};

/**
 * Ultra-rare sigil drops: 0.02% from the target digimon itself, 0.01% from its
 * previous-stage antecessor. Only for published digimons with a `type`.
 */
export function buildSigilDrops(
  digimons: readonly TemplateDigimon[],
): SigilDrop[] {
  const byId = new Map(digimons.map((t) => [t.id, t]));
  const out: SigilDrop[] = [];
  const seen = new Set<string>();

  for (const t of digimons) {
    if (!t.type || (t.status ?? 'published') !== 'published') continue;
    const slug = t.type.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const itemId = `itm-sigil-${slug}`;

    // Self-drop: 0.02%
    const selfId = `cle-sigil-${t.id}-${itemId}`;
    if (!seen.has(selfId)) {
      seen.add(selfId);
      out.push({
        id: selfId,
        catalogId: t.id,
        itemId,
        dropPct: 0.02,
        qtyMin: 1,
        qtyMax: 1,
      });
    }

    // Antecessor drop: 0.01%
    for (const edge of t.evolvesInto ?? []) {
      const target = byId.get(edge.targetId);
      if (!target || !target.type) continue;
      const targetSlug = target.type.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const targetItemId = `itm-sigil-${targetSlug}`;
      const antId = `cle-sigil-${t.id}-${targetItemId}`;
      if (seen.has(antId)) continue;
      seen.add(antId);
      out.push({
        id: antId,
        catalogId: t.id,
        itemId: targetItemId,
        dropPct: 0.01,
        qtyMin: 1,
        qtyMax: 1,
      });
    }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Get the elemental essence item id for a given element. */
export function essenceIdFor(element: string): string {
  const slug = ELEMENT_SLUGS[element] ?? element;
  return `itm-essence-${slug}`;
}

/** Get the rarity core item id for a given rarity. */
export function coreIdFor(rarity: Rarity): string {
  return `itm-core-${rarity}`;
}

/** Get the archetype sigil item id for a given type. */
export function sigilIdFor(type: string): string {
  const slug = type.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `itm-sigil-${slug}`;
}

/** Get the fragment item id for a given element. */
export function fragmentIdFor(element: string): string {
  const slug = ELEMENT_SLUGS[element] ?? element;
  return `itm-frag-${slug}`;
}

/** Derive rarity from a digimon's stage. */
export function rarityForStage(stage: string): Rarity {
  if (stage === 'Mega') return 'legendary';
  if (stage === 'Ultimate') return 'epic';
  if (stage === 'Champion') return 'rare';
  return 'common';
}
