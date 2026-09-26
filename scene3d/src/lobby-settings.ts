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