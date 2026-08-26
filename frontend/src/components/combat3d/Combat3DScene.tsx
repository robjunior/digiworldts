import type { BattleView, EnemyUnitView, UnitId } from '@digiworld/shared/battle';
import { ELEMENT_TO_ARENA_KEY } from '@digiworld/shared/scene';
import type { SceneEntity } from '@digiworld/shared/scene';
import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { SceneManager, type SceneSettings, type SpriteInit } from '@digiworld/scene3d';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { SpriteSide } from '@digiworld/scene3d/sprite-rig';
import { ARENA_MODEL_BY_KEY, DEFAULT_ARENA_MODEL, getArenaUrl } from '@digiworld/scene3d/arena-urls';
import { getSceneDefaults, type PerArenaSceneDefaults } from '../../lib/scene-defaults';
import { getScenes } from '../../lib/api-scenes';
import { unitSpriteSheetUrl } from '../../lib/asset-preload';
import { useAuth } from '../../hooks/useAuth';
import { useWsStore } from '../../state/wsStore';
import { useT } from '../../hooks/useLocale';
import type { WeatherOverrideState } from '../../state/wsStore';

/** Shared module constants. */
const TOOLTIP_DELAY_MS = 300;
const HOVER_SPRITE_SIDE: SpriteSide = 'opp';
const LOCAL_STORAGE_OVERRIDE_KEY = 'digiworld.scene-settings-override';
const LOCAL_STORAGE_BASELINE_KEY = 'digiworld.scene-defaults-baseline';

/** Opt-in perf HUD: append `?hud=1` to the URL to show FPS/ms/draws/triangles. */
function hudFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = new URLSearchParams(window.location.search).get('hud');
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

/** Null-safe accessor for the SceneManager ref. Returns null (and warns) when
 *  the manager has not been initialized yet, so callers can early-return
 *  instead of repeating `sceneRef.current === null` checks. */
function useSceneManager() {
  const sceneRef = useRef<SceneManager | null>(null);

  const getManager = useCallback((): SceneManager | null => {
    if (sceneRef.current === null) {
      console.warn('SceneManager not initialized');
      return null;
    }
    return sceneRef.current;
  }, []);

  return { sceneRef, getManager };
}

const ARENA_BY_ELEMENT: Readonly<Record<string, string>> = {
  plant: 'plant',
  nature: 'plant',
  wind: 'wind',
  earth: 'rock',
  steel: 'steel',
  electricity: 'steel',
  fire: 'fire',
  dark: 'dark',
  water: 'water',
  ice: 'ice',
  light: 'light',
  null: 'null',
};

const ARENA_FALLBACK = 'steel';

