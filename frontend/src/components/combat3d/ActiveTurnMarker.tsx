import type { BattleView, UnitId } from '@digiworld/shared/battle';
import { useEffect, useState } from 'react';
import type { Combat3DSceneHandle } from './Combat3DScene';

export function ActiveTurnMarker({ battle, sceneRef }: { readonly battle: BattleView; readonly sceneRef: React.RefObject<Combat3DSceneHandle | null> }): JSX.Element | null {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const activeId = battle.currentTurnUnitId as UnitId | null;
  const active = activeId !== null ? battle.friendly.find((u) => u.id === activeId) ?? battle.enemy.find((u) => u.id === activeId) : null;
  useEffect(() => {
    let frame = 0;
    const tick = (): void => {
      const next = activeId !== null ? sceneRef.current?.screenPositionOf(activeId) ?? null : null;
      setPosition(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeId, sceneRef]);
  if (active === null || position === null) return null;
  return <div className="active-turn-marker" style={{ left: position.x, top: position.y }} aria-hidden="true"><span /></div>;
}
