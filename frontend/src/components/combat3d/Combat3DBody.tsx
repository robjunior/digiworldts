import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { skillTargetScope } from '@digiworld/shared/battle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useNavigate } from 'react-router';
import { Combat3DScene, type Combat3DSceneHandle } from './Combat3DScene';
import { CommandPanel, type CommandMode } from '../combat/CommandPanel';
import { AttributeIcon } from '../combat/AttributeIcon';
import { EndCard } from '../combat/EndCard';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useWsStore } from '../../state/wsStore';
import { AilmentBadgesLayer } from './AilmentBadgesLayer';
import { BuffBadgesLayer } from './BuffBadgesLayer';
import { EnemyHealthBars } from './EnemyHealthBars';
import { PartyCard } from './PartyCard';
import { BattleFeed } from './BattleFeed';
import { TurnOrderRail } from './TurnOrderRail';
import { ActiveTurnMarker } from './ActiveTurnMarker';
import { Floaters, type Floater3D } from './Floaters';
import { AutobattleToggle } from './AutobattleToggle';
import { useResizeObserverCSSVar } from './useResizeObserverCSSVar';
import { useEnemyActionQueue } from './useEnemyActionQueue';
import { useAutobattle } from './useAutobattle';
import { useActionEventProcessing } from './useActionEventProcessing';
import { usePveDispatch } from './usePveDispatch';
import { useActionDispatch } from './useActionDispatch';
import { BattleStatusMessage } from './BattleStatusMessage';
import { FLOATER_DURATION_MS, FLOATER_Y_OFFSET } from './combat3dConfig';
import { startPveEncounter } from '../../lib/api-world';