function pickArenaKey(battle: BattleView): string {
  const counts = new Map<string, number>();
  for (const enemy of battle.enemy) {
    const arena = ARENA_BY_ELEMENT[enemy.element];
    if (arena !== undefined) counts.set(arena, (counts.get(arena) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let bestKey = ARENA_FALLBACK;
    let bestCount = 0;
    for (const [key, n] of counts) {
      if (n > bestCount) { bestCount = n; bestKey = key; }
    }
    return bestKey;
  }
  for (const mon of battle.friendly) {
    const arena = ARENA_BY_ELEMENT[mon.element];
    if (arena !== undefined) return arena;
  }
  return ARENA_FALLBACK;
}

function arenaKeyForScene(scene: SceneEntity, fallbackArenaKey: string): string {
  const first = scene.elements[0];
  if (first !== undefined) return ELEMENT_TO_ARENA_KEY[first];
  return fallbackArenaKey;
}

type SceneResolution = {
  readonly source: 'scene-entity' | 'arena-defaults';
  readonly arenaKey: string;
  readonly modelUrl: string | undefined;
  readonly useGlbSettings: boolean;
  readonly settingsPatch: Partial<SceneSettings>;
  readonly weather: WeatherConfig | null;
  readonly timeOfDay: TimeOfDayConfig | null;
};

export type Combat3DSceneHandle = {
  playEffect(element: AnimatedElement, sourceId: UnitId | null, targetId: UnitId, opts?: { readonly onImpact?: () => void; readonly vfxPresetId?: string }): void;
  screenPositionOf(unitId: UnitId): { readonly x: number; readonly y: number } | null;
  getSettings(): SceneSettings | null;
  applySettings(patch: Partial<SceneSettings>): void;
};

type SceneProps = {
  readonly battle: BattleView;
  readonly onReady?: () => void;
};

type UnitPlacement = {
  readonly unitId: UnitId;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly textureUrl: string;
  readonly down: boolean;
};

// Combat uses the 2×2 four-frame sprite sheets (walk row + hit row). The dot.gif
// is the fallback for digimons that lack a generated sheet; the rig detects a
// missing image and keeps the placeholder, so a bad URL never hard-fails.
function toPlacements(battle: BattleView): readonly UnitPlacement[] {
  const you = battle.friendly.map((unit, index) => {
    const placement: UnitPlacement = {
      unitId: unit.id,
      side: 'you' as SpriteSide,
      slotIndex: index,
      textureUrl: unitSpriteSheetUrl(unit.templateId),
      down: unit.down,
    };
    return placement;
  });
  const opp = battle.enemy.map((unit, index) => {
    const placement: UnitPlacement = {
      unitId: unit.id,
      side: 'opp' as SpriteSide,
      slotIndex: index,
      textureUrl: unitSpriteSheetUrl(unit.templateId),
      down: unit.down,
    };
    return placement;
  });
  return [...you, ...opp];
}

function extractPatch(raw: Readonly<Record<string, unknown>>): Partial<SceneSettings> {
  const patch: Record<string, unknown> = { ...raw };
  delete patch['modelFile'];
  return patch as Partial<SceneSettings>;
}

/** Build a SceneResolution from a matched scene entity, or null if no scene
 *  matched `sceneId`. `modelUrl` is `undefined` only when the entity has no
 *  `modelFile` AND there is no element-keyed fallback — in that case the caller
 *  falls back to `DEFAULT_ARENA_MODEL` when it actually loads the model. */
function buildSceneResolutionFromEntity(
  scene: SceneEntity,
  fallbackArenaKey: string,
): SceneResolution {
  const settings = scene.settings as Partial<SceneSettings>;
  const modelFile = typeof settings.modelFile === 'string' && settings.modelFile !== '' ? settings.modelFile : null;
  const modelUrl = modelFile !== null ? getArenaUrl(modelFile) : undefined;
  const arenaKey = arenaKeyForScene(scene, fallbackArenaKey);
  const useGlbSettings = scene.useGlbSettings === true;

  return {
    source: 'scene-entity',
    arenaKey,
    modelUrl: modelUrl ?? ARENA_MODEL_BY_KEY[arenaKey] ?? DEFAULT_ARENA_MODEL,
    useGlbSettings,
    settingsPatch: useGlbSettings ? {} : extractPatch(scene.settings),
    weather: scene.weather ?? null,
    timeOfDay: scene.timeOfDay ?? null,
  };
}

/** Build a SceneResolution from the per-arena defaults, using `scenes` to pick
 *  an ambience scene (weather / time-of-day) whose elements match the fallback
 *  arena key. The arena model comes from the unit elements, not the defaults. */
function buildSceneResolutionFromDefaults(
  fallbackArenaKey: string,
  all: PerArenaSceneDefaults,
  scenes: readonly SceneEntity[],
): SceneResolution {
  const arenaDefaults = all[fallbackArenaKey] ?? {};
  const modelFile = typeof arenaDefaults.modelFile === 'string' && arenaDefaults.modelFile !== '' ? arenaDefaults.modelFile : null;
  const modelUrl = (modelFile !== null ? getArenaUrl(modelFile) : ARENA_MODEL_BY_KEY[fallbackArenaKey]) ?? DEFAULT_ARENA_MODEL;
  // Arena comes from unit elements, not from the scene entity: without this the ambience of
  // a battle whose elements match no scene would silently vanish.
  const ambienceScene = scenes.find((s) => s.elements.length > 0 && arenaKeyForScene(s, fallbackArenaKey) === fallbackArenaKey) ?? null;
  return {
    source: 'arena-defaults',
    arenaKey: fallbackArenaKey,
    modelUrl,
    useGlbSettings: false,
    settingsPatch: extractPatch(arenaDefaults),
    weather: ambienceScene?.weather ?? null,
    timeOfDay: ambienceScene?.timeOfDay ?? null,
  };
}

/** Pure resolution of the arena scene from a scene entity (when sceneId is set)
 *  or from the per-arena defaults. Returns null when sceneId was set but no
 *  matching scene was found, letting the caller fall back to defaults. */
async function resolveArenaScene(
  sceneId: string | null,
  fallbackArenaKey: string,
  scenes: readonly SceneEntity[],
  defaults: PerArenaSceneDefaults,
): Promise<SceneResolution | null> {
  if (sceneId !== null) {
    const scene = scenes.find((s) => s.id === sceneId) ?? null;
    if (scene !== null) return buildSceneResolutionFromEntity(scene, fallbackArenaKey);
  }
  return null;
}

function loadAdminSceneOverride(arenaKey: string): Partial<SceneSettings> {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_OVERRIDE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const perArenaEntry = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[arenaKey] : null;
    return (typeof perArenaEntry === 'object' && perArenaEntry !== null ? perArenaEntry : {}) as Partial<SceneSettings>;
  } catch {
    return {};
  }
}

function clearAdminOverrides(): void {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_OVERRIDE_KEY);
    window.localStorage.removeItem(LOCAL_STORAGE_BASELINE_KEY);
  } catch {}
}

