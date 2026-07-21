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
import { isAnimatedElement } from '../../scene3d/attack-runners/types';
import type { AnimatedElement } from '../../scene3d/attack-runners/types';

const ATTACK_PROPAGATION_MS = 700;

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

  const sceneRef = useRef<Combat3DSceneHandle | null>(null);
  const seenEventCountRef = useRef(0);
  const dispatchPendingRef = useRef<boolean>(false);

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

  useEffect(() => {
    const nextEvents = battleEvents.slice(seenEventCountRef.current);
    seenEventCountRef.current = battleEvents.length;
    const yourSide = activeBattle?.yourSide ?? 'a';
    for (const event of nextEvents) {
      if (event.type !== 'action') continue;
      const targetId = event.targetId;
      const damage = event.damage;
      if (targetId === undefined || targetId === null) continue;
      const isFriendly = targetId.startsWith(`${yourSide}:`);
      const actorIsFriendly = event.actor !== null && event.actor.startsWith(`${yourSide}:`);
      if (damage !== undefined) {
        const kind: Floater3D['kind'] = event.cue === 'crit' ? 'crit' : event.cue === 'miss' ? 'miss' : event.cue === 'resist' ? 'resist' : 'dmg';
        spawnFloater(targetId, damage > 0 ? String(damage) : event.cue === 'miss' ? 'MISS' : event.cue === 'resist' ? 'RESIST' : '0', kind);
      }
      const shouldSpawnEnemyEffect = !actorIsFriendly && isAnimatedElement(event.skillElement) && (damage ?? 0) > 0;
      if (shouldSpawnEnemyEffect) {
        sceneRef.current?.playEffect(event.skillElement as AnimatedElement, event.actor, targetId);
      }
      const isFriendlyTarget = isFriendly;
      const notSpawnedYet = !actorIsFriendly;
      void isFriendlyTarget; void notSpawnedYet;
    }
  }, [battleEvents, activeBattle?.yourSide, spawnFloater]);

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

  if (activeBattle === null) return null;

  const canAct = activeBattle.yourTurn && actor !== null && !actor.down && activeBattle.status === 'active';
  const yourSide = activeBattle.yourSide;
  const oppSide = yourSide === 'a' ? 'b' : 'a';

  return (
    <section className="c3d-stage" aria-label="Battle arena">
      <Combat3DScene ref={sceneRef} battle={activeBattle} />

      <div className={`c3d-turn ${activeBattle.yourTurn ? 'is-your' : 'is-opp'}`} role="status">
        <span className="rnd">Round <b>{activeBattle.round}</b></span>
        <span className="who">{activeBattle.yourTurn ? 'Your turn' : 'Opponent'}</span>
        <span className="actor">{actor?.name ?? activeBattle.enemy.find((e) => !e.down)?.name ?? '—'}</span>
      </div>

      <TeamOverlay label="Your team" units={activeBattle.friendly} align="left" />
      <TeamOverlay label={`vs ${oppSide.toUpperCase()}`} units={activeBattle.enemy} align="right" />

      <div className="c3d-party" role="list" aria-label="Your party status">
        {activeBattle.friendly.map((unit) => (
          <PartyCard key={unit.id} unit={unit} active={unit.id === activeBattle.currentTurnUnitId && activeBattle.currentTurnBelongsToYou} />
        ))}
      </div>

      <aside className="c3d-log" aria-label="Battle log">
        <div className="c3d-log-head">Battle feed</div>
        <div className="c3d-log-body">
          {displayEvents.slice(-30).map((event, idx) => (
            <div key={`log-${idx}-${event.at}`} className={`c3d-log-line ${event.type === 'action' ? event.cue ?? '' : event.type}`}>
              <span className="rd">R{event.type === 'round-start' ? event.round : (activeBattle.round)}</span>
              <span className="txt">{renderEventText(event, activeBattle)}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="c3d-cmd" data-od-id="command-menu">
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
        {activeBattle.enemy.filter((e) => !e.down).map((foe) => (
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

function TeamOverlay({ label, units, align }: { readonly label: string; readonly units: readonly { readonly id: string; readonly name: string; readonly down: boolean; readonly hp: number; readonly element: string }[]; readonly align: 'left' | 'right' }): JSX.Element {
  const alive = units.filter((u) => !u.down && u.hp > 0).length;
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
}

function PartyCard({ unit, active }: { readonly unit: FriendlyUnitView; readonly active: boolean }): JSX.Element {
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
}

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
