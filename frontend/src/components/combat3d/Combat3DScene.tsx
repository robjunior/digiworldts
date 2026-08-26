import type { BattleView, UnitId } from '@digiworld/shared/battle';
import { ELEMENT_TO_ARENA_KEY } from '@digiworld/shared/scene';
import type { SceneEntity } from '@digiworld/shared/scene';
import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

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
  onClick?: () => void | undefined;
};

// Combat uses the 2×2 four-frame sprite sheets (walk row + hit row). The dot.gif
// is the fallback for digimons that lack a generated sheet; the rig detects a
// missing image and keeps the placeholder, so a bad URL never hard-fails.
function toPlacements(battle: BattleView, onEnemyClick?: (unitId: string) => void): readonly UnitPlacement[] {
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
    if (onEnemyClick) {
      placement.onClick = () => onEnemyClick(unit.id);
    }
    return placement;
  });
  return [...you, ...opp];
}

function extractPatch(raw: Readonly<Record<string, unknown>>): Partial<SceneSettings> {
  const patch: Record<string, unknown> = { ...raw };
  delete patch['modelFile'];
  return patch as Partial<SceneSettings>;
}

export const Combat3DScene = forwardRef<Combat3DSceneHandle, SceneProps>(function Combat3DScene({ battle, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
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
      if (sceneId !== null) {
        const scene = scenes.find((s) => s.id === sceneId) ?? null;
        if (scene !== null) {
          const settings = scene.settings as Partial<SceneSettings>;
          const modelFile = typeof settings.modelFile === 'string' && settings.modelFile !== '' ? settings.modelFile : null;
          const modelUrl = modelFile !== null ? getArenaUrl(modelFile) : undefined;
          const arenaKey = arenaKeyForScene(scene, fallbackArenaKey);
          const useGlbSettings = scene.useGlbSettings === true;
          if (cancelled) return;
          setResolution({
            source: 'scene-entity',
            arenaKey,
            modelUrl: modelUrl ?? ARENA_MODEL_BY_KEY[arenaKey] ?? DEFAULT_ARENA_MODEL,
            useGlbSettings,
            settingsPatch: useGlbSettings ? {} : extractPatch(scene.settings),
            weather: scene.weather ?? null,
            timeOfDay: scene.timeOfDay ?? null,
          });
          return;
        }
      }
      const all = await getSceneDefaults(false).catch((): PerArenaSceneDefaults => ({}));
      if (cancelled) return;
      const arenaDefaults = all[fallbackArenaKey] ?? {};
      const modelFile = typeof arenaDefaults.modelFile === 'string' && arenaDefaults.modelFile !== '' ? arenaDefaults.modelFile : null;
      const modelUrl = (modelFile !== null ? getArenaUrl(modelFile) : ARENA_MODEL_BY_KEY[fallbackArenaKey]) ?? DEFAULT_ARENA_MODEL;
      // Arena comes from unit elements, not from the scene entity: without this the ambience of
      // a battle whose elements match no scene would silently vanish.
      const ambienceScene = scenes.find((s) => s.elements.length > 0 && arenaKeyForScene(s, fallbackArenaKey) === fallbackArenaKey) ?? null;
      setResolution({
        source: 'arena-defaults',
        arenaKey: fallbackArenaKey,
        modelUrl,
        useGlbSettings: false,
        settingsPatch: extractPatch(arenaDefaults),
        weather: ambienceScene?.weather ?? null,
        timeOfDay: ambienceScene?.timeOfDay ?? null,
      });
    }
    void resolve();
    return () => { cancelled = true; };
  }, [sceneId, fallbackArenaKey]);

  useEffect(() => {
    const manager = sceneRef.current;
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
    if (!resolution.useGlbSettings) {
      const localKeys = new Set<string>();
      try {
        if (isAdmin) {
          const raw = window.localStorage.getItem('digiworld.scene-settings-override');
          if (raw !== null) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const perArenaEntry = parsed && typeof parsed === 'object' ? parsed[resolution.arenaKey] : null;
            if (perArenaEntry !== null && typeof perArenaEntry === 'object') {
              const localArenaOverride = perArenaEntry as Partial<SceneSettings>;
              for (const k of Object.keys(localArenaOverride)) localKeys.add(k);
              manager.applySettings(localArenaOverride);
            }
          }
        }
      } catch {}
      const patchToApply: Partial<SceneSettings> = {};
      for (const key of Object.keys(resolution.settingsPatch) as (keyof SceneSettings)[]) {
        if (!localKeys.has(key)) (patchToApply as Record<string, unknown>)[key] = resolution.settingsPatch[key];
      }
      if (Object.keys(patchToApply).length > 0) manager.applySettings(patchToApply);
    }
    return () => { cancelled = true; };
  }, [resolution, isAdmin]);

  useEffect(() => {
    const manager = sceneRef.current;
    if (manager === null || resolution === null) return;
    manager.setWeather(resolution.weather);
    manager.setTimeOfDay(resolution.timeOfDay);
  }, [resolution]);

  const weatherOverride = useWsStore((s) => s.weatherOverride);
  useEffect(() => {
    const manager = sceneRef.current;
    if (manager === null || resolution === null) return;
    if (weatherOverride === null) return;
    const targetsThisScene =
      (weatherOverride.sceneId === null && weatherOverride.matchId === null) ||
      (weatherOverride.sceneId !== null && weatherOverride.sceneId === (battle.sceneId ?? null)) ||
      (weatherOverride.matchId !== null && weatherOverride.matchId === battle.id);
    if (!targetsThisScene) return;
    manager.setWeather(weatherOverride.weather);
    const revertAfter = Math.max(0, weatherOverride.startedAt + weatherOverride.durationMs - Date.now());
    const t = window.setTimeout(() => {
      const m = sceneRef.current;
      if (m !== null) m.setWeather(resolution.weather);
    }, revertAfter);
    return () => window.clearTimeout(t);
  }, [weatherOverride, resolution, battle.id, battle.sceneId]);

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
      try {
        window.localStorage.removeItem('digiworld.scene-settings-override');
        window.localStorage.removeItem('digiworld.scene-defaults-baseline');
      } catch {}
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
    const manager = sceneRef.current;
    if (manager === null) return;

    const handleEnemyClick = (unitId: string) => {
      // This will be passed to the sprite rig for click handling
    };

    const placements = toPlacements(battle, handleEnemyClick);
    const wanted = new Set(placements.map((p) => p.unitId));
    for (const id of manager.getSpriteIds()) {
      if (!wanted.has(id as UnitId)) manager.removeSprite(id);
    }
    for (const placement of placements) {
      const existing = manager.getSprite(placement.unitId);
      if (existing === undefined) {
        const onClickHandler = placement.onClick 
          ? () => { placement.onClick!(); }
          : undefined;
        const spriteInit: SpriteInit = {
          unitId: placement.unitId,
          side: placement.side,
          slotIndex: placement.slotIndex,
          textureUrl: placement.textureUrl,
          isSpritesheet: true,
          initiallyDowned: placement.down,
          onClick: onClickHandler,
        };
        manager.addSprite(spriteInit);
      } else {
        existing.setDowned(placement.down);
      }
    }
  }, [battle]);

  // Mouse interaction for 3D sprite hover tooltips
  useEffect(() => {
    const container = containerRef.current;
    const manager = sceneRef.current;
    if (!container || !manager) return;

    let tooltipTimeout: number | null = null;
    const tooltipDelay = 300; // ms

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      const sprite = manager.getSpriteAtScreenPosition?.(x, y);
      
      if (sprite && sprite.side === 'opp' && !sprite.downed) {
        const enemy = battle.enemy.find(e => e.id === sprite.unitId);
        if (enemy) {
          if (tooltipTimeout) window.clearTimeout(tooltipTimeout);
          tooltipTimeout = window.setTimeout(() => {
            setHoveredSprite({ unitId: sprite.unitId, x: event.clientX, y: event.clientY });
          }, tooltipDelay);
        }
      } else {
        if (tooltipTimeout) window.clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
        setHoveredSprite(null);
      }
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', () => {
      if (tooltipTimeout) window.clearTimeout(tooltipTimeout);
      setHoveredSprite(null);
    });

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', () => {});
    };
  }, [battle, sceneRef]);

  useImperativeHandle(ref, () => ({
    playEffect(element, sourceId, targetId, opts) {
      const manager = sceneRef.current;
      if (manager === null) return;
      manager.playEffect(element, sourceId, targetId, opts ?? {});
    },
    screenPositionOf(unitId) {
      const manager = sceneRef.current;
      if (manager === null) return null;
      const sprite = manager.getSprite(unitId);
      if (sprite === undefined) return null;
      return manager.projectWorldToScreen(sprite.worldPosition);
    },
    getSettings() {
      return sceneRef.current?.getSettings() ?? null;
    },
    applySettings(patch) {
      sceneRef.current?.applySettings(patch);
    },
  }), []);

  return (
    <div className="c3d-canvas-host" ref={containerRef}>
      <canvas className="c3d-canvas" ref={canvasRef} aria-hidden="true" />
      
      {/* 3D Sprite hover tooltip */}
      {hoveredSprite && (
        <div
          className="sprite-tooltip"
          role="tooltip"
          style={{
            left: hoveredSprite.x + 16,
            top: hoveredSprite.y - 16,
            transform: 'translateY(-100%)',
          }}
        >
          {(() => {
            const enemy = battle.enemy.find(e => e.id === hoveredSprite.unitId);
            if (!enemy) return null;
            return (
              <>
                <div className="tooltip-header">
                  <span className="tooltip-element" style={{ ['--el' as string]: `var(--el-${enemy.element})` }}>{enemy.element}</span>
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
                    <span className="stat-value">{enemy.ailments.join(', ')}</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
});
