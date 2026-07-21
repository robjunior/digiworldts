import type { BattleView, UnitId } from '@digiworld/shared/battle';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { SceneManager } from '../../scene3d/scene';
import type { AnimatedElement } from '../../scene3d/attack-runners/types';
import type { SpriteSide } from '../../scene3d/sprite-rig';

export type Combat3DSceneHandle = {
  playEffect(element: AnimatedElement, sourceId: UnitId | null, targetId: UnitId, onImpact?: () => void): void;
  screenPositionOf(unitId: UnitId): { readonly x: number; readonly y: number } | null;
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
  }), []);

  return (
    <div className="c3d-canvas-host" ref={containerRef}>
      <canvas className="c3d-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
});
