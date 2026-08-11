import { memo, useEffect, useMemo, useRef } from 'react';
import type { ActiveBuff, BattleView, UnitId } from '@digiworld/shared/battle';
import type { BuffKind } from '@digiworld/shared/digimon';
import type { Combat3DSceneHandle } from './Combat3DScene';

/**
 * Buff and debuff badges above each unit.
 *
 * Sibling of `AilmentBadgesLayer`, and deliberately a separate layer: the two
 * live in different places on the wire. Ailments are `unit.ailments`, while
 * stat swings — including every debuff — are `unit.activeBuffs`, so a reader
 * looking only at ailments would conclude nothing had been debuffed at all.
 *
 * The `.c3d-buff-*` styles this uses were already in `extensions-combat3d.css`
 * with no component rendering them; the four colour buckets below are the ones
 * that stylesheet defines.
 */

const BUFF_ICON: Record<BuffKind, string> = {
  shield_absorb: '🧿',
  damage_reduction: '🧱',
  invulnerable: '✨',
  accuracy_up: '🎯',
  accuracy_down: '🎯',
  evasion_up: '🌀',
  evasion_down: '🌀',
  crit_up: '⭐',
  atk_up: '⚔',
  def_up: '🛡',
  spd_up: '💨',
  int_up: '🔮',
  atk_down: '⚔',
  def_down: '🛡',
  spd_down: '💨',
  int_down: '🔮',
};

const BUFF_LABEL: Record<BuffKind, string> = {
  shield_absorb: 'Shield',
  damage_reduction: 'Damage reduction',
  invulnerable: 'Invulnerable',
  accuracy_up: 'Accuracy up',
  accuracy_down: 'Accuracy down',
  evasion_up: 'Evasion up',
  evasion_down: 'Evasion down',
  crit_up: 'Crit up',
  atk_up: 'Attack up',
  def_up: 'Defense up',
  spd_up: 'Speed up',
  int_up: 'Intelligence up',
  atk_down: 'Attack down',
  def_down: 'Defense down',
  spd_down: 'Speed down',
  int_down: 'Intelligence down',
};

/** The four buckets `.c3d-buff--*` styles: green, red, blue, gold. */
function buffBucket(kind: BuffKind): 'up' | 'down' | 'shield' | 'gold' {
  if (kind === 'shield_absorb' || kind === 'damage_reduction') return 'shield';
  if (kind === 'invulnerable' || kind === 'crit_up') return 'gold';
  return kind.endsWith('_down') ? 'down' : 'up';
}

type BuffedUnit = {
  readonly id: UnitId;
  readonly side: 'you' | 'opp';
  readonly buffs: readonly ActiveBuff[];
};

export const BuffBadgesLayer = memo(function BuffBadgesLayer({
  battle,
  sceneRef,
}: {
  readonly battle: BattleView;
  readonly sceneRef: React.RefObject<Combat3DSceneHandle | null>;
}): JSX.Element {
  const units = useMemo(() => {
    const buffed: BuffedUnit[] = [];
    for (const u of battle.friendly) {
      const buffs = u.activeBuffs ?? [];
      if (buffs.length > 0 && !u.down) buffed.push({ id: u.id, side: 'you', buffs });
    }
    for (const u of battle.enemy) {
      const buffs = u.activeBuffs ?? [];
      if (buffs.length > 0 && !u.down) buffed.push({ id: u.id, side: 'opp', buffs });
    }
    return buffed;
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
            // Ailments sit at -24. Buffs go below the anchor so a unit carrying
            // both keeps two readable rows instead of one overlapping pile.
            node.style.transform = `translate3d(${pos.x + offsetX}px, ${pos.y + 6}px, 0)`;
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
    <div
      className="c3d-buff-layer"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}
    >
      {units.map((unit) => (
        <div
          key={unit.id}
          ref={(el) => {
            if (el === null) groupRefs.current.delete(unit.id);
            else groupRefs.current.set(unit.id, el);
          }}
          data-side={unit.side}
          className="c3d-buff-group"
        >
          {unit.buffs.map((b, index) => (
            // Several sources can stack the same kind, so the kind alone is not
            // a stable key.
            <span
              key={`${b.kind}:${b.sourceId}:${index}`}
              className={`c3d-buff c3d-buff--${buffBucket(b.kind)}`}
              title={`${BUFF_LABEL[b.kind]} ${b.amount} · ${b.remainingTurns} turn${b.remainingTurns === 1 ? '' : 's'} left`}
            >
              <span className="c3d-buff-icon" aria-hidden="true">{BUFF_ICON[b.kind]}</span>
              <span className="c3d-buff-tl">{b.remainingTurns}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});
