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
    const turnKey = `${activeBattle.id}:${activeBattle.round}:${activeBattle.log.length}:${actor.id}`;
    if (autobattleKeyRef.current === turnKey) return;
    const action = pickAutoAction(actor, activeBattle.enemy);
    if (action === null) return;
    autobattleKeyRef.current = turnKey;
    const timerId = window.setTimeout(() => dispatchAction(action), 400);
    return () => window.clearTimeout(timerId);
  }, [autobattle, activeBattle, actor, dispatchAction]);

  if (activeBattle === null) return null;

  const canAct = activeBattle.yourTurn && actor !== null && !actor.down && activeBattle.status === 'active';
  const yourSide = activeBattle.yourSide;
  const oppSide = yourSide === 'a' ? 'b' : 'a';
  const showAutobattle = activeBattle.mode === 'pve' && activeBattle.status === 'active';

  return (
    <section className="c3d-stage" aria-label="Battle arena">
      <Combat3DScene ref={sceneRef} battle={activeBattle} />

      <EnemyHealthBars battle={activeBattle} sceneRef={sceneRef} />

      <AilmentBadgesLayer battle={activeBattle} sceneRef={sceneRef} />

      <div className={`c3d-turn ${activeBattle.yourTurn ? 'is-your' : 'is-opp'}`} role="status">
        <span className="rnd">Round <b>{activeBattle.round}</b></span>
        <span className="who">{activeBattle.yourTurn ? 'Your turn' : 'Opponent'}</span>
        <span className="actor">{actor?.name ?? activeBattle.enemy.find((e) => !e.down)?.name ?? '—'}</span>
      </div>

      <TurnOrderStrip battle={activeBattle} />

      <TeamOverlay label="Your team" units={activeBattle.friendly} align="right" />
      <TeamOverlay label={`vs ${oppSide.toUpperCase()}`} units={activeBattle.enemy} align="left" />

      <div className="c3d-party" role="list" aria-label="Your party status">
        {activeBattle.friendly.map((unit) => (
          <PartyCard key={unit.id} unit={unit} active={unit.id === activeBattle.currentTurnUnitId && activeBattle.currentTurnBelongsToYou} />
        ))}
      </div>

      <aside className="c3d-log" aria-label="Battle log">
        <div className="c3d-log-head">Battle feed</div>
        <div className="c3d-log-body" ref={logBodyRef}>
          {displayEvents.slice(-30).map((event, idx) => (
            <div key={`log-${idx}-${event.at}`} className={`c3d-log-line ${event.type === 'action' ? event.cue ?? '' : event.type}`}>
              <span className="rd">R{event.type === 'round-start' ? event.round : (activeBattle.round)}</span>
              <span className="txt">{renderEventText(event, activeBattle)}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className={`c3d-cmd c3d-cmd--${commandMode}`} data-mode={commandMode} data-od-id="command-menu" ref={cmdRef}>
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

      <div className="c3d-target-picker" aria-label="Target selection">
        {aliveEnemies.map((foe) => (
          <button
            key={foe.id}
            type="button"
            className={`c3d-target ${selectedTargetId === foe.id ? 'is-active' : ''}`}
            onClick={() => setSelectedTargetId(foe.id)}
            disabled={!canAct}
            aria-pressed={selectedTargetId === foe.id}
          >
            <span className={`c3d-target-el pill--${foe.element}`} />
            <span className="c3d-target-name">{foe.name}</span>
            <span className="c3d-target-hp">{foe.hp}/{foe.hpMax}</span>
          </button>
        ))}
      </div>

      <div className="c3d-floaters" aria-hidden="true">
        {floaters.map((f) => (
          <div key={f.id} className={`c3d-float c3d-float--${f.kind}`} style={{ left: f.x, top: f.y }}>{f.text}</div>
        ))}
      </div>

      {loadError !== null ? <div className="c3d-toast is-err">{loadError}</div> : null}

      {showAutobattle ? (
        <button
          type="button"
          className={`c3d-autobattle ${autobattle ? 'is-on' : ''}`}
          aria-pressed={autobattle}
          onClick={() => setAutobattle((v) => !v)}
          data-od-id="c3d-autobattle-toggle"
        >
          <span className="c3d-autobattle-dot" aria-hidden="true" />
          Auto: {autobattle ? 'ON' : 'OFF'}
        </button>
      ) : null}

      {activeBattle.status === 'ended' && endModalOpen ? (
        <EndCard
          battle={activeBattle}
          pveResults={pveResults}
          onClose={() => { setEndModalOpen(false); clearActiveBattle(); }}
        />
      ) : null}

      <span className={`c3d-ws c3d-ws--${readyState}`} aria-hidden="true" />
    </section>
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
    <div className="c3d-ailment-layer" aria-hidden="true">
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

const AILMENT_ICON: Record<Ailment, string> = {
  burn: '🔥',
  poison: '☠',
  weaken: '⬇',
  freeze: '❄',
  stun: '⚡',
  sleep: '💤',
  blind: '🙈',
  silence: '∅',
  root: '⚓',
  petrify: '🗿',
  curse: '💀',
  corruption: '☣',
  confusion: '💫',
  charm: '💘',
};

const AILMENT_LABEL: Record<Ailment, string> = {
  burn: 'Burned',
  poison: 'Poisoned',
  weaken: 'Weakened',
  freeze: 'Frozen',
  stun: 'Stunned',
  sleep: 'Asleep',
  blind: 'Blinded',
  silence: 'Silenced',
  root: 'Rooted',
  petrify: 'Petrified',
  curse: 'Cursed',
  corruption: 'Corrupted',
  confusion: 'Confused',
  charm: 'Charmed',
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
    <div className="c3d-order" role="list" aria-label="Upcoming turn order">
      <span className="c3d-order-label">Next</span>
      {upcoming.map((entry, idx) => {
        const meta = templateFor(entry.unitId);
        if (meta === null) return null;
        const isYours = entry.side === yourSide;
        const isCurrent = idx === 0;
        const cls = ['c3d-order-slot', isYours ? 'is-yours' : 'is-opp', isCurrent ? 'is-current' : ''].filter(Boolean).join(' ');
        return (
          <div key={`${entry.unitId}-${idx}`} className={cls} role="listitem" title={`${meta.name} · ${isYours ? 'you' : 'opp'}${isCurrent ? ' · current' : ''}`} style={{ ['--el' as string]: `var(--el-${meta.element})` }}>
            <img className="c3d-order-mon" src={`/assets/digimon/${meta.templateId}/dot.gif`} alt={meta.name} loading="eager" />
            {isCurrent ? <span className="c3d-order-caret" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </div>
  );
});

const TeamOverlay = memo(function TeamOverlay({ label, units, align }: { readonly label: string; readonly units: readonly { readonly id: string; readonly name: string; readonly down: boolean; readonly hp: number; readonly element: string }[]; readonly align: 'left' | 'right' }): JSX.Element {  const alive = units.filter((u) => !u.down && u.hp > 0).length;
  return (
    <div className={`c3d-ov c3d-ov--${align === 'left' ? 'tl' : 'tr'}`}>
      <div className="c3d-ov-eyebrow">{label}</div>
      <div className={`c3d-side ${align === 'right' ? 'c3d-side--tr' : ''}`}>
        {units.map((u) => (
          <span key={u.id} className={`c3d-pip pill--${u.element} ${u.down || u.hp <= 0 ? 'is-ko' : ''}`} title={u.name} />
        ))}
      </div>
      <div className="c3d-sub"><b>{alive}</b>/{units.length} alive</div>
    </div>
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
    <div className="c3d-enemy-hp-layer" aria-hidden="true">
      {alive.map((enemy) => {
        const pct = enemy.hpMax > 0 ? Math.max(0, enemy.hp) / enemy.hpMax * 100 : 0;
        const critical = pct <= 25;
        return (
          <div
            key={enemy.id}
            ref={(el) => {
              if (el === null) barRefs.current.delete(enemy.id);
              else barRefs.current.set(enemy.id, el);
            }}
            className={`c3d-enemy-hp ${critical ? 'is-critical' : ''}`}
            style={{ ['--el' as string]: `var(--el-${enemy.element})` }}
          >
            <div className="c3d-enemy-hp-name">{enemy.name}</div>
            <div className="c3d-enemy-hp-bar">
              <span className="c3d-enemy-hp-fill" style={{ width: `${pct}%` }} />
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
  return (
    <div className={`c3d-unit ${active ? 'is-active' : ''}`} data-uid={unit.id} style={{ ['--el' as string]: `var(--el-${unit.element})` }}>
      <div className="c3d-unit-top">
        <span className="c3d-unit-name">{unit.name}</span>
        <span className="c3d-unit-lv">Lv {unit.level}</span>
      </div>
      <div className="c3d-unit-bar"><i style={{ transform: `scaleX(${hpPct})` }} /></div>
      <div className="c3d-unit-hp"><span>HP</span><span><b>{Math.max(0, unit.hp)}</b> / {unit.hpMax}</span></div>
      <div className="c3d-unit-en"><i style={{ transform: `scaleX(${enPct})` }} /></div>
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
