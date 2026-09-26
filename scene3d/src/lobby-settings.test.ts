import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  LOBBY_EXPOSURE_REF,
  clampLobbyExposure,
  lobbyHdrCompensation,
  resolveLobbyFog,
} from './lobby-settings.js';

describe('resolveLobbyFog', () => {
  it('returns null when fog is disabled', () => {
    expect(resolveLobbyFog({ fogEnabled: false })).toBeNull();
    expect(resolveLobbyFog(null)).toBeNull();
    expect(resolveLobbyFog(undefined)).toBeNull();
  });

  it('builds a linear Fog honoring near/far when mode is linear (default)', () => {
    const fog = resolveLobbyFog({ fogColor: 0x123456, fogNear: 5, fogFar: 60 });
    expect(fog).toBeInstanceOf(THREE.Fog);
    expect((fog as THREE.Fog).near).toBe(5);
    expect((fog as THREE.Fog).far).toBe(60);
    expect((fog as THREE.Fog).color.getHex()).toBe(0x123456);
  });

  it('builds FogExp2 with density for exp2 mode (the Lobby scene ships exp2)', () => {
    const fog = resolveLobbyFog({ fogMode: 'exp2', fogDensity: 0.0664, fogNear: 7, fogFar: 70 });
    expect(fog).toBeInstanceOf(THREE.FogExp2);
    const e = fog as THREE.FogExp2;
    expect(e.density).toBeCloseTo(0.0664);
    // exp2 must NOT fall back to the linear near/far numbers
    expect((e as unknown as { near?: number }).near).toBeUndefined();
  });

  it('height mode behaves like exp2 (legacy heuristic: fogHeight>0 → 0.015)', () => {
    const below = resolveLobbyFog({ fogMode: 'height', fogHeight: -0.55, fogDensity: 0.0664 });
    expect((below as THREE.FogExp2).density).toBeCloseTo(0.0664);
    const above = resolveLobbyFog({ fogMode: 'height', fogHeight: 1, fogDensity: 0.0664 });
    expect((above as THREE.FogExp2).density).toBeCloseTo(0.015);
  });
});

describe('clampLobbyExposure / lobbyHdrCompensation', () => {
  it('honors the full editor range (0.2..2.5) — the 0.30 clamp bug', () => {
    expect(clampLobbyExposure(0.2)).toBeCloseTo(0.2);
    expect(clampLobbyExposure(0.5)).toBeCloseTo(0.5);
    expect(clampLobbyExposure(1.5)).toBeCloseTo(1.5);
    expect(clampLobbyExposure(2.5)).toBeCloseTo(2.5);
    expect(clampLobbyExposure(undefined)).toBeCloseTo(LOBBY_EXPOSURE_REF);
    expect(clampLobbyExposure(99)).toBeCloseTo(2.5);
    expect(clampLobbyExposure(0.001)).toBeCloseTo(0.1);
  });

  it('HDR compensation keeps the tune constant: brightness × exposure is invariant', () => {
    const base = 4 * lobbyHdrCompensation(0.28) * 0.28; // 4× albedo at the tune point
    expect(base).toBeCloseTo(4 * 0.28);
    // at exposure 1.0 the effective albedo drops so the sprite still lands at 4×0.28
    expect(4 * lobbyHdrCompensation(1.0) * 1.0).toBeCloseTo(base);
    expect(4 * lobbyHdrCompensation(0.2) * 0.2).toBeCloseTo(base);
  });
});