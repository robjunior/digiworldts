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

export function getArenaUrl(filename: string): string | undefined {
  return urlsByFilename[filename];
}

export const ARENA_MODEL_BY_KEY: Readonly<Record<string, string | undefined>> = Object.freeze({
  plant: urlsByFilename['plant.glb'],
  steel: urlsByFilename['steel.glb'],
  water: urlsByFilename['water.glb'],
  rock: urlsByFilename['rock.glb'],
  dark: urlsByFilename['dark.glb'],
  fire: urlsByFilename['fire.glb'],
  ice: urlsByFilename['ice.glb'],
  field: urlsByFilename['field.glb'],
  null: urlsByFilename['null.glb'],
  wind: urlsByFilename['wind.glb'],
  light: urlsByFilename['light.glb'],
});
