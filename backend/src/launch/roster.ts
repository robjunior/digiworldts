/**
 * Launch-meta roster — the curated champion-cap content gate for v1.
 *
 * Source of truth for WHICH species are obtainable at launch, WHERE (which place),
 * and HOW RARE (pool weight). Names resolve to real catalog ids at seed time via
 * `resolveSpeciesByName`; a name that does not exist in the catalog fails loudly
 * so the roster can never silently reference a phantom species.
 *
 * Champion-cap design (v1):
 *  - Only Rookie + Champion species are obtainable. Every Ultimate/Mega template is
 *    marked `status="draft"` — `EVOLUTION_LEVELS.Champion = 20` then blocks
 *    Rookie→Champion past lv 20 and no active Ultimate/Mega exists, so evolution
 *    ceilings itself.
 *  - Rarity is the place-pool `weight` (encounter rarity — the ONLY implemented
 *    knob today). Higher places carry lower weights → rarer species appear later.
 *  - "Disable a species" is TWO-PART: `status="draft"` on the template AND absence
 *    from every pool (draft alone still spawns — see content gating skill).
 *
 * About ~10 places, ~8 per place, elements mixed within each place for variety.
 */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic';

export type RosterSpecies = {
  /** Digimon name as it appears in the catalog XML (resolved to id at seed time). */
  readonly name: string;
  readonly tier: RarityTier;
  /** Encounter weight in the place pool. Higher = more common in that place. */
  readonly weight: number;
};

export type RosterStage = 'Rookie' | 'Champion';

export type LaunchPlace = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** World coords — all close to spawn (small spread around the origin). */
  readonly x: number;
  readonly y: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly minStage: RosterStage;
  readonly maxStage: RosterStage;
  readonly explore: readonly RosterSpecies[];
};

export const RARITY_WEIGHT: Record<RarityTier, number> = {
  common: 8,
  uncommon: 5,
  rare: 2,
  epic: 1,
};

const rookieC = (name: string): RosterSpecies => ({ name, tier: 'common', weight: 8 });
const champ = (name: string, tier: RarityTier): RosterSpecies => ({ name, tier, weight: RARITY_WEIGHT[tier] });

