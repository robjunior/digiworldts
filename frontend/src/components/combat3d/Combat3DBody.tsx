import type { Action, BattleView, EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { WSClientMessage } from '@digiworld/shared/ws';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Combat3DScene, type Combat3DSceneHandle } from './Combat3DScene';
import { CommandPanel, type CommandMode } from '../combat/CommandPanel';
import { EndCard } from '../combat/EndCard';
import { useWebSocket } from '../../hooks/useWebSocket';
import { actInWorldBattle, ApiError } from '../../lib/api';
import type { ItemDrop, XpAward } from '../../lib/api-world';
import { useWsStore } from '../../state/wsStore';
import { isAnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';

import { AilmentBadgesLayer } from './AilmentBadgesLayer';
import { BuffBadgesLayer } from './BuffBadgesLayer';
import { EnemyHealthBars } from './EnemyHealthBars';
import { PartyCard } from './PartyCard';
import { BattleFeed } from './BattleFeed';
import { EnemyRail } from './EnemyRail';
import { Floaters, type Floater3D } from './Floaters';
import { AutobattleToggle } from './AutobattleToggle';
import { SideBadge, TeamBadge, TopBar } from './SideAndTopBadges';

const ATTACK_PROPAGATION_MS = 700;
const AUTOBATTLE_STORAGE_KEY = 'digiworld.autobattle';

function readAutobattlePref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTOBATTLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAutobattlePref(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTOBATTLE_STORAGE_KEY, on ? '1' : '0');
  } catch {
    return;
  }
}

function pickAutoAction(actor: FriendlyUnitView, enemies: readonly EnemyUnitView[]): Action | null {
  const alive = enemies.filter((e) => !e.down && e.hp > 0);
  if (alive.length === 0) return null;
  const target = alive.reduce((low, e) => (e.hp < low.hp ? e : low));
  const affordable = actor.skills.filter((s) => s.energyCost <= actor.en);
  if (affordable.length > 0) {
    const best = affordable.reduce((a, b) => (b.power > a.power ? b : a));
    return { type: 'skill', unitId: actor.id, skillId: best.id, targetId: target.id };
  }
  return { type: 'fight', unitId: actor.id, targetId: target.id };
}

function extractPlayerVfx(actor: FriendlyUnitView | null, action: Action): { readonly sourceId: UnitId; readonly targetId: UnitId; readonly element: AnimatedElement; readonly vfxPresetId?: string } | null {
  if (actor === null) return null;
  if (action.type === 'skill') {
    const skill = actor.skills.find((s) => s.id === action.skillId);
    if (skill && isAnimatedElement(skill.element)) {
      return {
        sourceId: actor.id,
        targetId: action.targetId,
        element: skill.element,
        ...(skill.vfxPresetId !== undefined ? { vfxPresetId: skill.vfxPresetId } : {}),
      };
    }
    return null;
  }
  if (action.type === 'fight' && isAnimatedElement(actor.element)) {
    return { sourceId: actor.id, targetId: action.targetId, element: actor.element };
  }
  return null;
}

