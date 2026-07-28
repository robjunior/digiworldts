import { memo, useEffect, useRef } from 'react';
import type { BattleView, UnitId } from '@digiworld/shared/battle';
import type { Combat3DSceneHandle } from './Combat3DScene';

export const EnemyHealthBars = memo(function EnemyHealthBars({ battle, sceneRef }: { readonly battle: BattleView; readonly sceneRef: React.RefObject<Combat3DSceneHandle | null> }): JSX.Element {
  const alive = battle.enemy.filter((e) => !e.down && e.hp > 0);
  const barRefs = useRef<Map<UnitId, HTMLDivElement>>(new Map());

  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      const scene = sceneRef.current;
      if (scene !== null) {
        for (const [unitId, bar] of barRefs.current.entries()) {
          const pos = scene.screenPositionOf(unitId);
          if (pos !== null) {
            bar.style.transform = `translate3d(${pos.x - 60}px, ${pos.y + 34}px, 0)`;
            bar.style.opacity = '1';
          } else {
            bar.style.opacity = '0';
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sceneRef]);

  useEffect(() => {
    const keep = new Set(alive.map((e) => e.id));
    for (const id of Array.from(barRefs.current.keys())) {
      if (!keep.has(id)) barRefs.current.delete(id);
    }
  }, [alive]);

  return (
    <div className="c3d-enemy-hp-layer" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {alive.map((enemy) => {
        const pct = enemy.hpMax > 0 ? Math.max(0, enemy.hp) / enemy.hpMax * 100 : 0;
        return (
          <div
            key={enemy.id}
            ref={(el) => {
              if (el === null) barRefs.current.delete(enemy.id);
              else barRefs.current.set(enemy.id, el);
            }}
            className="ehpbar"
            style={{ position: 'absolute', top: 0, left: 0, opacity: 0, width: '120px', background: 'rgba(0,0,0,0.5)', padding: '4px', border: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', gap: '2px' }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#fff', textShadow: '0 1px 2px #000' }}>{enemy.name}</div>
            <div style={{ height: '4px', background: 'var(--panel)', width: '100%' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--el-electricity)', transition: 'width 0.2s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
});