export const LAUNCH_PLACES: readonly LaunchPlace[] = [
  {
    id: 'campo-iniciantes', name: 'Campo dos Iniciantes',
    description: 'The starter fields — element basics for a fresh team.',
    x: 120, y: 120, minLevel: 1, maxLevel: 4, minStage: 'Rookie', maxStage: 'Rookie',
    explore: [
      rookieC('Agumon'), rookieC('Gabumon'), rookieC('Gomamon'), rookieC('Palmon'),
      rookieC('Biyomon'), rookieC('Patamon'), rookieC('Tentomon'), rookieC('Hagurumon'),
    ],
  },
  {
    id: 'bosque-novatos', name: 'Bosque dos Novatos',
    description: 'A quiet woodline where the second wave of Rookies runs.',
    x: 210, y: 150, minLevel: 3, maxLevel: 6, minStage: 'Rookie', maxStage: 'Rookie',
    explore: [
      rookieC('Lunamon'), rookieC('Terriermon'), rookieC('Guilmon'), rookieC('Gaomon'),
      rookieC('Veemon'), rookieC('Coronamon'), rookieC('Renamon'), rookieC('Lalamon'),
    ],
  },
  {
    id: 'varzea-ventos', name: 'Várzea dos Ventos',
    description: 'Windswept flats — varied element Rookies the player has not met yet.',
    x: 300, y: 180, minLevel: 5, maxLevel: 8, minStage: 'Rookie', maxStage: 'Rookie',
    explore: [
      rookieC('Dorumon'), rookieC('Lopmon'), rookieC('Tapirmon'), rookieC('Kudamon'),
      rookieC('FunBeemon'), rookieC('Kamemon'), rookieC('Chuumon'), rookieC('ToyAgumon'),
    ],
  },
  {
    id: 'mata-tropical', name: 'Mata Tropical',
    description: 'Dense jungle — the braver Rookies and the first evolution pressure.',
    x: 390, y: 210, minLevel: 7, maxLevel: 10, minStage: 'Rookie', maxStage: 'Rookie',
    explore: [
      { name: 'DemiDevimon', tier: 'common', weight: 7 }, { name: 'Impmon', tier: 'common', weight: 7 },
      { name: 'Kotemon', tier: 'common', weight: 7 }, { name: 'Crabmon', tier: 'common', weight: 7 },
      { name: 'Ryudamon', tier: 'common', weight: 7 }, { name: 'Dracomon', tier: 'common', weight: 7 },
      { name: 'Bearmon', tier: 'common', weight: 7 }, { name: 'Gotsumon', tier: 'common', weight: 7 },
      { name: 'Goblimon', tier: 'common', weight: 7 },
    ],
  },
  {
    id: 'caverna-gelo', name: 'Caverna de Gelo',
    description: 'Frozen caves — the first Champion-tier wilds appear here.',
    x: 480, y: 240, minLevel: 9, maxLevel: 12, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Frigimon', 'common'), champ('Icemon', 'common'), champ('Hyogamon', 'common'),
      champ('Mojyamon', 'common'), champ('Bakemon', 'common'), champ('Vegiemon', 'common'),
      champ('Woodmon', 'common'), champ('Snimon', 'common'),
    ],
  },
  {
    id: 'lago-abissal', name: 'Lago Abissal',
    description: 'Deep lake — water and classic Champions.',
    x: 570, y: 270, minLevel: 11, maxLevel: 14, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Ikkakumon', 'common'), champ('Lekismon', 'common'), champ('Gawappamon', 'common'),
      champ('Greymon', 'common'), champ('Garurumon', 'common'), champ('GeoGreymon', 'common'),
      champ('Sunflowmon', 'common'), champ('Togemon', 'common'),
    ],
  },
  {
    id: 'floresta-aco', name: 'Floresta de Aço',
    description: 'Steel boughs — armored Champions with stamina.',
    x: 660, y: 300, minLevel: 13, maxLevel: 16, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Dorugamon', 'uncommon'), champ('Raptordramon', 'uncommon'), champ('Guardromon', 'uncommon'),
      champ('Tankmon', 'uncommon'), champ('Mekanorimon', 'uncommon'), champ('Gargomon', 'uncommon'),
      champ('Leomon', 'uncommon'), champ('Gaogamon', 'uncommon'), champ('Drimogemon', 'uncommon'),
    ],
  },
  {
    id: 'pantano-sombrio', name: 'Pântano Sombrio',
    description: 'Murk — aggressive fire and dark Champions.',
    x: 750, y: 330, minLevel: 15, maxLevel: 18, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Devimon', 'uncommon'), champ('Sangloupmon', 'uncommon'), champ('Strikedramon', 'uncommon'),
      champ('Veedramon', 'uncommon'), champ('Growlmon', 'uncommon'), champ('Meramon', 'uncommon'),
      champ('Firamon', 'uncommon'), champ('Kyubimon', 'uncommon'),
    ],
  },
  {
    id: 'cume-relampago', name: 'Cume Relâmpago',
    description: 'Storm crest — rare Champions, the first real chase.',
    x: 840, y: 360, minLevel: 17, maxLevel: 20, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Angemon', 'rare'), champ('Gatomon', 'rare'), champ('Aquilamon', 'rare'),
      champ('Wendigomon', 'rare'), champ('Kuwagamon', 'rare'), champ('Kabuterimon', 'rare'),
    ],
  },
  {
    id: 'pico-fim-de-jogo', name: 'Pico do Fim de Jogo',
    description: 'The summit — epic Champions with identity finishers. The launch chase.',
    x: 900, y: 390, minLevel: 19, maxLevel: 22, minStage: 'Champion', maxStage: 'Champion',
    explore: [
      champ('Birdramon', 'epic'), champ('ExVeemon', 'epic'), champ('Airdramon', 'epic'),
      champ('Grizzlymon', 'epic'), champ('Angemon', 'epic'), champ('Gatomon', 'epic'),
    ],
  },
];

/** Every species referenced across all places, deduped, name-keyed. */
export function rosterUniverse(): ReadonlyMap<string, RosterSpecies> {
  const map = new Map<string, RosterSpecies>();
  for (const place of LAUNCH_PLACES) {
    for (const s of place.explore) map.set(s.name, s);
  }
  return map;
}