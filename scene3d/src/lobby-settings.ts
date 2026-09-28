/**
 * Shared lobby stage settings math — used by BOTH LobbyScene3D (front) and
 * the admin ScenePreview so the preview mirrors the live lobby 1:1.
 *
 * Two hard-won rules live here:
 *
 * 1. The lobby fog must honor `fogMode` (`linear` | `exp2` | `height`). The
 *    front used to hard-code a LINEAR Fog and silently ignored the editor's
 *    exp2/height + density/height knobs — so a scene saved as exp2 (the Lobby
 *    scene ships as exp2) rendered clear in the front while the admin preview
 *    was wrapped in haze. `resolveLobbyFog` is the SINGLE source both sides
 *    call; never build fog inline in a renderer again.
 *
 * 2. The exposure knob (editor range 0.2..2.5) must be honored across its
 *    whole range. Both renderers clamped `Math.min(exposure, 0.30)`, which
 *    froze the knob for every value above 0.30 (96% of the slider) and kept
 *    the scene stuck dark. The unlit sprite sheets (MeshBasic), the stage
 *    spotlight pool and the volumetric shafts are tuned as HDR for a low
 *    exposure (LOBBY_EXPOSURE_REF) — so raising exposure would blow them out
 *    unless they scale INVERSELY with it. `lobbyHdrCompensation` keeps the
 *    tuned look constant while the exposure knob really drives the PBR-lit
 *    arena, exactly as the photographers expected when they set the knob.
 */
import * as THREE from 'three';

import type { SceneSettings } from './scene.js';

/** The exposure the HDR compensations (digimonBrightness, stage light pool,
 *  volumetric shafts) were tuned against. */
export const LOBBY_EXPOSURE_REF = 0.28;
/** Editor slider bounds (SceneSettingsAdmin: 0.2..2.5) + a safety floor. */
export const LOBBY_EXPOSURE_MIN = 0.1;
export const LOBBY_EXPOSURE_MAX = 2.5;

/** Clamp the editor exposure to its usable range. */
export function clampLobbyExposure(v: number | undefined): number {
  const x = v ?? LOBBY_EXPOSURE_REF;
  return Math.min(Math.max(x, LOBBY_EXPOSURE_MIN), LOBBY_EXPOSURE_MAX);
}

/** HDR compensations scale inversely with exposure so the unlit sprites/stage
 *  keep their tuned look at any exposure while the arena responds. */
export function lobbyHdrCompensation(exposure: number): number {
  return LOBBY_EXPOSURE_REF / Math.max(exposure, LOBBY_EXPOSURE_MIN);
}

/** World-space party ground + horizontal center of a loaded lobby GLB:
 *  1. `hdd_plattertop` top surface (arena field) — topmost platter wins;
 *  2. else the TOP of the largest-xz-footprint floor-ish surface
 *     (`Ground_*` / `*_Floor` / `Floor_*`) — biome/lodge fields seat the party
 *     ON their real floor plane, not on a `partyHeight` knob;
 *  3. else the model's lowest point + box center (last resort).
 *
 *  Used by BOTH LobbyScene3D (front) and the admin ScenePreview so the two
 *  always agree on where the party stands. Call after the GLB's FINAL
 *  transform (field for arenas, 34/sourceSpan normalize for platterless
 *  biomes/lodges) with root matrixWorld fresh. The `kind` lets the caller
 *  decide the transform BEFORE calling again (arena keeps the field
 *  transform; a platterless model is normalized to 34/sourceSpan first). */
export type LobbyPartyGround =
  | { kind: 'platter'; y: number; x: number; z: number }
  | { kind: 'floor'; y: number; x: number; z: number }
  | { kind: 'bbox'; y: number; x: number; z: number };

const PARTY_PLATTER_RE = /hdd_plattertop/i;
const PARTY_FLOOR_RE = /ground|_floor|floor/i;

export function lobbyPartyGround(root: THREE.Object3D): LobbyPartyGround | null {
  root.updateMatrixWorld(true);

  // 1. Arena: the party floor is the TOP of the hdd_plattertop element.
  let platter: LobbyPartyGround | null = null;
  root.traverse((o) => {
    if (!PARTY_PLATTER_RE.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    if (!Number.isFinite(b.max.y)) return;
    const c = b.getCenter(new THREE.Vector3());
    if (platter === null || b.max.y > platter.y) platter = { kind: 'platter', y: b.max.y, x: c.x, z: c.z };
  });
  if (platter !== null) return platter;

  // 2. Biome/lodge field: stand on the biggest flat surface (its ground
  //    plane), not on a stair/rock node with a smaller footprint.
  let floor: LobbyPartyGround | null = null;
  let floorArea = -1;
  root.traverse((o) => {
    if (!PARTY_FLOOR_RE.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    if (!Number.isFinite(b.max.y)) return;
    const s = b.getSize(new THREE.Vector3());
    const area = s.x * s.z;
    if (area <= floorArea) return;
    const c = b.getCenter(new THREE.Vector3());
    floor = { kind: 'floor', y: b.max.y, x: c.x, z: c.z };
    floorArea = area;
  });
  if (floor !== null) return floor;

  // 3. No recognizable floor — seat on the lowest point of the model.
  const b = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(b.min.y)) return null;
  const c = b.getCenter(new THREE.Vector3());
  return { kind: 'bbox', y: b.min.y, x: c.x, z: c.z };
}

const FOG_DEFAULT_COLOR = 0x1e2a44;
const FOG_DEFAULT_NEAR = 14;
const FOG_DEFAULT_FAR = 70;
const FOG_DEFAULT_DENSITY = 0.02;

/** Build the lobby fog from the editor settings, honoring the mode.
 *  `fogEnabled: false` (or missing settings) → no fog.
 *  Returns the SAME object types the preview renders — never build fog inline
 *  in a renderer; call this so front and preview stay 1:1. */
export function resolveLobbyFog(
  s: Partial<SceneSettings> | null | undefined,
): THREE.Fog | THREE.FogExp2 | null {
  if (s === null || s === undefined || s.fogEnabled === false) return null;
  const color = s.fogColor ?? FOG_DEFAULT_COLOR;
  const mode = s.fogMode ?? 'linear';
  if (mode === 'exp2' || mode === 'height') {
    // 'height' is currently exp2 with a density knob (no real height shader);
    // the >0 heuristic mirrors the legacy preview behavior exactly.
    const density =
      mode === 'height' && (s.fogHeight ?? 0) > 0 ? 0.015 : s.fogDensity ?? FOG_DEFAULT_DENSITY;
    return new THREE.FogExp2(color, density);
  }
  return new THREE.Fog(color, s.fogNear ?? FOG_DEFAULT_NEAR, s.fogFar ?? FOG_DEFAULT_FAR);
}