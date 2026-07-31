import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  completeDungeon,
  getDungeon,
  moveInDungeon,
  startEncounter,
  startRandomEncounter,
  unlockDungeonDoor,
} from '../lib/api-dungeon';
import { ApiError, getRoster } from '../lib/api';
import { getDialogue } from '../lib/api-dialogues';
import { getQuests } from '../lib/api-quests';
import { applyShopItem, getShop } from '../lib/api-shop';
import type { DungeonDoor, DungeonEncounter, DungeonItem, DungeonRunView, DungeonTile, EncounterDigimon } from '@digiworld/shared';
import { useWsStore } from '../state/wsStore';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../hooks/useLocale';

import { DungeonGrid } from '../components/dungeon/DungeonGrid';
import { DungeonInventoryPanel } from '../components/dungeon/DungeonInventoryPanel';
import { DungeonPartyBar } from '../components/dungeon/DungeonPartyBar';
import { DungeonRunLog } from '../components/dungeon/DungeonRunLog';
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
  const party = useMemo(() => {
    const list = (rosterQuery.data?.roster ?? []).filter((m) => m.status === 'party');
    return list.slice().sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  }, [rosterQuery.data]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  const [activeRandomEncounter, setActiveRandomEncounter] = useState<readonly EncounterDigimon[] | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(null);
  const [stepCount, setStepCount] = useState(0);
  const [selectedInvItemId, setSelectedInvItemId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [partyTrail, setPartyTrail] = useState<readonly { readonly x: number; readonly y: number }[]>([]);

  useEffect(() => {
    setPartyTrail([]);
  }, [id]);

  useEffect(() => {
    const x = data?.run.currentX;
    const y = data?.run.currentY;
    if (x === undefined || y === undefined) return;
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
    scroller.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' });
  }, [data?.run.currentX, data?.run.currentY]);

  const productById = useMemo(() => {
    const m = new Map<string, import('../lib/api-shop').ShopItemView>();
    for (const p of shopQuery.data?.products ?? []) m.set(p.id, p);
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
      setStepCount((s) => s + 1);
      if (res.blockedByDoorId) {
        const door = data?.doors.find((entry) => entry.id === res.blockedByDoorId);
        setPendingUnlock({ doorId: res.blockedByDoorId, keyItemId: door?.keyItemId ?? '' });
        pushLog(`Locked door at ${x}, ${y}.`, 'hit');
        return;
      }
      setPendingUnlock(null);
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
        const mons = res.randomEncounter.map((m) => `${m.nickname ?? m.catalogId} Lv ${m.level}`).join(', ');
        pushLog(`Wild encounter: ${mons}.`, 'hit');
        if (!startRandomEncounterMutation.isPending) {
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
      navigate('/combat');
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
      navigate('/combat');
    },
    onError: (err: Error) => {
      flashToast(err.message || 'Could not start wild battle.');
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

  const activeDialogue = dialogueDismissed ? null : dialogueQuery.data?.dialogue.definition ?? null;
  const dialogueOpen = activeDialogue !== null;

  const handleCellClick = (x: number, y: number) => {
    if (dialogueOpen) return;
    if (activeEncounterId || activeRandomEncounter) {
      flashToast('Resolve the encounter first.');
      return;
    }
    // Check adjacency
    const cx = data?.run.currentX ?? 0;
    const cy = data?.run.currentY ?? 0;
    const dist = Math.abs(cx - x) + Math.abs(cy - y);
    if (dist !== 1) {
      flashToast('Can only move to adjacent tiles.');
      return;
    }
    moveMutation.mutate({ x, y });
  };

  useEffect(() => {
    if (!data) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (dialogueOpen) return;
      if (activeEncounterId || activeRandomEncounter) return;
      if (moveMutation.isPending) return;

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

      const nx = data.run.currentX + dx;
      const ny = data.run.currentY + dy;
      const tileKey = `${nx},${ny}`;
      const walkable = data.tiles.some((t) => `${t.x},${t.y}` === tileKey);
      if (!walkable) return;

      moveMutation.mutate({ x: nx, y: ny });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, activeEncounterId, activeRandomEncounter, moveMutation, dialogueOpen]);

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

  const { dungeon, run, tiles, tilesets, encounters, items, doors } = data;
  const isComplete = !!run.completedAt;
  const allEncountersDefeated = encounters.every((e) => run.defeatedEncounters.includes(e.id));

  // Determine active encounter object
  const activeEncounter = activeEncounterId ? (encounters.find((e) => e.id === activeEncounterId) ?? null) : null;
  const pendingDoor = pendingUnlock ? doors.find((door) => door.id === pendingUnlock.doorId) ?? null : null;
  const pendingKeyItemId = pendingDoor?.keyItemId ?? pendingUnlock?.keyItemId ?? '';
  const keyInventory = shopQuery.data?.inventory.find((entry) => entry.itemId === pendingKeyItemId) ?? null;
  const keyItem = shopQuery.data?.products.find((entry) => entry.id === pendingKeyItemId) ?? null;
  const keyName = keyInventory?.name ?? keyItem?.name ?? pendingKeyItemId;
  const canUnlock = (keyInventory?.qty ?? 0) >= 1;

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
        <DungeonInventoryPanel
          inventory={shopQuery.data?.inventory ?? []}
          productById={productById}
          selectedItemId={selectedInvItemId}
          busy={applyItemMutation.isPending}
          onSelectItem={handleSelectItem}
        />
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
        <div className={`enc${activeEncounter || activeRandomEncounter ? '' : ' empty'}`}>
          <div className="idle">Walk the grid. Encounters surface here.</div>
          <DungeonEncounterCard
            activeEncounter={activeEncounter}
            activeRandomEncounter={activeRandomEncounter}
            isStartingRandom={startRandomEncounterMutation.isPending}
            isStartingEncounter={startEncounterMutation.isPending}
            onStartRandom={(mon) => startRandomEncounterMutation.mutate(mon)}
            onCancelRandom={() => setActiveRandomEncounter(null)}
            onStartEncounter={(encId) => startEncounterMutation.mutate(encId)}
          />
        </div>
      </aside>

      {toast !== null ? <div className="toast show" role="status" aria-live="polite">{toast}</div> : null}
    </>
  );
}
