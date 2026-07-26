import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  completeDungeon,
  defeatEncounter,
  getDungeon,
  moveInDungeon,
  startEncounter,
} from '../lib/api-dungeon';
import { getRoster } from '../lib/api';
import type { DungeonEncounter, DungeonItem, DungeonTile } from '@digiworld/shared';
import { useWsStore } from '../state/wsStore';

import '../styles/extensions-dungeon.css';

type LogEntry = {
  readonly text: string;
  readonly cls: '' | 'hit' | 'item';
  readonly step: number;
};

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
  const party = useMemo(() => {
    const list = (rosterQuery.data?.roster ?? []).filter((m) => m.status === 'party');
    return list.slice().sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  }, [rosterQuery.data]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
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
      pushLog(`Moved to ${x}, ${y}.`, '');
      queryClient.setQueryData(['dungeon', id], (old: any) => {
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
    },
    onError: (err: any) => {
      flashToast(err.message || 'Cannot move there.');
    },
  });

  const defeatMutation = useMutation({
    mutationFn: async (encId: string) => {
      if (!id) throw new Error('No dungeon id');
      return defeatEncounter(id, encId);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['dungeon', id], (old: any) => {
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
    if (activeEncounterId) {
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

  if (isLoading || !data) {
    return <div className="stage"><div style={{ padding: 20, color: 'var(--el)' }}>Loading...</div></div>;
  }

  const { dungeon, run, tiles, encounters, items } = data;
  const isComplete = !!run.completedAt;
  const allEncountersDefeated = encounters.every((e) => run.defeatedEncounters.includes(e.id));

  // Determine active encounter object
  const activeEncounter = activeEncounterId ? encounters.find((e) => e.id === activeEncounterId) : null;

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

      let cellClass = 'dcell';
      if (!isWalkable) cellClass += ' wall';
      else {
        cellClass += ' walk';
        if (isPlayer) cellClass += ' player';
        else if (isUndefeatedEncounter) cellClass += ' enc';
        else if (isUncollectedItem) cellClass += ' item';
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
        <div className={`enc${activeEncounter ? '' : ' empty'}`}>
          <div className="idle">Walk the grid. Encounters surface here.</div>
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