/** Apply the resolved patch (and any admin localStorage override) onto the
 *  manager. Admin overrides win key-by-key over the resolution patch, then the
 *  remaining resolution keys are applied on top. No-op when GLB settings drive
 *  the scene (the GLB defines its own look). */
function applyResolutionSettings(
  manager: SceneManager,
  resolution: SceneResolution,
  isAdmin: boolean,
): void {
  if (resolution.useGlbSettings) return;

  const localKeys = new Set<string>();
  if (isAdmin) {
    const localOverride = loadAdminSceneOverride(resolution.arenaKey);
    for (const key of Object.keys(localOverride)) localKeys.add(key);
    if (localKeys.size > 0) manager.applySettings(localOverride);
  }

  const patchToApply: Partial<SceneSettings> = {};
  for (const key of Object.keys(resolution.settingsPatch) as (keyof SceneSettings)[]) {
    if (!localKeys.has(key)) (patchToApply as Record<string, unknown>)[key] = resolution.settingsPatch[key];
  }
  if (Object.keys(patchToApply).length > 0) manager.applySettings(patchToApply);
}

/** Load the resolved arena GLB (or start straight over the default backdrop)
 *  and begin the render loop. On load failure the loop still starts over the
 *  backdrop so the stage renders and combat stays playable; `onReady` fires
 *  only on a clean arena-load so callers don't depend on a possibly-bad mesh. */
async function loadArenaWithFallback(
  manager: SceneManager,
  resolution: SceneResolution,
  onReady: () => void,
): Promise<void> {
  try {
    if (resolution.modelUrl === undefined) {
      manager.startLoop();
      manager.setHud(hudFromUrl());
      return;
    }

    const loader = resolution.useGlbSettings
      ? manager.loadArenaModelBare(resolution.modelUrl)
      : manager.loadArenaModelWithAtmosphere(resolution.modelUrl, resolution.arenaKey);

    await loader;
    manager.startLoop();
    manager.runEntrance();
    manager.setHud(hudFromUrl());
    onReady();
  } catch (err: unknown) {
    console.warn('arena.load.fail', resolution.modelUrl, err);
    manager.startLoop();
    manager.setHud(hudFromUrl());
  }
}

/** Whether a weather override targets this battle. Null override never targets. */
function targetedByWeatherOverride(
  override: WeatherOverrideState | null,
  battle: BattleView,
): boolean {
  if (override === null) return false;
  return (
    (override.sceneId === null && override.matchId === null) ||
    (override.sceneId !== null && override.sceneId === (battle.sceneId ?? null)) ||
    (override.matchId !== null && override.matchId === battle.id)
  );
}

/** Read the hovered opponent sprite under a screen position, or null. */
function spriteAtScreenPosition(
  manager: SceneManager,
  container: HTMLElement,
  clientX: number,
  clientY: number,
): { readonly unitId: string; readonly side: SpriteSide; readonly downed: boolean } | null {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return manager.getSpriteAtScreenPosition?.(x, y);
}

