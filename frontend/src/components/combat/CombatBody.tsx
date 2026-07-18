import type { Action, BattleEvent, BattleSide, BattleView, EnemyUnitView, FriendlyUnitView, TurnEntry, UnitId } from '@digiworld/shared/battle';
import type { WSClientMessage } from '@digiworld/shared/ws';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { CbtParty } from './CbtParty';
import { CommandPanel, type CommandMode } from './CommandPanel';
import { EndCard } from './EndCard';
import { Enemies } from './Enemies';
import { FloaterLayer, type Floater } from './FloaterLayer';
import { PageStrip } from './PageStrip';
import { TurnLogV2 } from './TurnLogV2';
import { useWebSocket } from '../../hooks/useWebSocket';
import { actInWorldBattle, ApiError, getBattleView, startWildEncounter } from '../../lib/api';
import { useWsStore } from '../../state/wsStore';

const FLOATER_TTL_MS = 800;

export type CombatBodyProps = {
  readonly fetchOnMount?: boolean;
  readonly showPageStrip?: boolean;
};

export type CombatBodyEmptyProps = {
  readonly onNewEncounter: () => void;
  readonly loadError: string | null;
};

export function useCombatBattle(fetchOnMount: boolean): { readonly loadError: string | null; readonly startEncounter: () => void } {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchOnMount) {
      return;
    }
    if (activeBattle !== null) {
      return;
    }
    let cancelled = false;
    void getBattleView().then((battle) => {
      if (!cancelled) {
        setLoadError(null);
        handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
      }
    }).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        return;
      }
      if (error instanceof Error) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
    return () => {
      cancelled = true;
    };
  }, [activeBattle, fetchOnMount, handleServerMessage]);

  const startEncounter = useCallback((): void => {
    void startWildEncounter().then((battle) => {
      setLoadError(null);
      handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
    }).catch((error: unknown) => {
      if (error instanceof Error) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
  }, [handleServerMessage]);

  return { loadError, startEncounter };
}

export function CombatBody({ showPageStrip = true }: CombatBodyProps): JSX.Element | null {
  const { send, readyState } = useWebSocket();
  const activeBattle = useWsStore((state) => state.activeBattle);
  const battleEvents = useWsStore((state) => state.battleEvents);
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const [commandMode, setCommandMode] = useState<CommandMode>('menu');
  const [selectedTargetId, setSelectedTargetId] = useState<UnitId | null>(null);
  const [floaters, setFloaters] = useState<readonly Floater[]>([]);
  const [hitUnitId, setHitUnitId] = useState<UnitId | null>(null);
  const [, setLoadError] = useState<string | null>(null);
  const arenaRef = useRef<HTMLElement | null>(null);
  const seenEventCountRef = useRef(0);

  const actor = useMemo(() => activeBattle ? activeFriendly(activeBattle) : null, [activeBattle]);
  const selectedTarget = useMemo(() => activeBattle ? selectedEnemy(activeBattle, selectedTargetId) : null, [activeBattle, selectedTargetId]);
  const displayEvents = battleEvents.length > 0 ? battleEvents : activeBattle?.log ?? [];

  useEffect(() => {
    if (!activeBattle) {
      return;
    }
    const first = firstAliveEnemy(activeBattle.enemy);
    if (selectedTargetId === null || !activeBattle.enemy.some((enemy) => enemy.id === selectedTargetId && !enemy.down)) {
      setSelectedTargetId(first?.id ?? null);
    }
  }, [activeBattle, selectedTargetId]);

  useEffect(() => {
    const nextEvents = battleEvents.slice(seenEventCountRef.current);
    seenEventCountRef.current = battleEvents.length;
    const yourSide = activeBattle?.yourSide ?? 'a';
    for (const event of nextEvents) {
      if (event.type === 'action' && event.damage !== undefined && event.targetId) {
        spawnFloater(event, arenaRef.current, yourSide, setFloaters, setHitUnitId);
      }
    }
  }, [battleEvents, activeBattle?.yourSide]);

  const dispatchAction = useCallback((action: Action): void => {
    if (!activeBattle) {
      return;
    }
    if (activeBattle.mode === 'pve') {
      void actInWorldBattle(action).then((response) => {
        const previousLogLength = activeBattle.log.length;
        const newEvents = response.battle.log.slice(previousLogLength);
        if (newEvents.length > 0) {
          handleServerMessage({ type: 'event', matchId: response.battle.id, events: newEvents });
        }
        if (response.ended) {
          handleServerMessage({ type: 'end', matchId: response.battle.id, view: response.battle, outcome: response.battle.outcome ?? 'abandoned' });
        } else {
          handleServerMessage({ type: 'battle', matchId: response.battle.id, view: response.battle });
        }
      }).catch((error: unknown) => {
        if (error instanceof Error) {
          setLoadError(error.message);
          return;
        }
        throw error;
      });
    } else {
      const msg = { type: 'act', matchId: activeBattle.id, action } satisfies WSClientMessage;
      send(msg);
    }
    setCommandMode('menu');
  }, [activeBattle, handleServerMessage, send]);

  const startEncounter = useCallback((): void => {
    void startWildEncounter().then((battle) => {
      setLoadError(null);
      handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
    }).catch((error: unknown) => {
      if (error instanceof Error) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
  }, [handleServerMessage]);

  if (activeBattle === null) {
    return null;
  }

  const canAct = activeBattle.yourTurn && actor !== null && !actor.down && activeBattle.status === 'active';

  return (
    <>
      {showPageStrip ? <PageStrip battle={activeBattle} readyState={readyState} /> : null}
      {activeBattle.status === 'ended' ? <EndCard battle={activeBattle} onNewEncounter={startEncounter} /> : null}
      <section className={activeBattle.status === 'ended' ? 'arena hidden' : 'arena'} ref={arenaRef} data-od-id="arena">
        <FloaterLayer floaters={floaters} />
        <TurnQueue turns={activeBattle.upcomingTurns} />
        <Enemies enemies={activeBattle.enemy} selectedTargetId={selectedTargetId} currentUnitId={activeBattle.currentTurnUnitId} selectable={canAct} hitUnitId={hitUnitId} onSelectTarget={setSelectedTargetId} />
        <div className="deck-grid">
          <div className="stack" style={{ gap: '12px' }}>
            <CbtParty units={activeBattle.friendly} activeUnitId={activeBattle.currentTurnBelongsToYou ? activeBattle.currentTurnUnitId : null} hitUnitId={hitUnitId} />
            <CommandPanel
              mode={commandMode}
              actor={actor}
              target={selectedTarget}
              yourTurn={canAct}
              onMode={setCommandMode}
              onFight={(targetId) => actor && dispatchAction({ type: 'fight', unitId: actor.id, targetId })}
              onSkill={(skillId, targetId) => actor && dispatchAction({ type: 'skill', unitId: actor.id, skillId, targetId })}
              onGuard={() => actor && dispatchAction({ type: 'guard', unitId: actor.id })}
              onAnalyze={(targetId) => actor && dispatchAction({ type: 'analyze', unitId: actor.id, targetId })}
              onFlee={() => dispatchAction({ type: 'flee' })}
            />
          </div>
          <aside className="log-col">
            <h2>Turn log</h2>
            <TurnLogV2 events={displayEvents} />
          </aside>
        </div>
      </section>
    </>
  );
}

function activeFriendly(battle: BattleView): FriendlyUnitView | null {
  const currentId = battle.currentTurnUnitId;
  return currentId ? battle.friendly.find((unit) => unit.id === currentId) ?? null : null;
}

function selectedEnemy(battle: BattleView, selectedTargetId: UnitId | null): EnemyUnitView | null {
  if (selectedTargetId) {
    const selected = battle.enemy.find((enemy) => enemy.id === selectedTargetId && !enemy.down);
    if (selected) {
      return selected;
    }
  }
  return firstAliveEnemy(battle.enemy);
}

function firstAliveEnemy(enemies: readonly EnemyUnitView[]): EnemyUnitView | null {
  return enemies.find((enemy) => !enemy.down && enemy.hp > 0) ?? null;
}

function TurnQueue({ turns }: { readonly turns: readonly TurnEntry[] }): JSX.Element {
  return (
    <section className="turn-queue" aria-label="Upcoming turns">
      <span className="tq-label">Up next</span>
      {turns.map((turn, index) => (
        <span key={`${turn.unitId}-${index}`} className={`tq-item side-${turn.side}${index === 0 ? ' is-now' : ''}`}>
          <span className="n">{turn.name}</span>
          <span className="i">{turn.initiative.toFixed(1)}</span>
        </span>
      ))}
    </section>
  );
}

function spawnFloater(event: Extract<BattleEvent, { type: 'action' }>, arena: HTMLElement | null, yourSide: BattleSide, setFloaters: Dispatch<SetStateAction<readonly Floater[]>>, setHitUnitId: Dispatch<SetStateAction<UnitId | null>>): void {
  const targetId = event.targetId;
  const damage = event.damage;
  if (arena === null || targetId === undefined || targetId === null || damage === undefined) {
    return;
  }
  const isFriendly = targetId.startsWith(`${yourSide}:`);
  const prefix = isFriendly ? 'cbt' : 'foe';
  const target = arena.querySelector(`[data-od-id="${prefix}-${targetId}"]`);
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const arenaRect = arena.getBoundingClientRect();
  const x = targetRect.left - arenaRect.left + targetRect.width / 2;
  const y = targetRect.top - arenaRect.top - 10;
  const id = `${event.at}-${targetId}`;
  setHitUnitId(targetId);
  setFloaters((items) => [...items, { id, targetId, amount: damage, cue: event.cue, x, y }]);
  window.setTimeout(() => setFloaters((items) => items.filter((item) => item.id !== id)), FLOATER_TTL_MS);
  window.setTimeout(() => setHitUnitId(null), 400);
}
