import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router';
import { Combat3DScene, type Combat3DSceneHandle } from './Combat3DScene';
import { CommandPanel, type CommandMode } from '../combat/CommandPanel';
import { EndCard } from '../combat/EndCard';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useWsStore } from '../../state/wsStore';
import { AilmentBadgesLayer } from './AilmentBadgesLayer';
import { BuffBadgesLayer } from './BuffBadgesLayer';
import { EnemyHealthBars } from './EnemyHealthBars';
import { PartyCard } from './PartyCard';
import { BattleFeed } from './BattleFeed';
import { EnemyRail } from './EnemyRail';
import { Floaters, type Floater3D } from './Floaters';
import { AutobattleToggle } from './AutobattleToggle';
import { SideBadge, TeamBadge, TopBar } from './SideAndTopBadges';
import { useResizeObserverCSSVar } from './useResizeObserverCSSVar';
import { useEnemyActionQueue } from './useEnemyActionQueue';
import { useAutobattle } from './useAutobattle';
import { useActionEventProcessing } from './useActionEventProcessing';
import { usePveDispatch } from './usePveDispatch';
import { useActionDispatch } from './useActionDispatch';
import { BattleStatusMessage } from './BattleStatusMessage';
import { FLOATER_DURATION_MS, FLOATER_Y_OFFSET } from './combat3dConfig';

