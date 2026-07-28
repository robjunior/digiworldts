import type { Action, BattleView, EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Ailment } from '@digiworld/shared/digimon';
import type { WSClientMessage } from '@digiworld/shared/ws';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Combat3DScene, type Combat3DSceneHandle } from './Combat3DScene';
import { CommandPanel, type CommandMode } from '../combat/CommandPanel';
import { EndCard } from '../combat/EndCard';
import { useWebSocket } from '../../hooks/useWebSocket';
import { actInWorldBattle, ApiError } from '../../lib/api';
import type { ItemDrop, XpAward } from '../../lib/api-world';
import { useWsStore } from '../../state/wsStore';
import { isAnimatedElement } from '../../scene3d/attack-runners/types';
import type { AnimatedElement } from '../../scene3d/attack-runners/types';

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

type Floater3D = { readonly id: string; readonly text: string; readonly kind: 'dmg' | 'crit' | 'miss' | 'resist'; readonly x: number; readonly y: number };

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
  const [pveResults, setPveResults] = useState<{ readonly xpAwards: readonly XpAward[]; readonly itemDrops?: readonly ItemDrop[]; readonly creditsGained?: number; readonly bitsGained?: number } | null>(null);
  const [endModalOpen, setEndModalOpen] = useState<boolean>(false);
  const [autobattle, setAutobattle] = useState<boolean>(() => readAutobattlePref());

  const sceneRef = useRef<Combat3DSceneHandle | null>(null);
  const seenEventCountRef = useRef(0);
  const dispatchPendingRef = useRef<boolean>(false);
  const autobattleKeyRef = useRef<string | null>(null);
  const cmdRef = useRef<HTMLDivElement | null>(null);
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const enemyPlaybackRef = useRef<{ queue: BattleView['log']; timer: number | null }>({ queue: [], timer: null });

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

  useEffect(() => {
    const el = logBodyRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [displayEvents.length]);

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

  const playActionEvent = useCallback((event: BattleView['log'][number]): void => {
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
    if (!actorIsFriendly && isAnimatedElement(event.skillElement) && (damage ?? 0) > 0) {
      sceneRef.current?.playEffect(event.skillElement as AnimatedElement, event.actor, targetId);
    }
  }, [activeBattle?.yourSide, spawnFloater]);

  const drainEnemyQueue = useCallback((): void => {
    const state = enemyPlaybackRef.current;
    const next = state.queue.shift();
    if (next === undefined) {
      state.timer = null;
      return;
    }
    playActionEvent(next);
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
    seenEventCountRef.current = battleEvents.length;
    const yourSide = activeBattle?.yourSide ?? 'a';
    for (const event of nextEvents) {
      if (event.type !== 'action') continue;
      const actorIsFriendly = event.actor !== null && event.actor.startsWith(`${yourSide}:`);
      if (actorIsFriendly) {
        playActionEvent(event);
      } else {
        enemyPlaybackRef.current.queue.push(event);
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
          const rewards: { readonly xpAwards: readonly XpAward[]; readonly itemDrops?: readonly ItemDrop[]; readonly creditsGained?: number; readonly bitsGained?: number } = {
            xpAwards: response.xpAwards ?? [],
            ...(response.itemDrops && response.itemDrops.length > 0 ? { itemDrops: response.itemDrops } : {}),
            ...(response.creditsGained !== undefined && response.creditsGained > 0 ? { creditsGained: response.creditsGained } : {}),
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
      sceneRef.current.playEffect(vfx.element, vfx.sourceId, vfx.targetId);
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
  const yourSide = activeBattle.yourSide;
  const oppSide = yourSide === 'a' ? 'b' : 'a';
  const showAutobattle = activeBattle.mode === 'pve' && activeBattle.status === 'active';

  return (
    <div className="stage" data-od-id="battle-stage">
      <Combat3DScene ref={sceneRef} battle={activeBattle} />
      
      <div className="arena-fallback" id="arena-fallback" role="img" aria-label="3D arena unavailable — combat still playable">
        <div className="box"><b>3D arena unavailable</b><br/>Your device blocked WebGL. Combat is still fully playable — use the command menu.</div>
      </div>

      <EnemyHealthBars battle={activeBattle} sceneRef={sceneRef} />
      <AilmentBadgesLayer battle={activeBattle} sceneRef={sceneRef} />
      
      <div className="overlay">
        <div className="side-badge">
          <div className="sb">
            <span className="k">Wild Pack</span>
            <span className="pips">
              {activeBattle.enemy.map((e) => (
                <span key={e.id} className={`pip ${e.down || e.hp <= 0 ? '' : 'alive'}`} title={e.name} />
              ))}
            </span>
          </div>
          <aside className="feed" aria-label="Battle feed">
            <h4>Battle Feed</h4>
            <div className="feedbody" role="log" aria-live="polite" aria-relevant="additions" ref={logBodyRef}>
              {displayEvents.slice(-30).map((event, idx) => (
                <div key={`log-${idx}-${event.at}`} className="mrow">
                  <span className="rd">R{event.type === 'round-start' ? event.round : (activeBattle.round)}</span>
                  <span className="men">{renderEventText(event, activeBattle)}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true"></div>

        <div className="topbar">
          <div className="tstrip" role="status" aria-live="polite" aria-atomic="true">
            <span className="rd">Round {activeBattle.round}</span>
            <span className={`tt ${activeBattle.yourTurn ? 'you' : ''}`}>{activeBattle.yourTurn ? 'Your Turn' : 'Opponent'}</span>
            <span className="actor">{actor?.name ?? activeBattle.enemy.find((e) => !e.down)?.name ?? '—'}</span>
          </div>
          <div className="nextq" role="list" aria-label="Turn order">
            <span className="nl" aria-hidden="true">Next</span>
            <span style={{display:'flex',gap:'11px'}}>
              <TurnOrderStrip battle={activeBattle} />
            </span>
          </div>
        </div>

        <div className="team-badge">
          <span className="k">Your Team</span>
          <div className="pips">
            {activeBattle.friendly.map((u) => (
              <span key={u.id} className={`pip ${u.down || u.hp <= 0 ? '' : 'alive'}`} title={u.name} />
            ))}
          </div>
        </div>

        <div className="enemy-rail" role="group" aria-label="Enemy Digimon">
          {aliveEnemies.map((foe) => (
            <button
              key={foe.id}
              type="button"
              className={`erow ${selectedTargetId === foe.id ? 'sel' : ''}`}
              onClick={() => setSelectedTargetId(foe.id)}
              disabled={!canAct}
              aria-pressed={selectedTargetId === foe.id}
            >
              <span className="edot pill" style={{ ['--el' as string]: `var(--el-${foe.element})` }} />
              <span className="enm">{foe.name}</span>
              <span className="ehp">{foe.hp}/{foe.hpMax}</span>
            </button>
          ))}
        </div>

        <div className="party-cards" role="group" aria-label="Your party">
          {activeBattle.friendly.map((unit) => (
            <PartyCard key={unit.id} unit={unit} active={unit.id === activeBattle.currentTurnUnitId && activeBattle.currentTurnBelongsToYou} />
          ))}
        </div>

        {showAutobattle ? (
          <button
            type="button"
            className="auto-toggle"
            aria-pressed={autobattle}
            onClick={() => setAutobattle((v) => !v)}
          >
            <span className="dot" style={{ background: autobattle ? 'var(--signal)' : 'transparent' }}></span>Auto: {autobattle ? 'On' : 'Off'}
          </button>
        ) : null}

        <div className="cmd" data-od-id="command-menu" ref={cmdRef}>
          <CommandPanel
            mode={commandMode}
            actor={actor}
            target={selectedTarget}
            friendly={activeBattle.friendly}
            yourTurn={canAct}
            pveMode={activeBattle.mode === 'pve'}
            onMode={setCommandMode}
            onFight={(targetId) => actor && dispatchAction({ type: 'fight', unitId: actor.id, targetId })}
            onSkill={(skillId, targetId) => actor && dispatchAction({ type: 'skill', unitId: actor.id, skillId, targetId })}
            onGuard={() => actor && dispatchAction({ type: 'guard', unitId: actor.id })}
            onAnalyze={(targetId) => actor && dispatchAction({ type: 'analyze', unitId: actor.id, targetId })}
            onUseItem={(itemId, targetId) => actor && dispatchAction({ type: 'use_item', unitId: actor.id, targetId, itemId })}
            onFlee={() => dispatchAction({ type: 'flee' })}
          />
        </div>

        <div className="c3d-floaters" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
          {floaters.map((f) => (
            <div key={f.id} className={`floater ${f.kind}`} style={{ left: f.x, top: f.y }}>{f.text}</div>
          ))}
        </div>
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

const AilmentBadgesLayer = memo(function AilmentBadgesLayer({ battle, sceneRef }: { readonly battle: BattleView; readonly sceneRef: React.RefObject<Combat3DSceneHandle | null> }): JSX.Element {
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
          style={{ position: 'absolute', top: 0, left: 0, display: 'flex', gap: '2px', opacity: 0 }}
        >
          {unit.ailments.map((a) => (
            <span
              key={a.kind}
              className={`tag`}
              title={`${AILMENT_LABEL[a.kind]} · ${a.turnsLeft} turn${a.turnsLeft === 1 ? '' : 's'} left`}
              style={{ background: 'var(--panel)', border: '1px solid var(--hair)', padding: '2px 4px', fontSize: '10px' }}
            >
              <span aria-hidden="true" style={{ marginRight: '4px' }}>{AILMENT_ICON[a.kind]}</span>
              <span>{a.turnsLeft}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});

const AILMENT_ICON: Record<Ailment, string> = {
  burn: '🔥', poison: '☠', weaken: '⬇', freeze: '❄', stun: '⚡', sleep: '💤', blind: '🙈', silence: '∅', root: '⚓', petrify: '🗿', curse: '💀', corruption: '☣', confusion: '💫', charm: '💘',
};

const AILMENT_LABEL: Record<Ailment, string> = {
  burn: 'Burned', poison: 'Poisoned', weaken: 'Weakened', freeze: 'Frozen', stun: 'Stunned', sleep: 'Asleep', blind: 'Blinded', silence: 'Silenced', root: 'Rooted', petrify: 'Petrified', curse: 'Cursed', corruption: 'Corrupted', confusion: 'Confused', charm: 'Charmed',
};

const TurnOrderStrip = memo(function TurnOrderStrip({ battle }: { readonly battle: BattleView }): JSX.Element | null {
  const upcoming = battle.upcomingTurns ?? [];
  if (upcoming.length === 0) return null;
  const yourSide = battle.yourSide;
  const templateFor = (unitId: string): { templateId: string; name: string; element: string } | null => {
    const friendly = battle.friendly.find((u) => u.id === unitId);
    if (friendly) return { templateId: friendly.templateId, name: friendly.name, element: friendly.element };
    const enemy = battle.enemy.find((u) => u.id === unitId);
    if (enemy) return { templateId: enemy.templateId, name: enemy.name, element: enemy.element };
    return null;
  };
  return (
    <>
      {upcoming.map((entry, idx) => {
        const meta = templateFor(entry.unitId);
        if (meta === null) return null;
        const isYours = entry.side === yourSide;
        const isCurrent = idx === 0;
        const mono = (meta.name || '?').trim().charAt(0).toUpperCase();
        return (
          <span key={`${entry.unitId}-${idx}`} className={`qi ${isCurrent ? 'cur' : ''} ${isYours ? 'yours' : 'opp'}`} style={{ ['--el' as string]: `var(--el-${meta.element})` }} title={`${meta.name}`}>
            <span className="mono" aria-hidden="true">{mono}</span>
            <img src={`/assets/digimon/${meta.templateId}/dot.gif`} alt="" onError={(e) => e.currentTarget.setAttribute('data-failed', '')} />
          </span>
        );
      })}
    </>
  );
});

const EnemyHealthBars = memo(function EnemyHealthBars({ battle, sceneRef }: { readonly battle: BattleView; readonly sceneRef: React.RefObject<Combat3DSceneHandle | null> }): JSX.Element {
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

const PartyCard = memo(function PartyCard({ unit, active }: { readonly unit: FriendlyUnitView; readonly active: boolean }): JSX.Element {
  const hpPct = unit.hpMax > 0 ? Math.max(0, unit.hp) / unit.hpMax : 0;
  const enPct = unit.enMax > 0 ? Math.max(0, unit.en) / unit.enMax : 0;
  const mono = (unit.name || '?').trim().charAt(0).toUpperCase();
  return (
    <div className={`pcard ${active ? 'active' : ''} ${unit.down || unit.hp <= 0 ? 'dead' : ''}`} style={{ ['--el' as string]: `var(--el-${unit.element})` }}>
      <div className="ph">
        <span className="spr-slot pspr" style={{ ['--el' as string]: `var(--el-${unit.element})` }}>
          <span className="mono" aria-hidden="true">{mono}</span>
          <img src={`/assets/digimon/${unit.templateId}/dot.gif`} alt="" onError={(e) => e.currentTarget.setAttribute('data-failed', '')} />
        </span>
        <div className="pn">
          <span className="nm">{unit.name}</span>
          <span className="lv">Lv {unit.level}</span>
        </div>
        <div className="stat guard-ic" style={{ marginLeft: 'auto', display: 'none' }} title="Guarding">🛡</div>
      </div>
      <div className="stat">
        <span className="sk">HP</span>
        <span className="bar hp" role="progressbar" aria-label={`${unit.name} HP`} aria-valuemin={0} aria-valuemax={unit.hpMax} aria-valuenow={Math.max(0, unit.hp)}>
          <i style={{ width: `${hpPct * 100}%` }} />
        </span>
        <span className="sn">{Math.max(0, unit.hp)} / {unit.hpMax}</span>
      </div>
      <div className="stat">
        <span className="sk">EN</span>
        <span className="bar en">
          <i style={{ width: `${enPct * 100}%` }} />
        </span>
        <span className="sn en-n">{Math.max(0, unit.en)}/{unit.enMax}</span>
      </div>
    </div>
  );
});

function extractPlayerVfx(actor: FriendlyUnitView | null, action: Action): { readonly sourceId: UnitId; readonly targetId: UnitId; readonly element: AnimatedElement } | null {
  if (actor === null) return null;
  if (action.type === 'skill') {
    const skill = actor.skills.find((s) => s.id === action.skillId);
    if (skill && isAnimatedElement(skill.element)) return { sourceId: actor.id, targetId: action.targetId, element: skill.element };
    return null;
  }
  if (action.type === 'fight' && isAnimatedElement(actor.element)) {
    return { sourceId: actor.id, targetId: action.targetId, element: actor.element };
  }
  return null;
}

function renderEventText(event: BattleView['log'][number], battle: BattleView): string {
  if (event.type === 'action') {
    const cue = event.cue ?? '';
    const target = event.targetId ? (battle.friendly.find((u) => u.id === event.targetId)?.name ?? battle.enemy.find((u) => u.id === event.targetId)?.name ?? event.targetId) : '';
    const damage = event.damage !== undefined ? ` ${event.damage}` : '';
    return `${event.actor ?? '?'} → ${target}${damage} ${cue}`.trim();
  }
  if (event.type === 'round-start') return `Round ${event.round}`;
  if (event.type === 'end') return `Match ended: ${event.outcome}`;
  return event.type;
}
