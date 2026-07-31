import type { Element } from './digimon.js';

/**
 * A named scene entity. Scenes are the CRUD-managed replacement for the old
 * per-arena `scene-defaults.json`: each has a name, a set of `elements` it
 * belongs to (many-to-many with the 11-element taxonomy), and a partial
 * `SceneSettings`-shaped body (lighting / camera / fog / arena offsets /
 * `modelFile`).
 *
 * The `settings` field intentionally stays untyped at the shared boundary —
 * `SceneSettings` lives in the frontend `scene3d` module and the backend zod
 * validator is the source of truth for allowed keys. Rendering code casts
 * this to `Partial<SceneSettings>` on the frontend after fetch.
 */
export type SceneEntity = {
  readonly id: string;
  readonly name: string;
  readonly elements: readonly Element[];
  readonly settings: Readonly<Record<string, unknown>>;
  /**
   * When true, combat renders this scene using whatever the GLB itself
   * defines — its embedded cameras, lights, materials, environment — and
   * ignores `settings` (except `modelFile` which stays as the mesh URL).
   * When false / undefined, `settings` drives lighting/camera/fog like today.
   *
   * The frontend `SceneManager` still applies its default lights when the
   * GLB provides none, so a bare-geometry GLB won't render pitch-black.
   */
  readonly useGlbSettings?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

/**
 * Legacy arena keys the old `scene-defaults.json` used. Kept here as a shared
 * constant so the seed migration + the frontend `pickArenaKey` fallback agree
 * on the exact set. Field is the neutral catch-all with no matching element.
 */
export const LEGACY_ARENA_KEYS = [
  'plant', 'steel', 'water', 'rock', 'dark', 'fire',
  'ice', 'field', 'null', 'wind', 'light',
] as const;
export type LegacyArenaKey = (typeof LEGACY_ARENA_KEYS)[number];

/**
 * Which elements historically mapped to each arena key. Used to seed the
 * initial named-scenes list from the old per-arena defaults, and by the
 * frontend fallback path when a battle has no explicit `sceneId`.
 *
 * Mirror of `ARENA_BY_ELEMENT` in `frontend/src/components/combat3d/Combat3DScene.tsx`,
 * reversed. `field` has no element mapping and is kept as an unassigned scene.
 */
export const ARENA_KEY_TO_ELEMENTS: Readonly<Record<LegacyArenaKey, readonly Element[]>> = {
  plant: ['plant'],
  steel: ['steel', 'electricity'],
  water: ['water'],
  rock: ['earth'],
  dark: ['dark'],
  fire: ['fire'],
  ice: ['ice'],
  field: [],
  null: ['null'],
  wind: ['wind'],
  light: ['light'],
};

/**
 * Element → preferred legacy arena key, for the frontend fallback when a
 * battle has no `sceneId` and no scene tagged with the enemy element exists.
 */
export const ELEMENT_TO_ARENA_KEY: Readonly<Record<Element, LegacyArenaKey>> = {
  fire: 'fire',
  water: 'water',
  plant: 'plant',
  ice: 'ice',
  electricity: 'steel',
  earth: 'rock',
  steel: 'steel',
  wind: 'wind',
  light: 'light',
  dark: 'dark',
  null: 'null',
};

export type SceneListResponse = { readonly scenes: readonly SceneEntity[] };
export type SceneMutationResponse = { readonly ok: true; readonly scene: SceneEntity };
export type SceneDeleteResponse = { readonly ok: true };

export type SceneCreateInput = {
  readonly name: string;
  readonly elements: readonly Element[];
  readonly settings: Readonly<Record<string, unknown>>;
};

export type SceneUpdateInput = Partial<SceneCreateInput>;
