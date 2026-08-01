---
tags:
  - digiworld/system
aliases:
  - Weather
  - Particles
  - Weather + Particles
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - shared/src/weather.ts
  - backend/src/scenes/routes.ts
  - backend/src/scenes/store.ts
  - backend/src/particle-presets/routes.ts
  - backend/src/particle-presets/store.ts
  - backend/src/lobby/ws.ts
  - frontend/src/scene3d/particles/ParticleEmitter.ts
  - frontend/src/scene3d/particles/presets.ts
  - frontend/src/scene3d/particles/shaders.ts
  - frontend/src/scene3d/particles/ThunderFlashController.ts
  - frontend/src/scene3d/scene.ts
verified-at-commit: ee635a7
---

# Weather System

> [!info] TL;DR
> Weather = one or more particle emitters + optional lighting overrides +
> optional thunder-flash schedule. The particle model is generic (not just
> weather) — the SAME [`ParticleEmitterConfig`](shared/src/weather.ts:69)
> feeds custom battle VFX. Scenes reference either a built-in
> [`WeatherPreset`](shared/src/weather.ts:109) or a hand-authored inline
> config; admins can broadcast runtime overrides via `POST
> /api/admin/weather/trigger` → WS `weather-triggered` to every client.

Landed in commit [`ee635a7`](https://github.com/…/commit/ee635a7)
`feat(scene): particle preset editor + weather + time-of-day ambience system`.

## Design intent

Three tightly-integrated subsystems that share ONE runtime path:

1. **Weather** — atmospheric effects tied to a scene (rain in the forest
   biome, sandstorm in the desert)
2. **Time-of-day** — deterministic sun/fog/ambient cycle across 8 phases
3. **Particle preset library** — reusable named emitters for battle FX
   (attack VFX, capture bursts, evolution sparks)

All three compose the same `ParticleEmitter` + `TimeOfDayDriver` + shader
kit; the weather runtime and the standalone preset editor share the same
InstancedMesh pipeline.

## Shared types — [`shared/src/weather.ts`](shared/src/weather.ts)

### The 11 presets ([`weather.ts:109-122`](shared/src/weather.ts:109))

```typescript
export const WEATHER_PRESETS = [
  'clear',
  'rain',
  'thunderstorm',
  'hailstorm',
  'lightstorm',
  'sandstorm',
  'snow',
  'blizzard',
  'breeze',
  'fog',
  'ashfall',
] as const;
export type WeatherPreset = (typeof WEATHER_PRESETS)[number];
```

Each preset composes to a canned `WeatherConfig` in
[`frontend/src/scene3d/particles/presets.ts`](frontend/src/scene3d/particles/presets.ts).

### `WeatherConfig` ([`weather.ts:151-164`](shared/src/weather.ts:151))

```typescript
export type WeatherConfig = {
  readonly preset: WeatherPreset;
  readonly emitters: readonly ParticleEmitterConfig[];   // empty → use preset defaults
  readonly lighting: WeatherLightingOverride;
  readonly ambientAudioUrl?: string | null;
  readonly transitionMs?: number;                         // default 2000 ms
};
```

`emitters` semantics:
- **Empty** — the runtime uses the preset's built-in emitter set.
- **Non-empty** — REPLACES the preset entirely (fully custom composition).

### Lighting override

```typescript
export type WeatherLightingOverride = {
  readonly sunColor?: number;
  readonly sunIntensityMult?: number;    // multiplier on the current sunIntensity
  readonly ambientTint?: number;
  readonly ambientDimMult?: number;      // multiplier on hemi intensity
  readonly fogEnabled?: boolean;
  readonly fogColor?: number;
  readonly fogDensity?: number;
  readonly exposureMult?: number;
  readonly thunder?: ThunderFlashConfig;
};
```

### Thunder flash schedule ([`weather.ts:124-135`](shared/src/weather.ts:124))

```typescript
export type ThunderFlashConfig = {
  readonly enabled: boolean;
  readonly intervalMs: NumRange;         // random cadence, min/max
  readonly flashColor: number;
  readonly flashIntensity: number;       // peak keyLight intensity spike
  readonly durationMs: number;           // total envelope duration
  readonly stutterCount: number;         // sub-flash count for a stutter look
};
```

The controller ([`ThunderFlashController.ts`](frontend/src/scene3d/particles/ThunderFlashController.ts))
implements a 4-state envelope with stutter and non-destructive light
restoration — original intensities are stashed on start and restored on
stop, so a mid-storm scene reload won't leave the sun blown out.

### Particle emitter ([`weather.ts:69-107`](shared/src/weather.ts:69))

```typescript
export type ParticleEmitterConfig = {
  readonly id: string;
  readonly name: string;
  readonly kind: ParticleKind;
  readonly geometry: ParticleGeometry;
  readonly shader: ParticleShaderKind;
  readonly textureUrl?: string | null;

  readonly emissionRate: number;
  readonly maxParticles: number;
  readonly lifetimeMs: NumRange;

  readonly startSize: NumRange;   readonly endSize: NumRange;
  readonly startColor: number;    readonly endColor: number;
  readonly startOpacity: number;  readonly endOpacity: number;

  readonly velocity: Vec3Range;
  readonly gravity: readonly [number, number, number];
  readonly wind: readonly [number, number, number];
  readonly drag: number;
  readonly spawn: ParticleSpawn;

  readonly blending: ParticleBlending;
  readonly rotationSpeed?: NumRange;
  readonly collideGround?: boolean;      // hail bounces off y=0
  readonly bounciness?: number;
  readonly softParticles?: boolean;
  readonly castShadow?: boolean;
};
```

Every value is a `readonly`; configs are immutable so the same object can
be shared between presets without accidental mutation.

Kinds and shaders:

```typescript
export const PARTICLE_KINDS = ['instanced', 'points', 'streak', 'sprite'] as const;
export const PARTICLE_SHADERS = ['default', 'rainStreak', 'wetSpark', 'sandHaze',
                                 'thunderCore', 'snowFlake', 'hailShard'] as const;
export const SPAWN_SHAPES = ['box', 'disc', 'sphere', 'point', 'cone'] as const;
```

### Time of day ([`weather.ts:166-189`](shared/src/weather.ts:166))

```typescript
export const TIME_PHASES = ['dawn', 'morning', 'noon', 'afternoon',
                            'dusk', 'evening', 'night', 'midnight'] as const;

export type TimeOfDayConfig = {
  readonly mode: 'fixed' | 'auto' | 'server';
  readonly fixedPhase?: TimePhase;
  readonly cycleDurationMs?: number;
  readonly startPhase?: TimePhase;
};
```

- **`fixed`** — scene stays at `fixedPhase` permanently
- **`auto`** — client clock cycles through phases every `cycleDurationMs`
- **`server`** — reads server-broadcast phase (not yet implemented on
  broadcast side; falls back to `auto` semantics with server-clock sync)

### Runtime override ([`weather.ts:191-200`](shared/src/weather.ts:191))

```typescript
export type WeatherOverride = {
  readonly sceneId?: string | null;
  readonly matchId?: string | null;
  readonly weather: WeatherConfig;
  readonly durationMs: number;
  readonly startedAt: number;
};
```

This is what the WS `weather-triggered` message carries — see [[#WS
broadcast]].

## Runtime — `frontend/src/scene3d/particles/`

Four files, ~1400 lines total:

- **[`ParticleEmitter.ts`](frontend/src/scene3d/particles/ParticleEmitter.ts)**
  (414 lines) — generic `InstancedMesh` emitter. 10 k particle capacity per
  emitter, zero-alloc tick, spawn-shape support (box/disc/sphere/point/
  cone), `followCamera` mode for long-lived particles (rain / snow / sand
  keep pace with the camera), gravity + wind + drag integration, optional
  ground collision + bounce for hail.
- **[`shaders.ts`](frontend/src/scene3d/particles/shaders.ts)** (356 lines)
  — 7 custom `ShaderMaterial` factories. Three.js fog chunks are integrated
  so particles fade into the scene fog correctly; `rainStreak` /
  `snowFlake` implement velocity-aligned stretching so rain looks like
  streaks, not spheres.
- **[`presets.ts`](frontend/src/scene3d/particles/presets.ts)** (415 lines)
  — 11 canned `WeatherConfig` compositions, one per preset.
- **[`ThunderFlashController.ts`](frontend/src/scene3d/particles/ThunderFlashController.ts)**
  (229 lines) — the 4-state envelope + stutter + non-destructive restore.

## Scene integration — [`frontend/src/scene3d/scene.ts`](frontend/src/scene3d/scene.ts)

`SceneManager` gains two public methods:

```typescript
setWeather(config: WeatherConfig | null): void
setTimeOfDay(config: TimeOfDayConfig | null): void
```

Both **crossfade** — `transitionMs` (default 2000 ms) governs how long the
old emitters fade out while the new ones spin up. Fading emitters are
tracked in a parallel list so `dispose()` cleans EVERYTHING on scene
teardown, including in-flight fades.

Precedence rule (verify in
[`scene.ts`](frontend/src/scene3d/scene.ts)):

> Weather lighting takes precedence over time-of-day when both are active.

So a thunderstorm at noon still looks like a thunderstorm — the storm's
`sunIntensityMult: 0.3` wins over the time-of-day's `sunIntensity: 1.0`.

## Combat wiring — [`Combat3DScene.tsx`](frontend/src/components/combat3d/Combat3DScene.tsx)

Combat scene reads `scene.weather` + `scene.timeOfDay` from the resolved
scene at mount, subscribes to
[`wsStore.weatherOverride`](frontend/src/state/wsStore.ts) for runtime WS
overrides, and reverts to the scene default when the override's
`durationMs` elapses.

Reactivity: when `wsStore.weatherOverride` mutates (from a `weather-
triggered` WS message), the effect re-fires `setWeather()`.

## Scenes persistence — [`backend/src/scenes/store.ts`](backend/src/scenes/store.ts)

Scenes live in `data/scenes/scenes.json` as a versioned envelope:

```typescript
type SceneFileEnvelope = {
  readonly version: 2;
  readonly scenes: readonly SceneFileRecord[];
};

type SceneFileRecord = SceneEntity & {
  readonly weather: WeatherConfig | null;
  readonly timeOfDay: TimeOfDayConfig | null;
};
```

`SceneEntity` gained optional `weather` + `timeOfDay` fields
([`shared/src/scene.ts`](shared/src/scene.ts)). Legacy scene records
(from `scene-defaults.json`) auto-migrate on first read via
`seedFromLegacyDefaults()` — the old file becomes the seed, the new file
takes over.

## Particle preset library — backend

- **[`backend/src/particle-presets/store.ts`](backend/src/particle-presets/store.ts)**
  — file-backed CRUD over `data/particle-presets.json`
- **[`backend/src/particle-presets/routes.ts`](backend/src/particle-presets/routes.ts)**
  — endpoints

| Method | Path                                | Auth  |
| ------ | ----------------------------------- | ----- |
| GET    | `/api/particle-presets`             | user  |
| POST   | `/api/admin/particle-presets`       | admin |
| PUT    | `/api/admin/particle-presets/:id`   | admin |
| DELETE | `/api/admin/particle-presets/:id`   | admin |

> [!info] Read endpoint is user-scoped
> Non-admins call `GET /api/particle-presets` to fetch the current library
> (e.g. for the client-side preview). Admin CRUD is separate under
> `/api/admin/particle-presets`.

## WS broadcast

`POST /api/admin/weather/trigger` writes to the cluster
`weather:triggered` channel; every node's WS lobby subscribes and fans
out to its local sockets ([`backend/src/lobby/ws.ts`](backend/src/lobby/ws.ts)):

```typescript
// Client receives:
{
  type: 'weather-triggered',
  sceneId: 'scn_...',
  weather: WeatherConfig,
  durationMs: number,
  startedAt: number      // server epoch ms
}
```

Client-side handler ([`wsStore.ts`](frontend/src/state/wsStore.ts)) sets
`weatherOverride`; `Combat3DScene` subscribes and re-applies. A timed
revert clears the override when `Date.now() - startedAt > durationMs`.

## Editor UIs

### `SceneSettingsAdmin` — per-scene weather + time-of-day

Weather section — preset picker + lighting overrides (sun color/mult,
ambient tint/dim, fog toggle+color+density, exposure mult) + thunder
config (interval range, flash color, intensity, duration, stutter) +
advanced JSON emitter override for full custom compositions.

Time-of-day section — mode selector (`fixed | auto | server`) + fixed
phase + cycle duration.

Pinned **Trigger event** widget at the top — preset combobox + duration
slider + Broadcast button, fires `POST /api/admin/weather/trigger`.

### `AdminParticleEditor` — standalone particle editor

Route: `/admin/particles` (in the standalone admin panel).

Three-column layout: preset list on the left, form in the middle (GENERAL
/ EMISSION / APPEARANCE / MOTION / SPAWN sections with per-parameter
sliders), live preview canvas on the right. Save / Copy / Export /
Import / Delete actions in the top bar.

## Verified end-to-end (Playwright QA)

Fired during commit `ee635a7` — captured with a WS interceptor:

```json
{
  "type": "weather-triggered",
  "preset": "thunderstorm",
  "hasWeather": true,
  "durationMs": 10000,
  "sceneId": "scn_npz79njpbsqtjt9xc9fxwfrzht"
}
```

Full chain proven:
1. Admin clicks Broadcast → POST 202 Accepted
2. Backend logs `admin.weather.trigger`
3. Cluster `weather:triggered` publish
4. WS `weather-triggered` fanout to every connected client
5. `wsStore.weatherOverride` updates
6. Combat scene picks it up on next reactive tick

## Related

- [[Scenes]] — where `weather` + `timeOfDay` are persisted per-scene
- [[WebSocket Protocol#Server to client messages]] — the `weather-
  triggered` message
- [[HTTP Surface#Scenes + Particle presets + Weather]]
- [[Cluster Coordination Layer]] — `weather:triggered` channel
- [[Combat]] — subscribes to `wsStore.weatherOverride`
