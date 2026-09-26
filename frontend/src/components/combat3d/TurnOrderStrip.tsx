import { memo, useEffect, useRef, useState } from 'react';
import type { BattleView } from '@digiworld/shared/battle';
import { DigimonSprite } from '../common/DigimonSprite';

type TurnEntry = NonNullable<BattleView['upcomingTurns']>[number];
type TurnSlot = { readonly entry: TurnEntry; readonly templateId: string; readonly name: string; readonly element: string; readonly defeated: boolean };
const VISIBLE_SLOTS = 6;

export const TurnOrderStrip = memo(function TurnOrderStrip({ battle }: { readonly battle: BattleView }): JSX.Element | null {
  const incoming = battle.upcomingTurns ?? [];
  const initial = fillQueue(resolveSlots(incoming, battle));
  const [queue, setQueue] = useState<readonly TurnSlot[]>(initial);
  const [advance, setAdvance] = useState(0);
  const [moving, setMoving] = useState(false);
  const queueRef = useRef(initial);
  const timerRef = useRef<number | null>(null);
  const currentTurn = battle.currentTurnUnitId ?? incoming[0]?.unitId ?? null;
  const previousTurnRef = useRef<string | null>(currentTurn);

  useEffect(() => {
    const next = resolveSlots(incoming, battle);
    const nextTurn = currentTurn;
    if (next.length === 0 || nextTurn === null || nextTurn === previousTurnRef.current) return;
    previousTurnRef.current = nextTurn;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    const played = queueRef.current[0];
    const nextStart = next.findIndex((slot) => slot.entry.unitId === nextTurn);
    const orderedNext = nextStart > 0 ? [...next.slice(nextStart), ...next.slice(0, nextStart)] : next;
    const future = [...orderedNext, ...queueRef.current.slice(1)];
    const rotated = [...future.slice(0, VISIBLE_SLOTS - 1), ...(played ? [played] : [])];
    const nextQueue = fillQueue(rotated);
    queueRef.current = nextQueue;
    setAdvance(1);
    setMoving(true);
    timerRef.current = window.setTimeout(() => {
      setMoving(false);
      setQueue(nextQueue);
      setAdvance(0);
      timerRef.current = null;
    }, 300);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [battle, incoming]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  if (queue.length === 0) return null;
  return (
    <div className="turn-order-wheel" role="list" aria-label="Turn order and future turns">
      <div className={`turn-order-wheel__track ${moving ? 'is-moving' : ''}`} style={{ ['--turn-advance' as string]: advance }}>
        {queue.map((slot, idx) => {
          const isYours = slot.entry.side === battle.yourSide;
          const unit = battle.friendly.find((candidate) => candidate.id === slot.entry.unitId) ?? battle.enemy.find((candidate) => candidate.id === slot.entry.unitId);
          const defeated = slot.defeated || unit?.down === true;
          return (
            <div
              key={`${slot.entry.unitId}-${idx}`}
              className={`c3d-order-slot ${isYours ? 'is-yours' : 'is-opp'} ${idx === 0 ? 'is-current' : ''} ${defeated ? 'is-defeated' : ''}`}
              role="listitem"
              title={slot.name}
              style={{ ['--el' as string]: `var(--el-${slot.element})` }}
            >
              <DigimonSprite catalogId={slot.templateId} className="c3d-order-mon" alt={slot.name} />
              {idx === 0 ? <span className="c3d-order-caret" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function fillQueue(slots: readonly TurnSlot[]): readonly TurnSlot[] {
  if (slots.length === 0) return [];
  const result: TurnSlot[] = [];
  for (let index = 0; result.length < VISIBLE_SLOTS; index += 1) result.push(slots[index % slots.length]!);
  return result;
}

function resolveSlots(entries: readonly TurnEntry[], battle: BattleView): readonly TurnSlot[] {
  return entries.flatMap((entry) => {
    const unit = battle.friendly.find((candidate) => candidate.id === entry.unitId) ?? battle.enemy.find((candidate) => candidate.id === entry.unitId);
    if (!unit) return [];
    return [{ entry, templateId: unit.templateId, name: unit.name, element: unit.element, defeated: unit.down }];
  });
}