/** Apply a rendered tooltip for an opponent sprite currently under the cursor. */
const HoverTooltip = memo(function HoverTooltip({
  x,
  y,
  enemy,
  t,
}: {
  readonly x: number;
  readonly y: number;
  readonly enemy: EnemyUnitView;
  readonly t: (key: string, params?: Readonly<Record<string, string | number>>) => string;
}): JSX.Element {
  return (
    <div
      className="sprite-tooltip"
      role="tooltip"
      style={{
        left: x + 16,
        top: y - 16,
        transform: 'translateY(-100%)',
      }}
    >
      <div className="tooltip-header">
        <span className="tooltip-element" style={{ ['--el' as string]: `var(--el-${enemy.element})` }}>
          {enemy.element}
        </span>
        <span className="tooltip-name">{enemy.name}</span>
      </div>
      <div className="tooltip-stats">
        <div className="stat-row">
          <span className="stat-label">{t('combat.level')}</span>
          <span className="stat-value">Lv {enemy.level}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">{t('combat.hp')}</span>
          <span className="stat-value">{enemy.hp} / {enemy.hpMax}</span>
        </div>
      </div>
      {enemy.ailments.length > 0 && (
        <div className="tooltip-ailments">
          <span className="stat-label">{t('combat.ailments')}</span>
          <span className="stat-value">{enemy.ailments.map((a) => a.kind).join(', ')}</span>
        </div>
      )}
    </div>
  );
});

