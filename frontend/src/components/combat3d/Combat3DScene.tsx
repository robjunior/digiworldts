import type { BattleView, UnitId } from '@digiworld/shared/battle';
import type { Biome, PerBiomeSceneDefaults } from '@digiworld/shared/world';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { SceneManager, type SceneSettings } from '../../scene3d/scene';
import type { AnimatedElement } from '../../scene3d/attack-runners/types';
import type { SpriteSide } from '../../scene3d/sprite-rig';
import { getBiomeScenes, getSceneDefaults } from '../../lib/scene-defaults';
import { useAuth } from '../../hooks/useAuth';

const ARENA_MODEL_BY_KEY: Readonly<Record<string, string>> = {
  plant: '/assets/arenas/plant.glb',
  steel: '/assets/arenas/steel.glb',
  water: '/assets/arenas/water.glb',
  rock: '/assets/arenas/rock.glb',
  dark: '/assets/arenas/dark.glb',
  fire: '/assets/arenas/fire.glb',
  ice: '/assets/arenas/ice.glb',
  field: '/assets/arenas/field.glb',
  null: '/assets/arenas/null.glb',
  wind: '/assets/arenas/wind.glb',
  light: '/assets/arenas/light.glb',
};

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

const ELEMENT_TO_BIOME: Readonly<Record<string, Biome>> = {
  fire: 'desert',
  plant: 'forest',
  nature: 'forest',
  water: 'lake',
  electricity: 'storm',
  ice: 'tundra',
  earth: 'mountain',
  steel: 'foundry',
  wind: 'plateau',
  light: 'prairie',
  dark: 'swamp',
  null: 'void',
};

const ARENA_FALLBACK = 'steel';
const BIOME_FALLBACK: Biome = 'void';

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

function pickBiome(battle: BattleView): Biome {
  const counts = new Map<Biome, number>();
  for (const enemy of battle.enemy) {
    const biome = ELEMENT_TO_BIOME[enemy.element];
    if (biome !== undefined) counts.set(biome, (counts.get(biome) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let bestKey: Biome = BIOME_FALLBACK;
    let bestCount = 0;
    for (const [key, n] of counts) {
      if (n > bestCount) { bestCount = n; bestKey = key; }
    }
    return bestKey;
  }
  for (const mon of battle.friendly) {
    const biome = ELEMENT_TO_BIOME[mon.element];
    if (biome !== undefined) return biome;
  }
  return BIOME_FALLBACK;
}

export type Combat3DSceneHandle = {
  playEffect(element: AnimatedElement, sourceId: UnitId | null, targetId: UnitId, onImpact?: () => void): void;
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

function toPlacements(battle: BattleView): readonly UnitPlacement[] {
  const you: UnitPlacement[] = battle.friendly.map((unit, index) => ({
    unitId: unit.id,
    side: 'you',
    slotIndex: index,
    textureUrl: `/assets/digimon/${unit.templateId}/dot.gif`,
    down: unit.down,
  }));
  const opp: UnitPlacement[] = battle.enemy.map((unit, index) => ({
    unitId: unit.id,
    side: 'opp',
    slotIndex: index,
    textureUrl: `/assets/digimon/${unit.templateId}/dot.gif`,
    down: unit.down,
  }));
  return [...you, ...opp];
}

export const Combat3DScene = forwardRef<Combat3DSceneHandle, SceneProps>(function Combat3DScene({ battle, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const arenaKey = useMemo(() => pickArenaKey(battle), [battle]);
  const biome = useMemo(() => pickBiome(battle), [battle]);
  const [biomeScenes, setBiomeScenes] = useState<PerBiomeSceneDefaults>({});
  useEffect(() => {
    let cancelled = false;
    void getBiomeScenes(true).then((next) => { if (!cancelled) setBiomeScenes(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [biome]);
  const biomeConfig = biomeScenes[biome];
  const arenaModelUrl = biomeConfig?.file !== undefined
    ? `/assets/arenas/${biomeConfig.file}`
    : ARENA_MODEL_BY_KEY[arenaKey];

  useEffect(() => {
    const manager = sceneRef.current;
    if (manager === null) return;
    if (arenaModelUrl === undefined) {
      manager.clearArenaModel();
      return;
    }
    manager.clearArenaModel();
    void manager.loadArenaModelWithAtmosphere(arenaModelUrl, arenaKey).catch((err) => {
      console.warn('arena.load.fail', arenaModelUrl, err);
    });
  }, [arenaModelUrl, arenaKey]);

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
    manager.startLoop();
    manager.runEntrance();
    try {
      const localKeys = new Set<string>();
      if (isAdmin) {
        const raw = window.localStorage.getItem('digiworld.scene-settings-override');
        if (raw !== null) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const perArenaEntry = parsed && typeof parsed === 'object' ? parsed[arenaKey] : null;
          if (perArenaEntry !== null && typeof perArenaEntry === 'object') {
            const localArenaOverride = perArenaEntry as Partial<SceneSettings>;
            for (const k of Object.keys(localArenaOverride)) localKeys.add(k);
            manager.applySettings(localArenaOverride);
          }
        }
      } else {
        window.localStorage.removeItem('digiworld.scene-settings-override');
        window.localStorage.removeItem('digiworld.scene-defaults-baseline');
      }
      void Promise.all([getSceneDefaults(true), getBiomeScenes(true)])
        .then(([allArenaDefaults, allBiomeScenes]) => {
          const biomeSettings = (allBiomeScenes[biome]?.settings ?? {}) as Partial<SceneSettings>;
          const arenaDefaults = allArenaDefaults[arenaKey] ?? {};
          const merged: Partial<SceneSettings> = { ...arenaDefaults, ...biomeSettings };
          const patchToApply: Partial<SceneSettings> = {};
          for (const key of Object.keys(merged) as (keyof SceneSettings)[]) {
            if (!localKeys.has(key)) (patchToApply as Record<string, unknown>)[key] = merged[key];
          }
          if (Object.keys(patchToApply).length > 0) manager?.applySettings(patchToApply);
        })
        .catch(() => {});
    } catch {}
    if (arenaModelUrl !== undefined) {
      void manager.loadArenaModelWithAtmosphere(arenaModelUrl, arenaKey).catch((err) => {
        console.warn('arena.load.fail', arenaModelUrl, err);
      });
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
  }, [onReady]);

  useEffect(() => {
    const manager = sceneRef.current;
    if (manager === null) return;

    const placements = toPlacements(battle);
    const wanted = new Set(placements.map((p) => p.unitId));
    for (const id of manager.getSpriteIds()) {
      if (!wanted.has(id as UnitId)) manager.removeSprite(id);
    }
    for (const placement of placements) {
      const existing = manager.getSprite(placement.unitId);
      if (existing === undefined) {
        manager.addSprite({
          unitId: placement.unitId,
          side: placement.side,
          slotIndex: placement.slotIndex,
          textureUrl: placement.textureUrl,
          initiallyDowned: placement.down,
        });
      } else {
        existing.setDowned(placement.down);
      }
    }
  }, [battle]);

  useImperativeHandle(ref, () => ({
    playEffect(element, sourceId, targetId, onImpact) {
      const manager = sceneRef.current;
      if (manager === null) return;
      const opts: { readonly onImpact?: () => void } = onImpact ? { onImpact } : {};
      manager.playEffect(element, sourceId, targetId, opts);
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
    </div>
  );
});