export function Combat3DBody(): JSX.Element | null {
  const navigate = useNavigate();
  const { send } = useWebSocket();
  const activeBattle = useWsStore((state) => state.activeBattle);
  const battleEvents = useWsStore((state) => state.battleEvents);
  const clearActiveBattle = useWsStore((state) => state.clearActiveBattle);

  const [commandMode, setCommandMode] = useState<CommandMode>('menu');
  const [selectedTargetId, setSelectedTargetId] = useState<UnitId | null>(null);
  const [floaters, setFloaters] = useState<readonly Floater3D[]>([]);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);

  const sceneRef = useRef<Combat3DSceneHandle | null>(null);
  const cmdRef = useRef<HTMLDivElement | null>(null);
  const seenEventCountRef = useRef(0);

  // End-of-battle rewards (XP awards, NetCore, Bits) arrive with the WS `end`
  // message; the old PvE world-battle HTTP flow was removed with the world
  // feature, so this is now the single source for the reward report.
  const battleRewards = useWsStore((state) => state.battleRewards);

  const { dispatch: pveDispatch, error: loadError } = usePveDispatch(activeBattle, () => {});

  const actor = useMemo<FriendlyUnitView | null>(() => {
    if (!activeBattle) return null;
    const id = activeBattle.currentTurnUnitId;
    return id ? activeBattle.friendly.find((u) => u.id === id) ?? null : null;
  }, [activeBattle]);

  const selectedTarget = useMemo<EnemyUnitView | null>(() => {
    if (!activeBattle) return null;
    if (selectedTargetId) {
      const s = activeBattle.enemy.find((e) => e.id === selectedTargetId && !e.down);
      if (s) return s;
    }
    return activeBattle.enemy.find((e) => !e.down && e.hp > 0) ?? null;
  }, [activeBattle, selectedTargetId]);

  const aliveEnemies = useMemo<readonly EnemyUnitView[]>(
    () => (activeBattle ? activeBattle.enemy.filter((e) => !e.down) : []),
    [activeBattle],
  );

  const spawnFloater = (targetId: UnitId, text: string, kind: Floater3D['kind']): void => {
    const handle = sceneRef.current;
    if (handle === null) return;
    const pos = handle.screenPositionOf(targetId);
    if (pos === null) return;
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setFloaters((items) => [...items, { id, text, kind, x: pos.x, y: pos.y - FLOATER_Y_OFFSET }]);
    window.setTimeout(() => setFloaters((items) => items.filter((f) => f.id !== id)), FLOATER_DURATION_MS);
  };

  const { playActionEvent } = useActionEventProcessing(sceneRef, activeBattle?.yourSide ?? 'a', spawnFloater);
  const { enqueue: enqueueEnemyAction } = useEnemyActionQueue(playActionEvent);
  const { dispatch } = useActionDispatch(sceneRef, actor, activeBattle, setCommandMode, pveDispatch, send);
  const { enabled: autobattleEnabled, setEnabled: setAutobattleEnabled } = useAutobattle(
    activeBattle,
    actor,
    commandMode,
    dispatch,
  );

  useResizeObserverCSSVar(cmdRef, '--c3d-cmd-live-h', 'height');

  useEffect(() => {
    if (!activeBattle) return;
    const first = activeBattle.enemy.find((e) => !e.down && e.hp > 0);
    if (selectedTargetId === null || !activeBattle.enemy.some((e) => e.id === selectedTargetId && !e.down)) {
      setSelectedTargetId(first?.id ?? null);
    }
  }, [activeBattle, selectedTargetId]);

  useEffect(() => {
    if (activeBattle?.status === 'ended') setEndModalOpen(true);
  }, [activeBattle?.status]);

  useEffect(() => {
    const nextEvents = battleEvents.slice(seenEventCountRef.current);
    const vfxSeen = new Set<string>();
    seenEventCountRef.current = battleEvents.length;
    const yourSide = activeBattle?.yourSide ?? 'a';
    for (const event of nextEvents) {
      if (event.type !== 'action') continue;
      const actorIsFriendly = event.actor !== null && event.actor.startsWith(`${yourSide}:`);
      if (actorIsFriendly) {
        playActionEvent(event);
      } else {
        // First event of a cast wins the effect; the rest still floater.
        const signature = `${String(event.actor)}|${String(event.targetId)}|${String(event.skillName)}`;
        const playVfx = !vfxSeen.has(signature);
        vfxSeen.add(signature);
        enqueueEnemyAction({ event, playVfx });
      }
    }
  }, [battleEvents, activeBattle?.yourSide, playActionEvent, enqueueEnemyAction]);

  if (activeBattle === null) return null;

  const canAct = activeBattle.yourTurn && actor !== null && !actor.down && activeBattle.status === 'active';
  const showAutobattle = activeBattle.mode === 'pve' && activeBattle.status === 'active';
  const displayEvents = battleEvents.length > 0 ? battleEvents : activeBattle.log ?? [];

  return (
    <div
      className="stage"
      data-od-id="battle-stage"
      data-targeting={
        commandMode === 'target-fight' || commandMode === 'target-skill' || commandMode === 'items'
      }
    >
      <Combat3DScene ref={sceneRef} battle={activeBattle} />

      <div className="arena-fallback" id="arena-fallback" role="img" aria-label="3D arena unavailable — combat still playable">
        <div className="box">
          <b>3D arena unavailable</b>
          <br />
          Your device blocked WebGL. Combat is still fully playable — use the command menu.
        </div>
      </div>

      <EnemyHealthBars battle={activeBattle} sceneRef={sceneRef} />
      <AilmentBadgesLayer battle={activeBattle} sceneRef={sceneRef} />
      <BuffBadgesLayer battle={activeBattle} sceneRef={sceneRef} />

      <div className="overlay">
        <div className={`side-badge ${feedOpen ? 'open' : ''}`}>
          <button
            className="mobile-feed-toggle"
            aria-label="Open battle log"
            aria-expanded={feedOpen}
            onClick={() => setFeedOpen(!feedOpen)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
          <div className="side-badge-content">
            <SideBadge battle={activeBattle} />
            <BattleFeed events={displayEvents} battle={activeBattle} />
            {feedOpen && (
              <button className="mobile-feed-close" onClick={() => setFeedOpen(false)}>
                Close
              </button>
            )}
          </div>
        </div>

        <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true"></div>

        <TopBar battle={activeBattle} actor={actor} />

        <TeamBadge friendly={activeBattle.friendly} />

        <EnemyRail
          aliveEnemies={aliveEnemies}
          selectedTargetId={selectedTargetId}
          canAct={canAct}
          onSelect={setSelectedTargetId}
          onSpriteClick={setSelectedTargetId}
        />

        <div className="party-cards" role="group" aria-label="Your party">
          {activeBattle.friendly.map((unit) => (
            <PartyCard
              key={unit.id}
              unit={unit}
              active={unit.id === activeBattle.currentTurnUnitId && activeBattle.currentTurnBelongsToYou}
            />
          ))}
        </div>

        {showAutobattle ? (
          <AutobattleToggle on={autobattleEnabled} onToggle={() => setAutobattleEnabled(!autobattleEnabled)} />
        ) : null}

        <div className="cmd" data-mode={commandMode} data-od-id="command-menu" ref={cmdRef}>
          <CommandPanel
            mode={commandMode}
            actor={actor}
            target={selectedTarget}
            aliveEnemies={aliveEnemies}
            friendly={activeBattle.friendly}
            yourTurn={canAct}
            pveMode={activeBattle.mode === 'pve'}
            onMode={setCommandMode}
            onFight={(targetId) => actor && dispatch({ type: 'fight', unitId: actor.id, targetId })}
            onSkill={(skillId, targetId, extraTargetIds) =>
              actor &&
              dispatch(
                extraTargetIds
                  ? { type: 'skill', unitId: actor.id, skillId, targetId, extraTargetIds }
                  : { type: 'skill', unitId: actor.id, skillId, targetId },
              )
            }
            onUseItem={(itemId, targetId) => actor && dispatch({ type: 'use_item', unitId: actor.id, targetId, itemId })}
            onFlee={() => dispatch({ type: 'flee' })}
          />
        </div>

        <Floaters floaters={floaters} />
      </div>

      {activeBattle.status === 'ended' && endModalOpen ? (
        <EndCard
          battle={activeBattle}
          rewards={battleRewards}
          onClose={() => {
            setEndModalOpen(false);
            clearActiveBattle();
            navigate('/', { replace: true });
          }}
        />
      ) : null}

      <BattleStatusMessage error={loadError} />
    </div>
  );
}
