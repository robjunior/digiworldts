import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  completeDungeon,
  defeatEncounter,
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

import '../styles/extensions-dungeon.css';

type LogEntry = {
  readonly text: string;
  readonly cls: '' | 'hit' | 'item';
  readonly step: number;
};

type PendingUnlock = { readonly doorId: string; readonly keyItemId: string };

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
      }
      if (res.triggeredEncounterId) {
        pushLog(`Ambushed by enemies!`, 'hit');
        setActiveEncounterId(res.triggeredEncounterId);
      }
      if (res.randomEncounter) {
        pushLog(`Wild encounter!`, 'hit');
        setActiveRandomEncounter(res.randomEncounter);
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

  const defeatMutation = useMutation({
    mutationFn: async (encId: string) => {
      if (!id) throw new Error('No dungeon id');
      return defeatEncounter(id, encId);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['dungeon', id], (old: DungeonRunView | undefined) => {
        if (!old) return old;
        return { ...old, run: res.run };
      });
      setActiveEncounterId(null);
      pushLog(`Encounter defeated!`, 'hit');
      flashToast('Enemies defeated.');
    },
  });

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
  const activeEncounter = activeEncounterId ? encounters.find((e) => e.id === activeEncounterId) : null;
  const pendingDoor = pendingUnlock ? doors.find((door) => door.id === pendingUnlock.doorId) ?? null : null;
  const pendingKeyItemId = pendingDoor?.keyItemId ?? pendingUnlock?.keyItemId ?? '';
  const keyInventory = shopQuery.data?.inventory.find((entry) => entry.itemId === pendingKeyItemId) ?? null;
  const keyItem = shopQuery.data?.products.find((entry) => entry.id === pendingKeyItemId) ?? null;
  const keyName = keyInventory?.name ?? keyItem?.name ?? pendingKeyItemId;
  const canUnlock = (keyInventory?.qty ?? 0) >= 1;

  // Build grid map
  const gridCells = [];
  const tilesSet = new Set(tiles.map((t) => `${t.x},${t.y}`));

  for (let y = 0; y < dungeon.height; y++) {
    for (let x = 0; x < dungeon.width; x++) {
      const isWalkable = tilesSet.has(`${x},${y}`);
      const isPlayer = run.currentX === x && run.currentY === y;
      const isAdjacent = !isPlayer && isWalkable && (Math.abs(x - run.currentX) + Math.abs(y - run.currentY) === 1);
      
      const encounterAt = encounters.find((e) => e.x === x && e.y === y);
      const isUndefeatedEncounter = encounterAt && !run.defeatedEncounters.includes(encounterAt.id);
      
      const itemAt = items.find((i) => i.x === x && i.y === y);
      const isUncollectedItem = itemAt && !run.collectedItems.includes(itemAt.id);
      const doorAt = doors.find((door) => door.x === x && door.y === y);
      const isLockedDoor = doorAt ? !run.unlockedDoors.includes(doorAt.id) : false;

      let cellClass = 'dcell';
      if (!isWalkable) cellClass += ' wall';
      else {
        cellClass += ' walk';
        if (isPlayer) cellClass += ' player';
        else if (isUndefeatedEncounter) cellClass += ' enc';
        else if (isUncollectedItem) cellClass += ' item';
        if (doorAt) cellClass += ` is-door ${isLockedDoor ? 'is-locked' : 'is-unlocked'}`;
        if (isAdjacent) cellClass += ' adj';
      }

      gridCells.push(
        <div
          key={`${x},${y}`}
          className={cellClass}
          onClick={() => {
            if (isWalkable && !isPlayer) handleCellClick(x, y);
          }}
        >
          {isPlayer && party.length > 0 && (
            <div className="party-marker" aria-label="Your party">
              {party.map((mon) => (
                <img
                  key={mon.id}
                  className="party-sprite"
                  src={`/assets/digimon/${mon.catalogId}/dot.gif`}
                  alt={mon.nickname || mon.template?.name || 'party member'}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
              ))}
            </div>
          )}
          {doorAt && !isPlayer ? <span className="door-marker">D</span> : null}
        </div>
      );
    }
  }

  return (
    <>
      <div className="stage" data-od-id="dungeon-stage" style={{ '--el': 'var(--el-light)' } as CSSProperties}>
        <div className="dstrip">
          <span className="dk">{dungeon.name}</span>
          <span className="dv">Tile<b>{run.currentX}, {run.currentY}</b></span>
        </div>
        <Link to="/world" className="leave" aria-label="Leave dungeon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 5l-7 7 7 7M20 12H7" />
          </svg>
          Leave
        </Link>

        <div className="view">
          {pendingDoor ? (
            <div className="door-unlock-prompt" role="status" aria-live="polite">
              <div><b>{pendingDoor.label ?? 'Locked door'}</b><span>Requires: {keyName}</span></div>
              <button type="button" onClick={() => unlockMutation.mutate(pendingDoor.id)} disabled={!canUnlock || unlockMutation.isPending}>{unlockMutation.isPending ? 'Unlocking...' : 'Unlock'}</button>
              {!canUnlock ? <span className="door-unlock-missing">You need a {keyName}.</span> : null}
            </div>
          ) : null}
          <div className="dgrid" style={{ 
            '--dw': dungeon.width,
            '--dh': dungeon.height,
            gridTemplateColumns: `repeat(${dungeon.width}, 1fr)`,
            gridTemplateRows: `repeat(${dungeon.height}, 1fr)`,
          } as CSSProperties}>
            {gridCells}
          </div>
        </div>

        <div className="controls">
          <div className="dhint">
            {isComplete ? <b>Dungeon Complete!</b> : <b>Click an adjacent tile to move.</b>}
          </div>
        </div>
      </div>

      <aside className="rail" data-od-id="run-rail">
        <div className="rhead">
          <div className="rt">Run Log</div>
          <div className="rs"><b>{dungeon.name}</b> · Steps {stepCount} · Encounters {run.defeatedEncounters.length}/{encounters.length}</div>
          {!isComplete && allEncountersDefeated && (
            <button
              className="ebtn"
              style={{ marginTop: 10 }}
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
            >
              Complete Dungeon
            </button>
          )}
        </div>
        <div className="log" role="log" aria-live="polite">
          {logs.map((row, i) => (
            <div key={i} className={`lrow${row.cls ? ` ${row.cls}` : ''}`}>
              <span className="lt">{String(row.step).padStart(2, '0')}</span>
              <span className="lx">{row.text}</span>
            </div>
          ))}
        </div>
        <div className={`enc${activeEncounter || activeRandomEncounter ? '' : ' empty'}`}>
          <div className="idle">Walk the grid. Encounters surface here.</div>
          {activeRandomEncounter ? (
            <div className="ecard wild-card">
              <div className="ek">wild · Random Encounter</div>
              <h3>Wild encounter!</h3>
              <div className="emons">
                {activeRandomEncounter.map((mon, index) => (
                  <div key={`${mon.catalogId}-${index}`} className="emon">
                    <span className="esprite" aria-hidden="true">{mon.catalogId.charAt(0).toUpperCase()}</span>
                    <span className="enm">{mon.nickname || mon.catalogId}<span className="elv">Lv {mon.level}</span></span>
                  </div>
                ))}
              </div>
              <button type="button" className="ebtn" onClick={() => startRandomEncounterMutation.mutate(activeRandomEncounter)} disabled={startRandomEncounterMutation.isPending}>
                {startRandomEncounterMutation.isPending ? 'Entering...' : 'Start Battle'}
              </button>
              <button type="button" className="ebtn secondary" onClick={() => setActiveRandomEncounter(null)} disabled={startRandomEncounterMutation.isPending}>Back away</button>
            </div>
          ) : null}
          {activeEncounter ? (
            <div className="ecard">
              <div className="ek">{activeEncounter.difficulty} · Encounter</div>
              <h3>{activeEncounter.label || 'Wild Digimon'}</h3>
              <div className="emons">
                {activeEncounter.digimon.map((m, i) => (
                  <div key={i} className="emon">
                    <span className="esprite" aria-hidden="true">{m.catalogId.charAt(0).toUpperCase()}</span>
                    <span className="enm">{m.nickname || m.catalogId}<span className="elv">Lv {m.level}</span></span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="ebtn"
                onClick={() => startEncounterMutation.mutate(activeEncounter.id)}
                disabled={startEncounterMutation.isPending}
              >
                {startEncounterMutation.isPending ? 'Entering...' : 'Enter Battle'}
              </button>
              {import.meta.env.DEV ? (
                <button
                  type="button"
                  className="ebtn"
                  style={{ marginTop: 8, opacity: 0.7 }}
                  onClick={() => defeatMutation.mutate(activeEncounter.id)}
                  disabled={defeatMutation.isPending}
                >
                  {defeatMutation.isPending ? 'Advancing...' : 'Debug: mark defeated'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>

      {toast !== null ? <div className="toast show" role="status" aria-live="polite">{toast}</div> : null}
    </>
  );
}
