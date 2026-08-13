import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  activateDungeonTrigger,
  completeDungeon,
  getDungeon,
  moveInDungeon,
  startEncounter,
  startRandomEncounter,
  unlockDungeonDoor,
} from '../lib/api-dungeon';
import { ApiError, getRoster } from '../lib/api';
import { getCatalog } from '../lib/api-catalog';
import { getDialogue } from '../lib/api-dialogues';
import { getQuests } from '../lib/api-quests';
import { applyShopItem, getShop } from '../lib/api-shop';
import type { DungeonDoor, DungeonEncounter, DungeonItem, DungeonRunView, DungeonTile, EncounterDigimon } from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';
import { useWsStore } from '../state/wsStore';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../hooks/useLocale';

import { DungeonGrid } from '../components/dungeon/DungeonGrid';
import { DungeonInventoryPanel } from '../components/dungeon/DungeonInventoryPanel';
import { DungeonPartyBar } from '../components/dungeon/DungeonPartyBar';
import { DungeonRunLog } from '../components/dungeon/DungeonRunLog';
import { DungeonQuestPanel } from '../components/dungeon/DungeonQuestPanel';
import { DungeonActionBar } from '../components/dungeon/DungeonActionBar';
import { DungeonEncounterCard } from '../components/dungeon/DungeonEncounterCard';
import { DungeonDoorPrompt } from '../components/dungeon/DungeonDoorPrompt';
import { DialogueOverlay } from '../components/dungeon/DialogueOverlay';
import { DungeonStrip } from '../components/dungeon/DungeonStrip';
import type { LogEntry, PendingUnlock } from '../components/dungeon/types';
import '../styles/extensions-dungeon.css';