export function Combat3DBody(): JSX.Element | null {
  const { send, readyState } = useWebSocket();
  const queryClient = useQueryClient();
  const activeBattle = useWsStore((state) => state.activeBattle);
  const battleEvents = useWsStore((state) => state.battleEvents);
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const clearActiveBattle = useWsStore((state) => state.clearActiveBattle);

  const [commandMode, setCommandMode] = useState<CommandMode>('menu');
  const [selectedTargetId, setSelectedTargetId] = useState<UnitId | null>(null);
  const [floaters, setFloaters] = useState<readonly Floater3D[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pveResults, setPveResults] = useState<{ readonly xpAwards: readonly XpAward[]; readonly itemDrops?: readonly ItemDrop[]; readonly netcoreGained?: number; readonly bitsGained?: number } | null>(null);
  const [endModalOpen, setEndModalOpen] = useState<boolean>(false);
  const [autobattle, setAutobattle] = useState<boolean>(() => readAutobattlePref());
  const [feedOpen, setFeedOpen] = useState<boolean>(false);

  const sceneRef = useRef<Combat3DSceneHandle | null>(null);
  const seenEventCountRef = useRef(0);
  const dispatchPendingRef = useRef<boolean>(false);
  const autobattleKeyRef = useRef<string | null>(null);
  const cmdRef = useRef<HTMLDivElement | null>(null);
  // Queue entries carry their own VFX decision: one skill cast can emit several
  // events (a `deal_damage` plus an `apply_status` on the same target), and now
  // that non-damage events render, every one of them would fire its own effect
  // 700ms apart for a single cast.
  const enemyPlaybackRef = useRef<{
    queue: Array<{ event: BattleView['log'][number]; playVfx: boolean }>;
    timer: number | null;
  }>({ queue: [], timer: null });

  useEffect(() => {
    const node = cmdRef.current;
    if (node === null) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const h = entry.contentRect.height;
      node.style.setProperty('--c3d-cmd-live-h', `${Math.round(h)}px`);
      const stage = node.closest('.c3d-stage') as HTMLElement | null;
      if (stage !== null) stage.style.setProperty('--c3d-cmd-live-h', `${Math.round(h)}px`);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    writeAutobattlePref(autobattle);
  }, [autobattle]);

  const displayEvents = battleEvents.length > 0 ? battleEvents : activeBattle?.log ?? [];

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

  const spawnFloater = useCallback((targetId: UnitId, text: string, kind: Floater3D['kind']): void => {
    const handle = sceneRef.current;
    if (handle === null) return;
    const pos = handle.screenPositionOf(targetId);
    if (pos === null) return;
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setFloaters((items) => [...items, { id, text, kind, x: pos.x, y: pos.y - 20 }]);
    window.setTimeout(() => setFloaters((items) => items.filter((f) => f.id !== id)), 900);
  }, []);

  const playActionEvent = useCallback((event: BattleView['log'][number], playVfx = true): void => {
    if (event.type !== 'action') return;
    const targetId = event.targetId;
    const damage = event.damage;
    if (targetId === undefined || targetId === null) return;
    const yourSide = activeBattle?.yourSide ?? 'a';
    const actorIsFriendly = event.actor !== null && event.actor.startsWith(`${yourSide}:`);
    if (damage !== undefined) {
      const kind: Floater3D['kind'] = event.cue === 'crit' ? 'crit' : event.cue === 'miss' ? 'miss' : event.cue === 'resist' ? 'resist' : 'dmg';
      spawnFloater(targetId, damage > 0 ? String(damage) : event.cue === 'miss' ? 'MISS' : event.cue === 'resist' ? 'RESIST' : '0', kind);
    }
    // Support and debuff skills report `damage: 0` (status, buff, stat change,
    // cleanse, dispel) or a negative value (heal), so gating on `damage > 0`
    // silenced every one of them — a preset picked for a heal rendered nothing.
    // Misses stay silent on purpose: `playEffect`'s impact callback fires
    // `playHit` and flashes the target, which would read as a landed hit.
    const isMiss = event.cue === 'miss';
    if (playVfx && !actorIsFriendly && isAnimatedElement(event.skillElement) && !isMiss) {
      sceneRef.current?.playEffect(event.skillElement as AnimatedElement, event.actor, targetId, event.vfxPresetId !== undefined ? { vfxPresetId: event.vfxPresetId } : undefined);
    }
  }, [activeBattle?.yourSide, spawnFloater]);

  const drainEnemyQueue = useCallback((): void => {
    const state = enemyPlaybackRef.current;
    const next = state.queue.shift();
    if (next === undefined) {
      state.timer = null;
      return;
    }
    playActionEvent(next.event, next.playVfx);
    state.timer = window.setTimeout(() => drainEnemyQueue(), ATTACK_PROPAGATION_MS);
  }, [playActionEvent]);

  useEffect(() => {
    return () => {
      const t = enemyPlaybackRef.current.timer;
      if (t !== null) window.clearTimeout(t);
      enemyPlaybackRef.current.timer = null;
      enemyPlaybackRef.current.queue = [];
    };
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
        enemyPlaybackRef.current.queue.push({ event, playVfx });
      }
    }
    if (enemyPlaybackRef.current.timer === null && enemyPlaybackRef.current.queue.length > 0) {
      drainEnemyQueue();
    }
  }, [battleEvents, activeBattle?.yourSide, playActionEvent, drainEnemyQueue]);

  const runServerDispatch = useCallback((action: Action): void => {
    if (!activeBattle) return;
    if (activeBattle.mode === 'pve') {
      void actInWorldBattle(action).then((response) => {
        const previousLogLength = activeBattle.log.length;
        const newEvents = response.battle.log.slice(previousLogLength);
        if (newEvents.length > 0) {
          handleServerMessage({ type: 'event', matchId: response.battle.id, events: newEvents });
        }
        if (action.type === 'use_item') {
          void queryClient.invalidateQueries({ queryKey: ['items'] });
        }
        if (response.ended) {
          handleServerMessage({ type: 'end', matchId: response.battle.id, view: response.battle, outcome: response.battle.outcome ?? 'abandoned' });
          const rewards: { readonly xpAwards: readonly XpAward[]; readonly itemDrops?: readonly ItemDrop[]; readonly netcoreGained?: number; readonly bitsGained?: number } = {
            xpAwards: response.xpAwards ?? [],
            ...(response.itemDrops && response.itemDrops.length > 0 ? { itemDrops: response.itemDrops } : {}),
            ...(response.netcoreGained !== undefined && response.netcoreGained > 0 ? { netcoreGained: response.netcoreGained } : {}),
            ...(response.bitsGained !== undefined && response.bitsGained > 0 ? { bitsGained: response.bitsGained } : {}),
          };
          setPveResults(rewards);
          setEndModalOpen(true);
        } else {
          handleServerMessage({ type: 'battle', matchId: response.battle.id, view: response.battle });
        }
      }).catch((error: unknown) => {
        if (error instanceof ApiError) {
          setLoadError(error.message);
          return;
        }
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
  }, [activeBattle, handleServerMessage, queryClient, send]);

  const dispatchAction = useCallback((action: Action): void => {
    if (!activeBattle || dispatchPendingRef.current) return;
    const vfx = extractPlayerVfx(actor, action);
    if (vfx !== null && sceneRef.current !== null) {
      dispatchPendingRef.current = true;
      sceneRef.current.playEffect(vfx.element, vfx.sourceId, vfx.targetId, vfx.vfxPresetId !== undefined ? { vfxPresetId: vfx.vfxPresetId } : undefined);
      setCommandMode('menu');
      window.setTimeout(() => {
        runServerDispatch(action);
        dispatchPendingRef.current = false;
      }, ATTACK_PROPAGATION_MS);
      return;
    }
    runServerDispatch(action);
    setCommandMode('menu');
  }, [activeBattle, actor, runServerDispatch]);

  useEffect(() => {
    if (activeBattle?.status !== 'active') {
      autobattleKeyRef.current = null;
    }
  }, [activeBattle?.status, activeBattle?.id]);

  useEffect(() => {
    if (!autobattle) return;
    if (!activeBattle || activeBattle.mode !== 'pve' || activeBattle.status !== 'active') return;
    if (!activeBattle.yourTurn || actor === null || actor.down) return;
    if (commandMode !== 'menu') return;
    const turnKey = `${activeBattle.id}:${activeBattle.round}:${activeBattle.log.length}:${actor.id}`;
    if (autobattleKeyRef.current === turnKey) return;
    const action = pickAutoAction(actor, activeBattle.enemy);
    if (action === null) return;
    autobattleKeyRef.current = turnKey;
    const timerId = window.setTimeout(() => dispatchAction(action), 400);
    return () => window.clearTimeout(timerId);
  }, [autobattle, activeBattle, actor, commandMode, dispatchAction]);

  if (activeBattle === null) return null;

  const canAct = activeBattle.yourTurn && actor !== null && !actor.down && activeBattle.status === 'active';
  const showAutobattle = activeBattle.mode === 'pve' && activeBattle.status === 'active';

  return (
    <div className="stage" data-od-id="battle-stage">
      <Combat3DScene ref={sceneRef} battle={activeBattle} />
      
      <div className="arena-fallback" id="arena-fallback" role="img" aria-label="3D arena unavailable — combat still playable">
        <div className="box"><b>3D arena unavailable</b><br/>Your device blocked WebGL. Combat is still fully playable — use the command menu.</div>
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
          </button>
          <div className="side-badge-content">
            <SideBadge battle={activeBattle} />
            <BattleFeed events={displayEvents} battle={activeBattle} />
            {feedOpen && <button className="mobile-feed-close" onClick={() => setFeedOpen(false)}>Close</button>}
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
        />

        <div className="party-cards" role="group" aria-label="Your party">
          {activeBattle.friendly.map((unit) => (
            <PartyCard key={unit.id} unit={unit} active={unit.id === activeBattle.currentTurnUnitId && activeBattle.currentTurnBelongsToYou} />
          ))}
        </div>

        {showAutobattle ? (
          <AutobattleToggle on={autobattle} onToggle={() => setAutobattle((v) => !v)} />
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
            onFight={(targetId) => actor && dispatchAction({ type: 'fight', unitId: actor.id, targetId })}
            onSkill={(skillId, targetId, extraTargetIds) => actor && dispatchAction(extraTargetIds ? { type: 'skill', unitId: actor.id, skillId, targetId, extraTargetIds } : { type: 'skill', unitId: actor.id, skillId, targetId })}
            onUseItem={(itemId, targetId) => actor && dispatchAction({ type: 'use_item', unitId: actor.id, targetId, itemId })}
            onFlee={() => dispatchAction({ type: 'flee' })}
          />
        </div>

        <Floaters floaters={floaters} />
      </div>

      {activeBattle.status === 'ended' && endModalOpen ? (
        <EndCard
          battle={activeBattle}
          pveResults={pveResults}
          onClose={() => { setEndModalOpen(false); clearActiveBattle(); }}
        />
      ) : null}
      
      {loadError !== null ? <div className="box" style={{ position: 'absolute', zIndex: 50, top: '20px', left: '50%', transform: 'translateX(-50%)', color: 'var(--signal)' }}>{loadError}</div> : null}
    </div>
  );
}