import { memo, useEffect, useMemo, useRef } from 'react';
import type { BattleView, UnitId } from '@digiworld/shared/battle';
import type { Ailment } from '@digiworld/shared/digimon';
import type { Combat3DSceneHandle } from './Combat3DScene';

const AILMENT_ICON: Record<Ailment, string> = {
  burn: '🔥', poison: '☠', weaken: '⬇', freeze: '❄', stun: '⚡', sleep: '💤', blind: '🙈', silence: '∅', root: '⚓', petrify: '🗿', curse: '💀', corruption: '☣', confusion: '💫', charm: '💘',
};

const AILMENT_LABEL: Record<Ailment, string> = {
  burn: 'Burned', poison: 'Poisoned', weaken: 'Weakened', freeze: 'Frozen', stun: 'Stunned', sleep: 'Asleep', blind: 'Blinded', silence: 'Silenced', root: 'Rooted', petrify: 'Petrified', curse: 'Cursed', corruption: 'Corrupted', confusion: 'Confused', charm: 'Charmed',
};

export const AilmentBadgesLayer = memo(function AilmentBadgesLayer({ battle, sceneRef }: { readonly battle: BattleView; readonly sceneRef: React.RefObject<Combat3DSceneHandle | null> }): JSX.Element {
  const units = useMemo(() => {
    const withAilments: Array<{ id: UnitId; side: 'you' | 'opp'; ailments: readonly { kind: Ailment; turnsLeft: number }[] }> = [];
    for (const u of battle.friendly) {
      if (u.ailments.length > 0 && !u.down) withAilments.push({ id: u.id, side: 'you', ailments: u.ailments });
    }
    for (const u of battle.enemy) {
      if (u.ailments.length > 0 && !u.down) withAilments.push({ id: u.id, side: 'opp', ailments: u.ailments });
    }
    return withAilments;
  }, [battle.friendly, battle.enemy]);
  const groupRefs = useRef<Map<UnitId, HTMLDivElement>>(new Map());

  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      const scene = sceneRef.current;
      if (scene !== null) {
        for (const [unitId, node] of groupRefs.current.entries()) {
          const pos = scene.screenPositionOf(unitId);
          if (pos !== null) {
            const side = node.dataset['side'];
            const offsetX = side === 'you' ? -48 : 20;
            node.style.transform = `translate3d(${pos.x + offsetX}px, ${pos.y - 24}px, 0)`;
            node.style.opacity = '1';
          } else {
            node.style.opacity = '0';
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sceneRef]);

  useEffect(() => {
    const keep = new Set(units.map((u) => u.id));
    for (const id of Array.from(groupRefs.current.keys())) {
      if (!keep.has(id)) groupRefs.current.delete(id);
    }
  }, [units]);

  return (
    <div className="c3d-ailment-layer" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {units.map((unit) => (
        <div
          key={unit.id}
          ref={(el) => {
            if (el === null) groupRefs.current.delete(unit.id);
            else groupRefs.current.set(unit.id, el);
          }}
          data-side={unit.side}
          className="c3d-ailment-group"
        >
          {unit.ailments.map((a) => (
            <span
              key={a.kind}
              className={`c3d-ailment c3d-ailment--${a.kind}`}
              title={`${AILMENT_LABEL[a.kind]} · ${a.turnsLeft} turn${a.turnsLeft === 1 ? '' : 's'} left`}
            >
              <span className="c3d-ailment-icon" aria-hidden="true">{AILMENT_ICON[a.kind]}</span>
              <span className="c3d-ailment-tl">{a.turnsLeft}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});