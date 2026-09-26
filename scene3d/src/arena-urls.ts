const modules = import.meta.glob('../assets/arenas/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Readonly<Record<string, string>>;

const urlsByFilename: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
  ),
);

export const ARENA_FILE_LIST: readonly string[] = Object.freeze(
  Object.keys(urlsByFilename).sort((a, b) => a.localeCompare(b)),
);

export function getArenaUrl(filename: string): string | undefined {
  return urlsByFilename[filename];
}

const PUBLISHED_SCENE_MODEL_PATH = /^\/assets\/scenes\/scn_[0-9a-hjkmnp-tv-z]{26}\/rev_[a-f0-9]{32}\/scene\.glb$/;

/** Seeded arena GLB served by the backend at /assets/arenas (content-deploy). */
const SEEDED_ARENA_PATH = /^\/assets\/arenas\/[a-zA-Z0-9._-]+\.glb$/;

/** Resolve a stored scene model reference without permitting arbitrary fetches. */
export function resolveSceneModelUrl(modelFile: string | undefined, fallback?: string): string | undefined {
  if (modelFile === undefined || modelFile === '') return fallback;
  if (PUBLISHED_SCENE_MODEL_PATH.test(modelFile)) return modelFile;
  if (SEEDED_ARENA_PATH.test(modelFile)) return modelFile;
  return getArenaUrl(modelFile) ?? fallback;
}

export const ARENA_MODEL_BY_KEY: Readonly<Record<string, string | undefined>> = Object.freeze({
  plant: urlsByFilename['forest_biome.glb'],
  steel: urlsByFilename['factory_biome.glb'],
  water: urlsByFilename['frost_biome.glb'],
  rock: urlsByFilename['rock_biome.glb'],
  dark: urlsByFilename['dark_biome.glb'],
  fire: urlsByFilename['lava_river_biome.glb'],
  ice: urlsByFilename['frost_biome.glb'],
  field: urlsByFilename['toytown_biome.glb'],
  null: urlsByFilename['dark_lodge_biome.glb'],
  wind: urlsByFilename['forest_biome.glb'],
  light: urlsByFilename['toytown_biome.glb'],
});

export const DEFAULT_ARENA_MODEL: string | undefined =
  urlsByFilename['forest_biome.glb']
  ?? urlsByFilename['toytown_biome.glb']
  ?? Object.values(urlsByFilename)[0];
