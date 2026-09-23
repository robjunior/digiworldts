/**
 * Guard for the lobby scene settings contract.
 *
 * The Lobby screen (frontend/src/routes/Lobby.tsx) reads its CSS-3D backdrop
 * knobs from a SceneEntity named "Lobby" through the same zod-validated
 * `settings.lobby` payload the admin editor persists. This test locks the
 * contract at the backend boundary so a future rename/regime change can't
 * silently break the lobby while all combat-scene tests stay green:
 *
 *   1. A full DEFAULT_LOBBY_SCENE-shaped payload parses.
 *   2. Unknown keys are rejected (.strict()).
 *   3. Out-of-range values are rejected (drift, particle count, colors).
 *   4. The `lobby` key is accepted inside ArenaSettingsZ alongside arena keys.
 */
import { ArenaSettingsZ, LobbySceneSettingsZ } from '../src/scenes/routes.js';

/** Canonical defaults — mirrors DEFAULT_LOBBY_SCENE in scene3d/src/scene.ts. */
const DEFAULT_LOBBY_SCENE = {
  pedestalSpacing: 256,
  pedestalScale: 1,
  sideTiltDeg: 17,
  centerScale: 1.1,
  centerLift: 36,
  partyHeight: 0,
  driftIntensity: 1,
  digimonBrightness: 4,
  stageLightIntensity: 3,
  volumetricIntensity: 2,
  volumetricSoftness: 0.55,
  volumetricDistanceBlur: 0.65,
} as const;

let failures = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

// 1. full payload parses
const full = LobbySceneSettingsZ.safeParse(DEFAULT_LOBBY_SCENE);
check('full DEFAULT_LOBBY_SCENE payload parses', full.success === true);

// 2. strict: unknown key rejected
const unknown = LobbySceneSettingsZ.safeParse({ ...DEFAULT_LOBBY_SCENE, extraKnob: 1 });
check('unknown key rejected (strict)', unknown.success === false);

// 3a. out-of-range drift rejected
check(
  'driftIntensity out of range rejected',
  LobbySceneSettingsZ.safeParse({ ...DEFAULT_LOBBY_SCENE, driftIntensity: 5 }).success === false,
);
// 3b. out-of-range particle count rejected
check(
  'particleCount out of range rejected',
  LobbySceneSettingsZ.safeParse({ ...DEFAULT_LOBBY_SCENE, particleCount: 500 }).success === false,
);
// 3c. out-of-range color rejected (0xffffff max)
check(
  'floorColor out of range rejected',
  LobbySceneSettingsZ.safeParse({ ...DEFAULT_LOBBY_SCENE, floorColor: 0x1000000 }).success === false,
);
// 3d. campos do ambiente procedural (removidos do schema) são rejeitados
check(
  'campos do ambiente antigo (floorColor/particles) rejeitados (strict)',
  LobbySceneSettingsZ.safeParse({
    ...DEFAULT_LOBBY_SCENE,
    floorColor: 0x0a0e1a,
    particleCount: 26,
  } as never).success === false,
);

// 4. `lobby` composes inside ArenaSettingsZ with arena keys
const arena = ArenaSettingsZ.safeParse({
  sunColor: 0xfff2d0,
  camDist: 14,
  modelFile: 'my_scene.glb',
  lobby: DEFAULT_LOBBY_SCENE,
});
check('lobby key accepted inside ArenaSettingsZ', arena.success === true);

// 5. sanitizer rescata cenas antigas: só chaves conhecidas sobrevivem
import { sanitizeLobbySettings } from '../src/scenes/lobby-schema.js';
const dirty = {
  floorColor: 0x0a0e1a,
  gridColor: 0x60a5fa,
  particleCount: 26,
  pedestalSpacing: 256,
  driftIntensity: 1,
};
const clean = sanitizeLobbySettings(dirty);
check(
  'sanitizeLobbySettings descarta campos do ambiente antigo',
  clean !== undefined
    && Object.keys(clean ?? {}).length === 2
    && clean!.pedestalSpacing === 256
    && clean!.driftIntensity === 1
    && !('floorColor' in (clean ?? {})),
);
check(
  'sanitizeLobbySettings retorna undefined sem chaves conhecidas',
  sanitizeLobbySettings({ floorColor: 1, particleCount: 26 }) === undefined,
);

// 6. cena legada sem partyHeight (salva antes do knob) ainda salva — o campo
// é opcional no zod; o frontend aplica o default (DEFAULT_LOBBY_SCENE).
const legacyNoHeight = {
  pedestalSpacing: 256,
  pedestalScale: 1,
  sideTiltDeg: 17,
  centerScale: 1.1,
  centerLift: 36,
  driftIntensity: 1,
};
check(
  'legacy lobby sem partyHeight aceito (optional)',
  LobbySceneSettingsZ.safeParse(legacyNoHeight).success === true,
);

process.exit(failures > 0 ? 1 : 0);