export function Dungeon(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);

  useEffect(() => {
    if (!id) {
      navigate('/world', { replace: true });
    }
  }, [id, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dungeon', id],
    queryFn: () => getDungeon(id!),
    enabled: !!id,
    staleTime: 0,
  });

  const rosterQuery = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster, staleTime: 30_000 });
  const shopQuery = useQuery({ queryKey: ['shop'] as const, queryFn: getShop, staleTime: 15_000 });
  const catalogQuery = useQuery({ queryKey: ['catalog'] as const, queryFn: getCatalog, staleTime: 5 * 60 * 1000 });
  const templateById = useMemo<ReadonlyMap<string, TemplateDigimon>>(
    () => new Map((catalogQuery.data?.digimons ?? []).map((entry) => [entry.id, entry] as const)),
    [catalogQuery.data],
  );
  const party = useMemo(() => {
    const list = (rosterQuery.data?.roster ?? []).filter((m) => m.status === 'party');
    return list.slice().sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  }, [rosterQuery.data]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // Not moveMutation.isPending: React state commits a render too late, so
  // several keydowns in one tick all read false and fire duplicate moves off
  // the same stale position. Refs flip synchronously.
  const movePendingRef = useRef(false);
  // Authoritative player position, mirrored synchronously from the last move
  // response. Reads in tryMove/handleCellClick must go through this ref —
  // `data` lags by one render, and a keydown firing between onSettled and the
  // re-render used to target a cell 2 tiles away → server rejects with
  // `not-adjacent` → swallowed steps + repeated warning toasts (feels laggy).
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wildStartPendingRef = useRef(false);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  const [activeRandomEncounter, setActiveRandomEncounter] = useState<readonly EncounterDigimon[] | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(null);
  const [pendingLever, setPendingLever] = useState<{ readonly x: number; readonly y: number; readonly triggerId: string; readonly label: string | null } | null>(null);
  const [stepCount, setStepCount] = useState(0);
  const [selectedInvItemId, setSelectedInvItemId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [partyTrail, setPartyTrail] = useState<readonly { readonly x: number; readonly y: number }[]>([]);
  const [facing, setFacing] = useState<'left' | 'right'>('right');
  const [activeSheet, setActiveSheet] = useState<'log' | 'items' | 'quest' | null>(null);
  const [exitConfirm, setExitConfirm] = useState<{ readonly x: number; readonly y: number; readonly to: string | null } | null>(null);

  useEffect(() => {
    setPartyTrail([]);
    setFacing('right');
  }, [id]);

  useEffect(() => {
    const x = data?.run.currentX;
    const y = data?.run.currentY;
    if (x === undefined || y === undefined) return;
    posRef.current = { x, y };
    setPartyTrail((prev) => {
      if (prev[0]?.x === x && prev[0]?.y === y) return prev;
      return [{ x, y }, ...prev].slice(0, 3);
    });
  }, [data?.run.currentX, data?.run.currentY]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    const cell = scroller.querySelector<HTMLElement>(`[data-cell-x="${data?.run.currentX ?? -1}"][data-cell-y="${data?.run.currentY ?? -1}"]`);
    if (!cell) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const targetLeft = scroller.scrollLeft + (cellRect.left - scrollerRect.left) - scrollerRect.width / 2 + cellRect.width / 2;
    const targetTop = scroller.scrollTop + (cellRect.top - scrollerRect.top) - scrollerRect.height / 2 + cellRect.height / 2;
    scroller.scrollTo({ left: targetLeft, top: targetTop, behavior: 'instant' });
  }, [data?.run.currentX, data?.run.currentY]);

  const productById = useMemo(() => {
    const m = new Map<string, import('../lib/api-shop').ShopItemView>();
    for (const p of shopQuery.data?.catalog ?? []) m.set(p.id, p);
    return m;
  }, [shopQuery.data]);

  const flashToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const pushLog = useCallback((text: string, cls: '' | 'hit' | 'item'): void => {
    setLogs((prev) => {
      const step = prev.length + 1;
      return [...prev, { text, cls, step }];
    });
  }, []);

  const moveMutation = useMutation({
    mutationFn: async ({ x, y }: { x: number; y: number }) => {
      if (!id) throw new Error('No dungeon id');
      return moveInDungeon(id, x, y);
    },
    onSuccess: (res, { x, y }) => {
      const dx = x - posRef.current.x;
      if (dx !== 0) setFacing(dx < 0 ? 'left' : 'right');
      posRef.current = { x: res.run.currentX, y: res.run.currentY };
      setStepCount((s) => s + 1);
      if (res.blockedByDoorId) {
        const door = data?.doors.find((entry) => entry.id === res.blockedByDoorId);
        setPendingUnlock({ doorId: res.blockedByDoorId, keyItemId: door?.keyItemId ?? '' });
        pushLog(`Locked door at ${x}, ${y}.`, 'hit');
        return;
      }
      setPendingUnlock(null);
      setPendingLever(null);
      setActiveRandomEncounter(null);
      pushLog(`Moved to ${x}, ${y}.`, '');
      queryClient.setQueryData(['dungeon', id], (old: DungeonRunView | undefined) => {
        if (!old) return old;
        return { ...old, run: res.run };
      });
      if (res.trapTriggered) {
        const t = res.trapTriggered;
        const detail = t.dodged
          ? `Trap avoided! (party avg SPD ${t.partyAvgSpd}, ${Math.round(t.avoidChance * 100)}% dodge)`
          : `Trap! ${t.effectSummary}.`;
        pushLog(detail, t.dodged ? '' : 'hit');
      }
      if (res.pickedUpItemId) {
        const item = data?.items.find((i) => i.id === res.pickedUpItemId);
        if (item) {
          pushLog(`Picked up item.`, 'item');
          flashToast(`Picked up item!`);
        }
        queryClient.invalidateQueries({ queryKey: ['shop'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['roster'] });
      }
      if (res.triggeredEncounterId) {
        const enc = data?.encounters.find((e) => e.id === res.triggeredEncounterId);
        pushLog(`Ambushed by ${enc?.label ?? 'enemies'}!`, 'hit');
        setActiveEncounterId(res.triggeredEncounterId);
      }
      if (res.randomEncounter) {
        const mons = res.randomEncounter.map((m) => `${m.nickname || templateById.get(m.catalogId)?.name || m.catalogId} Lv ${m.level}`).join(', ');
        pushLog(`Wild encounter: ${mons}.`, 'hit');
        if (!wildStartPendingRef.current) {
          wildStartPendingRef.current = true;
          startRandomEncounterMutation.mutate(res.randomEncounter);
        }
      }
      if (Object.hasOwn(res, 'warpToDungeonId')) {
        navigate(res.warpToDungeonId === null ? '/world' : `/dungeon/${res.warpToDungeonId}`);
      }
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Cannot move there.');
    },
    onSettled: () => {
      movePendingRef.current = false;
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (doorId: string) => {
      if (!id) throw new Error('No dungeon id');
      return unlockDungeonDoor(id, doorId);
    },
    onSuccess: ({ view }) => {
      queryClient.setQueryData(['dungeon', id], view);
      queryClient.invalidateQueries({ queryKey: ['shop'] });
      queryClient.invalidateQueries({ queryKey: ['roster'] });
      setPendingUnlock(null);
      pushLog('Door unlocked.', 'item');
      flashToast('Door unlocked.');
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not unlock door.');
    },
  });

  const activateLeverMutation = useMutation({
    mutationFn: async (triggerId: string) => {
      if (!id) throw new Error('No dungeon id');
      return activateDungeonTrigger(id, triggerId);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['dungeon', id], res.view);
      setPendingLever(null);
      const trigger = res.view.triggers.find((entry) => entry.id === res.triggeredTriggerId);
      pushLog(`Pulled ${trigger?.label ?? 'a lever'}!`, 'item');
      flashToast(`${trigger?.label ?? 'Lever'} activated!`);
      if (res.activatedDoorId) pushLog('A door swung open.', 'item');
      if (res.activatedBridgeId) {
        const bridge = res.view.bridges.find((entry) => entry.id === res.activatedBridgeId);
        pushLog(`The ${bridge?.label ?? 'bridge'} lowers!`, 'item');
      }
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not activate lever.');
    },
  });

  const defeatMutation = { isPending: false, mutate: (_encId: string) => undefined };

  const startEncounterMutation = useMutation({
    mutationFn: async (encId: string) => {
      if (!id) throw new Error('No dungeon id');
      return startEncounter(id, encId);
    },
    onSuccess: ({ battle }, encId) => {
      if (!id) return;
      handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
      sessionStorage.setItem('dungeon-return', JSON.stringify({ dungeonId: id, encounterId: encId }));
      navigate('/loading', { state: { mode: 'combat', battle, returnTo: '/combat' } });
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not start battle.');
    },
  });

  const startRandomEncounterMutation = useMutation({
    mutationFn: async (digimon: readonly EncounterDigimon[]) => {
      if (!id) throw new Error('No dungeon id');
      return startRandomEncounter(id, digimon);
    },
    onSuccess: ({ battle }) => {
      if (!id) return;
      handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
      sessionStorage.setItem('dungeon-return', JSON.stringify({ dungeonId: id, encounterId: null, kind: 'random' }));
      setActiveRandomEncounter(null);
      navigate('/loading', { state: { mode: 'combat', battle, returnTo: '/combat' } });
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not start wild battle.');
    },
    onSettled: () => {
      wildStartPendingRef.current = false;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No dungeon id');
      return completeDungeon(id);
    },
    onSuccess: () => {
      pushLog(`Dungeon cleared!`, 'hit');
      flashToast('Dungeon Complete!');
      queryClient.invalidateQueries({ queryKey: ['dungeon', id] });
    },
  });

  const applyItemMutation = useMutation({
    mutationFn: ({ itemId, monId }: { readonly itemId: string; readonly monId?: string }) => applyShopItem(itemId, monId),
    onSuccess: (result, variables) => {
      const item = shopQuery.data?.inventory.find((entry) => entry.itemId === variables.itemId);
      const label = item?.name ?? 'Item';
      const target = variables.monId ? party.find((m) => m.id === variables.monId)?.nickname ?? 'party' : 'party';
      pushLog(`${label} applied to ${target}.`, 'item');
      flashToast(`${label} applied.`);
      setSelectedInvItemId(null);
      queryClient.invalidateQueries({ queryKey: ['shop'] });
      queryClient.invalidateQueries({ queryKey: ['roster'] });
      void result;
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not apply item.');
      setSelectedInvItemId(null);
    },
  });

  const handleSelectItem = useCallback((itemId: string, needsMon: boolean): void => {
    if (!needsMon) {
      applyItemMutation.mutate({ itemId });
      return;
    }
    setSelectedInvItemId((prev) => (prev === itemId ? null : itemId));
  }, [applyItemMutation]);

  const handleTargetMon = useCallback((monId: string): void => {
    if (!selectedInvItemId) return;
    applyItemMutation.mutate({ itemId: selectedInvItemId, monId });
  }, [applyItemMutation, selectedInvItemId]);

  const { user } = useAuth();
  const [dialogueDismissed, setDialogueDismissed] = useState(false);

  // A dungeon that belongs to a quest opens that quest's intro on entry. This
  // is the only trigger for now; deliberate NPC interaction arrives with the
  // /interact endpoint.
  const questId = data?.dungeon.questId ?? null;
  const questsQuery = useQuery({ queryKey: ['quests'], queryFn: getQuests, enabled: questId !== null });
  const introDialogueId = questId === null
    ? null
    : questsQuery.data?.find((q) => q.id === questId)?.introDialogueId ?? null;

  const dialogueQuery = useQuery({
    queryKey: ['dialogue', introDialogueId],
    queryFn: () => getDialogue(introDialogueId as string),
    enabled: introDialogueId !== null && !dialogueDismissed,
  });

  useEffect(() => {
    if (!activeSheet) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveSheet(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSheet]);

  const handleToggleSheet = useCallback((sheet: 'log' | 'items' | 'quest') => {
    setActiveSheet((prev) => prev === sheet ? null : sheet);
  }, []);

  const quest = questsQuery.data?.find((q) => q.id === questId) ?? null;

  const activeDialogue = dialogueDismissed ? null : dialogueQuery.data?.dialogue.definition ?? null;
  const dialogueOpen = activeDialogue !== null;

  const tryMove = useCallback((dx: number, dy: number) => {
    if (dialogueOpen) return;
    if (activeEncounterId || activeRandomEncounter) {
      flashToast('Resolve the encounter first.');
      return;
    }
    if (movePendingRef.current) return;
    const run = queryClient.getQueryData<DungeonRunView>(['dungeon', id]);
    if (!run) return;
    const cx = run.run.currentX;
    const cy = run.run.currentY;
    const nx = cx + dx;
    const ny = cy + dy;
    const tileKey = `${nx},${ny}`;
    const walkable = run.tiles.some((t) => `${t.x},${t.y}` === tileKey);
    if (!walkable) {
      const bridgeDown = run.bridges.some((bridge) =>
        bridge.x === nx && bridge.y === ny &&
        run.triggers.some((trigger) =>
          run.firedTriggerIds.includes(trigger.id) &&
          trigger.targets.some((target) => target.kind === 'bridge' && target.bridgeId === bridge.id),
        ),
      );
      if (!bridgeDown) {
        // Just silently do nothing if trying to move into a wall
        return;
      }
    }
    const exitWarp = run.warps.find((warp) => warp.x === nx && warp.y === ny && warp.targetDungeonId === null);
    if (exitWarp && (run.groupInventory.length ?? 0) > 0) {
      setExitConfirm({ x: nx, y: ny, to: null });
      return;
    }
    movePendingRef.current = true;
    moveMutation.mutate({ x: nx, y: ny });
  }, [id, dialogueOpen, activeEncounterId, activeRandomEncounter, moveMutation, flashToast]);

  const handleCellClick = useCallback((x: number, y: number) => {
    const cx = posRef.current.x;
    const cy = posRef.current.y;
    const dist = Math.abs(cx - x) + Math.abs(cy - y);
    if (dist > 1) {
      flashToast('Can only move to adjacent tiles.');
      return;
    }
    if (dist <= 1) {
      const run = queryClient.getQueryData<DungeonRunView>(['dungeon', id]);
      const bossEnc = run?.encounters.find((e) =>
        e.difficulty === 'boss' && e.x === x && e.y === y && !run.run.defeatedEncounters.includes(e.id),
      );
      if (bossEnc !== undefined) {
        setPendingLever(null);
        setActiveEncounterId(bossEnc.id);
        return;
      }
      const lever = run?.triggers.find((t) => t.x === x && t.y === y);
      if (lever && run !== undefined && !run.firedTriggerIds.includes(lever.id)) {
        setPendingLever({ x, y, triggerId: lever.id, label: lever.label });
        return;
      }
    }
    setPendingLever(null);
    if (dist === 0) return;
    tryMove(x - cx, y - cy);
  }, [tryMove, flashToast, queryClient, id]);

  useEffect(() => {
    if (!data) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'w': case 'W': case 'ArrowUp':    dy = -1; break;
        case 's': case 'S': case 'ArrowDown':  dy =  1; break;
        case 'a': case 'A': case 'ArrowLeft':  dx = -1; break;
        case 'd': case 'D': case 'ArrowRight': dx =  1; break;
        default: return;
      }
      e.preventDefault();

      tryMove(dx, dy);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, tryMove]);

  if (error) {
    const code = error instanceof ApiError ? error.message : '';
    return (
      <div className="dungeon-gate-wrap">
        <div className="dungeon-gate" role="alert">
          <b>{code === 'empty-party' ? t('dungeon.gate.empty_party.title') : t('dungeon.gate.error.title')}</b>
          <span>{code === 'empty-party' ? t('dungeon.gate.empty_party.body') : String(error instanceof Error ? error.message : error)}</span>
          <div className="dungeon-gate-actions">
            <Link className="btn" to="/roster">{t('dungeon.gate.open_roster')}</Link>
            <Link className="btn btn--secondary" to="/world">{t('dungeon.gate.back_world')}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="stage"><div style={{ padding: 20, color: 'var(--el)' }}>Loading...</div></div>;
  }

  const { dungeon, run, tiles, tilesets, encounters, items, doors, chests, traps, poiStates, groupInventory, triggers, bridges, firedTriggerIds } = data;
  const isComplete = !!run.completedAt;
  const allEncountersDefeated = encounters.every((e) => run.defeatedEncounters.includes(e.id));

  // Determine active encounter object
  const activeEncounter = activeEncounterId ? (encounters.find((e) => e.id === activeEncounterId) ?? null) : null;
  const pendingDoor = pendingUnlock ? doors.find((door) => door.id === pendingUnlock.doorId) ?? null : null;
  const pendingKeyItemId = pendingDoor?.keyItemId ?? pendingUnlock?.keyItemId ?? '';
  const keyInventory = shopQuery.data?.inventory?.find((entry) => entry.itemId === pendingKeyItemId) ?? null;
  const keyItem = shopQuery.data?.catalog?.find((entry) => entry.id === pendingKeyItemId) ?? null;
  const keyName = keyInventory?.name ?? keyItem?.name ?? pendingKeyItemId;
  const canUnlock = pendingDoor?.dungeonKeyId ? groupInventory.some((entry) => entry.itemKind === 'dungeon-key' && entry.itemId === pendingDoor.dungeonKeyId && entry.qty > 0) : (keyInventory?.qty ?? 0) >= 1;

  return (
    <>
      <div className="stage" data-od-id="dungeon-stage" style={{ '--el': 'var(--el-light)' } as CSSProperties}>
        <DungeonStrip
          dungeonName={dungeon.name}
          currentX={run.currentX}
          currentY={run.currentY}
        />

        <div className="view">
          {activeDialogue !== null ? (
            <DialogueOverlay
              definition={activeDialogue}
              variables={{ player_name: user?.displayName ?? 'Tamer' }}
              onClose={() => setDialogueDismissed(true)}
            />
          ) : null}
          {pendingDoor ? (
            <DungeonDoorPrompt
              pendingDoor={pendingDoor}
              keyName={keyName}
              canUnlock={canUnlock}
              isUnlocking={unlockMutation.isPending}
              onUnlock={(doorId) => unlockMutation.mutate(doorId)}
            />
          ) : null}
          <div className="dgrid-scroll" ref={gridScrollRef}>
            <DungeonGrid
              dungeon={dungeon}
              run={run}
              tiles={tiles}
              tilesets={tilesets}
              encounters={encounters}
              items={items}
              doors={doors}
              chests={chests}
              traps={traps}
              triggers={triggers}
              bridges={bridges}
              poiStates={poiStates}
              firedTriggerIds={firedTriggerIds}
              pendingLever={pendingLever}
              onPullLever={(triggerId) => activateLeverMutation.mutate(triggerId)}
              onDismissLever={() => setPendingLever(null)}
              isPullingLever={activateLeverMutation.isPending}
              facing={facing}
              party={party}
              partyTrail={partyTrail}
              onCellClick={handleCellClick}
            />
          </div>
        </div>

        <div className="controls">
          <div className="dhint">
            {isComplete ? <b>Cleared — free-explore mode. All paths open.</b> : <b>Click an adjacent tile to move (WASD/arrows).</b>}
          </div>
        </div>
      </div>

      <aside className="rail" data-od-id="run-rail">
        <DungeonPartyBar
          party={party}
          targeting={selectedInvItemId !== null}
          busy={applyItemMutation.isPending}
          now={now}
          onTarget={handleTargetMon}
        />
        <div className="rail-log-inv">
          <div className={`sheet${activeSheet === 'items' ? ' is-open' : ''}`} id="sheet-items">
            <DungeonInventoryPanel
              inventory={shopQuery.data?.inventory ?? []}
              productById={productById}
              selectedItemId={selectedInvItemId}
              busy={applyItemMutation.isPending}
              onSelectItem={handleSelectItem}
            />
          </div>
          <div className={`sheet${activeSheet === 'log' ? ' is-open' : ''}`} id="sheet-log">
            <DungeonRunLog
              dungeonName={dungeon.name}
              stepCount={stepCount}
              defeatedCount={run.defeatedEncounters.length}
              totalEncounters={encounters.length}
              isComplete={isComplete}
              allEncountersDefeated={allEncountersDefeated}
              isCompleting={completeMutation.isPending}
              onComplete={() => completeMutation.mutate()}
              logs={logs}
            />
          </div>
          <div className={`sheet${activeSheet === 'quest' ? ' is-open' : ''}`} id="sheet-quest">
            <DungeonQuestPanel quest={quest} />
          </div>
        </div>
        <div className={`enc${activeEncounter || activeRandomEncounter ? '' : ' empty'}`}>
          <div className="idle">Walk the grid. Encounters surface here.</div>
          <DungeonEncounterCard
            activeEncounter={activeEncounter}
            activeRandomEncounter={activeRandomEncounter}
            templateById={templateById}
            isStartingRandom={startRandomEncounterMutation.isPending}
            isStartingEncounter={startEncounterMutation.isPending}
            onStartRandom={(mon) => {
              if (wildStartPendingRef.current) return;
              wildStartPendingRef.current = true;
              startRandomEncounterMutation.mutate(mon);
            }}
            onCancelRandom={() => setActiveRandomEncounter(null)}
            onStartEncounter={(encId) => startEncounterMutation.mutate(encId)}
          />
        </div>
      </aside>

      <DungeonActionBar
        canMove={!dialogueOpen && !activeEncounterId && !activeRandomEncounter && !moveMutation.isPending}
        onMove={tryMove}
        activeSheet={activeSheet}
        onToggleSheet={handleToggleSheet}
      />

      {activeSheet !== null && (
        <div className="sheet-backdrop" onClick={() => setActiveSheet(null)} />
      )}

      {exitConfirm !== null ? (
        <div className="sheet-backdrop" role="presentation">
          <div className="door-unlock-prompt" role="dialog" aria-modal="true" aria-live="polite">
            <div>
              <b>Leave dungeon?</b>
              <span>You have {groupInventory.length} dungeon-only item{groupInventory.length === 1 ? '' : 's'}. Leaving discards them.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const target = exitConfirm;
                setExitConfirm(null);
                movePendingRef.current = true;
                moveMutation.mutate({ x: target.x, y: target.y });
              }}
              disabled={moveMutation.isPending}
            >
              Leave anyway
            </button>
            <button type="button" onClick={() => setExitConfirm(null)}>
              Stay
            </button>
          </div>
        </div>
      ) : null}

      {toast !== null ? <div className="toast show" role="status" aria-live="polite">{toast}</div> : null}
    </>
  );
}
