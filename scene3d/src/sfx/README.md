# Audio / SFX subsystem

A data-driven sound system for the browser game, following the SFX spec
(no music yet, but a mixable `music` bus is created). Lives in
`scene3d/src/sfx/` so it's shared by the player frontend and the admin panel,
and is deliberately Three-agnostic: **callers project world → screen
coordinates themselves** (`SceneManager.projectWorldToScreen`, exposed as
`Combat3DSceneHandle.screenPositionOf`), so the engine runs headless in tests.

## Module map
- `types.ts` — shared vocabulary (buses, `SoundId` union, node backends).
- `manifest.ts` — the data-driven table: variations / bus / volume / pitch
  range / priority / instance limit per id, plus `pickVariationIndex`
  (round-robin, never repeats).
- `backend.ts` — browser Web Audio backend (`AudioContext` → `destination`).
- `engine.ts` — `SfxEngine`: Master(DynamicsCompressor) → sfx/ui/music buses,
  per-bus volume+mute persisted to `localStorage`, autoplay resume on first
  gesture, suspend/resume on `visibilitychange`, manifest preload (fetch +
  `decodeAudioData`, monotonic progress), and `play()` with voice stealing.
- `spatial.ts` — isometric spatialization math: pan ∝ screen X (±0.7),
  gain higher at center / reduced off-screen. Pure + unit-tested.
- `cue-router.ts` — `CueRouter`: game events → SFX plays; layered impacts
  (base + material + damage/heavy/crit), footsteps per surface, looping
  travel sounds tracked for `cancelLoops()`. Plus DOM delegation
  (`data-sfx` / `data-sfx-hover`, hover throttled ~50 ms).
- `fake-backend.ts` — deterministic headless backend for tests.

## Frontend wiring
- `frontend/src/lib/sfx-bootstrap.ts` — lazy singleton engine + DOM delegation
  bound to `document`, kicks off manifest preload.
- `frontend/src/lib/sfx-combat.ts` — translates `BattleEvent`s from the WS
  store into `CueEvent`s, spatialized to the scene; `Combat3DBody` feeds new
  events each frame.

## Key decisions
- **No external deps** — Web Audio + plain TS, matching the "no deps unless a
  strong reason" constraint.
- **One `AudioContext`**, reused by nothing else; the engine owns it.
- **Screen projection for spatial audio**, not distance-to-camera — required
  by the isometric camera.
- **Abstract `SfxBackend` seam** — the engine's only platform surface. Tests
  inject a fake; browser injects `AudioContext`. This is why all the voice/
  router/spatial logic is headlessly verifiable.
- **Layered impacts** (base + material + heavy + crit) come from `defaultCues`
  data, not per-ability code. Ability sfx would extend the manifest with a
  `sfx` block (`cast`/`travel`/`impact`/`miss`) — the `CueRouter` maps
  `ability:cast` → cast + looping projectile, `ability:hit` → layered impact.

## TODO
- **Author actual audio files** and put them under `frontend/public/assets/sfx/`
  (paths in the manifest are `/assets/sfx/<name>.mp3`). The engine tolerates
  missing files (plays silence, logs), so a partially-staged set is safe.
- **Per-skill sfx data**: add an optional `sfx` field to skills/catalog so a
  skill resolves its own cast → travel(loop) → impact layers, and route it
  through `CueRouter` instead of the generic material heuristic.
- **Per-unit surface/material** for footprints and impacts (currently a fixed
  `flesh`/`armor` heuristic in `sfx-combat.ts`).
- **Ducking**: background-gain duck during large impacts (150 ms) — the bus
  graph exists; add the sidechain/duck logic when mixing is tuned against real
  assets.
- **Progress UI**: the preload callback currently logs; wire it into the
  loading-transition screen when assets are real.
- **Deploy**: if sfx assets ship via content-deploy, add an `sfx/*` manifest
  prefix mirroring the arena-asset pattern (see `digimon-content-deploy`).