export function Combat3DBody(): JSX.Element | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { send } = useWebSocket();
  const activeBattle = useWsStore((state) => state.activeBattle);
  const battleEvents = useWsStore((state) => state.battleEvents);
  const clearActiveBattle = useWsStore((state) => state.clearActiveBattle);

  const [commandMode, setCommandMode] = useState<CommandMode>('menu');
  const [selectedTargetId, setSelectedTargetId] = useState<UnitId | null>(null);
  const [floaters, setFloaters] = useState<readonly Floater3D[]>([]);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<UnitId | null>(null);

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

  // Party-only manual skills (no enemy-side pattern in their actions) let the
  // player click one of their own digimon as the target.
  const pendingSkillScope = useMemo<'auto' | 'enemy' | 'any' | null>(() => {
    if (pendingSkillId === null || actor === null) return null;
    const skill = actor.skills.find((s) => s.id === pendingSkillId);
    return skill ? skillTargetScope(skill) : null;
  }, [pendingSkillId, actor]);

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

  // Combat camera: when a digimon's turn comes up, frame that digimon (the
  // described "zoom in and position on the one whose turn it is"); on end,
  // release back to the default shot.
  useEffect(() => {
    const handle = sceneRef.current;
    if (handle === null) return;
    if (activeBattle === null || activeBattle.status !== 'active') {
      handle.resetCamera();
      return;
    }
    handle.focusUnit(activeBattle.currentTurnUnitId ?? null);
  }, [activeBattle?.currentTurnUnitId, activeBattle?.status]);

  useEffect(() => {
    if (activeBattle?.status !== 'ended') return;
    setEndModalOpen(true);
    void queryClient.invalidateQueries({ queryKey: ['roster'] });
    void queryClient.invalidateQueries({ queryKey: ['items'] });
    void queryClient.invalidateQueries({ queryKey: ['farm'] });
  }, [activeBattle?.status, queryClient]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setCommandMode('menu');
      setPendingSkillId(null);
      setPendingItemId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
  const activeTurnUnit = activeBattle.currentTurnUnitId
    ? activeBattle.friendly.find((unit) => unit.id === activeBattle.currentTurnUnitId) ?? activeBattle.enemy.find((unit) => unit.id === activeBattle.currentTurnUnitId)
    : null;

  return (
    <div
      className="stage"
      data-od-id="battle-stage"
      data-targeting={
        commandMode === 'target-fight' || commandMode === 'target-skill' || commandMode === 'items'
      }
      data-target-side={
        commandMode === 'items'
          ? 'ally'
          : commandMode === 'target-skill' && pendingSkillScope === 'any'
            ? 'both'
            : 'enemy'
      }
    >
      <Combat3DScene
        ref={sceneRef}
        battle={activeBattle}
        onEnemyClick={(unitId) => {
          if (!canAct) return;
          if (commandMode === 'target-fight') {
            dispatch({ type: 'fight', unitId: actor!.id, targetId: unitId });
            setCommandMode('menu');
          } else if (commandMode === 'target-skill') {
            const skillId = pendingSkillId;
            if (skillId !== null) {
              dispatch({ type: 'skill', unitId: actor!.id, skillId, targetId: unitId });
              setPendingSkillId(null);
              setCommandMode('menu');
            }
          }
        }}
        onEnemyHover={setHoveredTargetId}
        onFriendlyClick={(unitId) => {
          if (!canAct || actor === null) return;
          if (commandMode === 'items' && pendingItemId !== null) {
            dispatch({ type: 'use_item', unitId: actor.id, targetId: unitId, itemId: pendingItemId });
            setPendingItemId(null);
            setCommandMode('menu');
          } else if (commandMode === 'target-skill' && pendingSkillId !== null && pendingSkillScope === 'any') {
            // Party-only manual skill — the friendly digimon is a valid target.
            dispatch({ type: 'skill', unitId: actor.id, skillId: pendingSkillId, targetId: unitId });
            setPendingSkillId(null);
            setCommandMode('menu');
          }
        }}
      />

      <div className="arena-fallback" id="arena-fallback" role="img" aria-label="3D arena unavailable — combat still playable">
        <div className="box">
          <b>3D arena unavailable</b>
          <br />
          Your device blocked WebGL. Combat is still fully playable — use the command menu.
        </div>
      </div>

      <EnemyHealthBars battle={activeBattle} sceneRef={sceneRef} hoveredTargetId={hoveredTargetId} selectionElement={commandMode === 'target-skill' && pendingSkillId !== null ? actor?.skills.find((skill) => skill.id === pendingSkillId)?.element ?? null : null} />
      <AilmentBadgesLayer battle={activeBattle} sceneRef={sceneRef} />
      <BuffBadgesLayer battle={activeBattle} sceneRef={sceneRef} />

        <div className="overlay">
          <div className="battle-utility open">
            <div className="battle-feed-body is-open">
              <BattleFeed events={displayEvents} battle={activeBattle} />
            </div>
          </div>
        </div>

        <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true"></div>

        <TurnOrderRail battle={activeBattle} />
        <ActiveTurnMarker battle={activeBattle} sceneRef={sceneRef} />
        {activeTurnUnit ? (
          <div className={`active-turn-banner ${activeBattle.currentTurnBelongsToYou ? 'is-you' : 'is-enemy'}`} role="status">
            <span>{activeBattle.currentTurnBelongsToYou ? 'Your turn' : 'Enemy turn'}</span>
            <AttributeIcon attribute={activeTurnUnit.attribute} size="sm" />
            <b>{activeTurnUnit.name}</b>
          </div>
        ) : null}

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
            onGuard={() => actor && dispatch({ type: 'guard', unitId: actor.id })}
            onPendingSkill={setPendingSkillId}
            onPendingItem={setPendingItemId}
          />
        </div>

        <Floaters floaters={floaters} />

      {activeBattle.status === 'ended' && endModalOpen ? (
        <EndCard
          battle={activeBattle}
          rewards={battleRewards}
          onClose={() => {
            setEndModalOpen(false);
            clearActiveBattle();
            navigate(activeBattle.mode === 'pve' ? '/world' : '/', { replace: true });
          }}
          {...(activeBattle.mode === 'pve' && activeBattle.sceneId ? {
            onContinue: async () => {
              // Fecha o card primeiro; o próximo match chega via WS (caso
              // 'match') e substitui a cena — sem limpar antes, evitando tela
              // em branco. Se a nova batalha falhar (ex.: meat insuficiente),
              // volta ao globo em vez de prender o jogador na cena.
              setEndModalOpen(false);
              // Novo combate com digimons DIFERENTES: exclui as espécies que
              // acabaram de ser enfrentadas do próximo sorteio do pool.
              const justFought = activeBattle.enemy.map((e) => e.templateId);
              const next = await startPveEncounter(activeBattle.sceneId!, 'explore', 1, justFought);
              if (!next.ok) {
                clearActiveBattle();
                navigate('/world', { replace: true });
              }
            },
          } : {})}        />
      ) : null}

      <BattleStatusMessage error={loadError} />
    </div>
  );
}