export const Combat3DScene = forwardRef<Combat3DSceneHandle, SceneProps>(function Combat3DScene({ battle, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { sceneRef, getManager } = useSceneManager();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const fallbackArenaKey = useMemo(() => pickArenaKey(battle), [battle]);
  const sceneId = battle.sceneId ?? null;
  const [resolution, setResolution] = useState<SceneResolution | null>(null);

  // 3D Sprite hover tooltip state
  const [hoveredSprite, setHoveredSprite] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    async function resolve(): Promise<void> {
      const scenes = await getScenes(false).catch(() => [] as readonly SceneEntity[]);
      const fromEntity = await resolveArenaScene(sceneId, fallbackArenaKey, scenes, {});
      if (fromEntity !== null) {
        if (cancelled) return;
        setResolution(fromEntity);
        return;
      }
      const all = await getSceneDefaults(false).catch((): PerArenaSceneDefaults => ({}));
      if (cancelled) return;
      setResolution(buildSceneResolutionFromDefaults(fallbackArenaKey, all, scenes));
    }
    void resolve();
    return () => { cancelled = true; };
  }, [sceneId, fallbackArenaKey]);

  useEffect(() => {
    const manager = getManager();
    if (manager === null || resolution === null) return;
    let cancelled = false;
    manager.clearArenaModel();
    if (resolution.modelUrl !== undefined) {
      const url = resolution.modelUrl;
      const loader = resolution.useGlbSettings
        ? manager.loadArenaModelBare(url)
        : manager.loadArenaModelWithAtmosphere(url, resolution.arenaKey);
      void loader
        .then(() => {
          if (cancelled) {
            manager.clearArenaModel();
            return;
          }
          // Arena GLB is in the scene: the loop + camera entrance start now,
          // so the first painted frame is the arena itself.
          manager.startLoop();
          manager.runEntrance();
          manager.setHud(hudFromUrl());
        })
        .catch((err) => {
          console.warn('arena.load.fail', url, err);
          // Arena failed to load: still run the loop over the default backdrop
          // so the stage renders and combat stays playable.
          if (!cancelled) {
            manager.startLoop();
            manager.setHud(hudFromUrl());
          }
        });
    } else {
      manager.startLoop();
      manager.setHud(hudFromUrl());
    }
    applyResolutionSettings(manager, resolution, isAdmin);
    return () => { cancelled = true; };
  }, [resolution, isAdmin, getManager]);

  useEffect(() => {
    const manager = getManager();
    if (manager === null || resolution === null) return;
    manager.setWeather(resolution.weather);
    manager.setTimeOfDay(resolution.timeOfDay);
  }, [resolution, getManager]);

  const weatherOverride = useWsStore((s) => s.weatherOverride);
  useEffect(() => {
    const manager = getManager();
    if (manager === null || resolution === null || weatherOverride === null) return;
    if (!targetedByWeatherOverride(weatherOverride, battle)) return;
    manager.setWeather(weatherOverride.weather);
    const revertAfter = Math.max(0, weatherOverride.startedAt + weatherOverride.durationMs - Date.now());
    const t = window.setTimeout(() => {
      const m = getManager();
      if (m !== null) m.setWeather(resolution.weather);
    }, revertAfter);
    return () => window.clearTimeout(t);
  }, [weatherOverride, resolution, battle.id, battle.sceneId, getManager]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    let manager: SceneManager | null = null;
    try {
      manager = new SceneManager(canvas);
    } catch {
      return;
    }
    sceneRef.current = manager;
    const rect = container.getBoundingClientRect();
    manager.resize(rect.width, rect.height);
    // The render loop is NOT started here: it starts once the arena GLB has
    // actually been added to the scene (see the arena-load effect below), so
    // the first painted frame is the arena itself — never the default backdrop
    // that SceneManager builds in its constructor. On arena-load failure the
    // loop still starts over the backdrop so the stage isn't left blank.
    if (!isAdmin) {
      clearAdminOverrides();
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        manager?.resize(width, height);
      }
    });
    resizeObserver.observe(container);

    onReady?.();

    return () => {
      resizeObserver.disconnect();
      manager?.dispose();
      sceneRef.current = null;
    };
  }, [onReady, isAdmin]);

  useEffect(() => {
    const manager = getManager();
    if (manager === null) return;

    const placements = toPlacements(battle);
    const wanted = new Set(placements.map((p) => p.unitId));
    for (const id of manager.getSpriteIds()) {
      if (!wanted.has(id as UnitId)) manager.removeSprite(id);
    }
    for (const placement of placements) {
      const existing = manager.getSprite(placement.unitId);
      if (existing === undefined) {
        const spriteInit: SpriteInit = {
          unitId: placement.unitId,
          side: placement.side,
          slotIndex: placement.slotIndex,
          textureUrl: placement.textureUrl,
          isSpritesheet: true,
          idleAnimated: false,
          initiallyDowned: placement.down,
          onClick: undefined,
        };
        manager.addSprite(spriteInit);
      } else {
        existing.setDowned(placement.down);
      }
    }
  }, [battle, getManager]);

  // Mouse interaction for 3D sprite hover tooltips
  useEffect(() => {
    const container = containerRef.current;
    const manager = getManager();
    if (!container || !manager) return;

    let tooltipTimeout: number | null = null;

    const clearTooltip = () => {
      if (tooltipTimeout !== null) window.clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
      setHoveredSprite(null);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const sprite = spriteAtScreenPosition(manager, container, event.clientX, event.clientY);
      const enemyId = sprite?.side === HOVER_SPRITE_SIDE && !sprite.downed ? sprite.unitId : null;
      const enemy = enemyId !== null ? battle.enemy.find((e) => e.id === enemyId) : undefined;

      if (enemy) {
        clearTimeout(tooltipTimeout ?? undefined);
        tooltipTimeout = window.setTimeout(() => {
          setHoveredSprite({ unitId: enemy.id, x: event.clientX, y: event.clientY });
        }, TOOLTIP_DELAY_MS);
        return;
      }
      clearTooltip();
    };

    const handleMouseLeave = () => clearTooltip();

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      clearTooltip();
    };
  }, [battle, getManager]);

  useImperativeHandle(ref, () => ({
    playEffect(element, sourceId, targetId, opts) {
      const manager = getManager();
      if (manager === null) return;
      manager.playEffect(element, sourceId, targetId, opts ?? {});
    },
    screenPositionOf(unitId) {
      const manager = getManager();
      if (manager === null) return null;
      const sprite = manager.getSprite(unitId);
      if (sprite === undefined) return null;
      return manager.projectWorldToScreen(sprite.worldPosition);
    },
    getSettings() {
      return getManager()?.getSettings() ?? null;
    },
    applySettings(patch) {
      getManager()?.applySettings(patch);
    },
  }), []);

  return (
    <div className="c3d-canvas-host" ref={containerRef}>
      <canvas className="c3d-canvas" ref={canvasRef} aria-hidden="true" />

      {/* 3D Sprite hover tooltip */}
      {hoveredSprite && (() => {
        const enemy = battle.enemy.find((e) => e.id === hoveredSprite.unitId);
        return enemy ? <HoverTooltip x={hoveredSprite.x} y={hoveredSprite.y} enemy={enemy} t={t} /> : null;
      })()}
    </div>
  );
});
