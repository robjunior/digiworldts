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
import { getRoster } from '../lib/api';
import { getShop } from '../lib/api-shop';
import type { DungeonDoor, DungeonEncounter, DungeonItem, DungeonRunView, DungeonTile, EncounterDigimon } from '@digiworld/shared';
import { useWsStore } from '../state/wsStore';

import { DungeonGrid } from '../components/dungeon/DungeonGrid';
import { DungeonRunLog } from '../components/dungeon/DungeonRunLog';
import { DungeonEncounterCard } from '../components/dungeon/DungeonEncounterCard';
import { DungeonDoorPrompt } from '../components/dungeon/DungeonDoorPrompt';
import { DungeonStrip } from '../components/dungeon/DungeonStrip';
import type { LogEntry, PendingUnlock } from '../components/dungeon/types';
import '../styles/extensions-dungeon.css';

export function Dungeon(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
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
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  const [activeRandomEncounter, setActiveRandomEncounter] = useState<readonly EncounterDigimon[] | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(null);
  const [stepCount, setStepCount] = useState(0);

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
        pushLog(`Ambushed by enemies!`, 'hit');
        setActiveEncounterId(res.triggeredEncounterId);
      }
      if (res.randomEncounter) {
        pushLog(`Wild encounter!`, 'hit');
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

  const handleCellClick = (x: number, y: number) => {
    if (activeEncounterId || activeRandomEncounter) {
      flashToast('Resolve the encounter first.');
      return;
    }
    if (data?.run.completedAt) {
      flashToast('Dungeon already completed.');
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
      if (activeEncounterId || activeRandomEncounter) return;
      if (data.run.completedAt) return;
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
  }, [data, activeEncounterId, activeRandomEncounter, moveMutation]);

  if (isLoading || !data) {
    return <div className="stage"><div style={{ padding: 20, color: 'var(--el)' }}>Loading...</div></div>;
  }

  const { dungeon, run, tiles, encounters, items, doors } = data;
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
          {pendingDoor ? (
            <DungeonDoorPrompt
              pendingDoor={pendingDoor}
              keyName={keyName}
              canUnlock={canUnlock}
              isUnlocking={unlockMutation.isPending}
              onUnlock={(doorId) => unlockMutation.mutate(doorId)}
            />
          ) : null}
          <DungeonGrid
            dungeon={dungeon}
            run={run}
            tiles={tiles}
            encounters={encounters}
            items={items}
            doors={doors}
            party={party}
            onCellClick={handleCellClick}
          />
        </div>

        <div className="controls">
          <div className="dhint">
            {isComplete ? <b>Dungeon Complete!</b> : <b>Click an adjacent tile to move.</b>}
          </div>
        </div>
      </div>

      <aside className="rail" data-od-id="run-rail">
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
