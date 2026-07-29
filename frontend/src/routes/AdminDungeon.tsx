import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';

import type { DungeonDoor, DungeonEncounter, DungeonItem, DungeonTrap, DungeonView, DungeonWarp } from '@digiworld/shared';
import { TRAP_KINDS } from '@digiworld/shared';

import { AdminGuard } from '../components/admin/AdminGuard';
import { ToolContext } from '../components/admin/dungeon/ToolContext';
import { ADMIN_DUNGEON_QUERY } from '../components/admin/dungeon/query-keys';
import type { Cell, PathTool, Tool } from '../components/admin/dungeon/types';
import { PATH_TOOLS, TOOLS } from '../components/admin/dungeon/types';
import {
  bresenhamLine,
  cellKey,
  pathIcon,
  rectangleFill,
  tileKey,
  tilesFromSet,
  titleCase,
} from '../components/admin/dungeon/utils';
import { getCatalog, getShopItems } from '../lib/api-admin';
import {
  getAdminDungeon,
  listAdminDungeons,
  putAdminDungeonTiles,
  updateAdminDungeon,
  createAdminTrap,
  deleteAdminTrap,
} from '../lib/api-dungeon-admin';
import '../styles/extensions-admin.css';

export function AdminDungeon(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tool, setTool] = useState<Tool>('PATH');
  const [pathTool, setPathTool] = useState<PathTool>('PAINT');
  const [eraseMode, setEraseMode] = useState<boolean>(false);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [pendingStart, setPendingStart] = useState<Cell | null>(null);
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paintTarget, setPaintTarget] = useState<boolean | null>(null);
  const tileSetRef = useRef<Set<string>>(new Set());

  const dungeonId = id ?? '';
  const dungeonQuery = useQuery({
    queryKey: ADMIN_DUNGEON_QUERY(dungeonId),
    queryFn: () => getAdminDungeon(dungeonId),
    enabled: dungeonId.length > 0,
  });
  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: getCatalog });
  const dungeonsQuery = useQuery({ queryKey: ['admin', 'dungeons'], queryFn: listAdminDungeons });
  const shopItemsQuery = useQuery({ queryKey: ['admin', 'shop-items'], queryFn: getShopItems });

  const tilesMutation = useMutation({
    mutationFn: (tiles: readonly Cell[]) => putAdminDungeonTiles(dungeonId, tiles),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const spawnMutation = useMutation({
    mutationFn: (cell: Cell) => updateAdminDungeon(dungeonId, { spawnX: cell.x, spawnY: cell.y }),
    onSuccess: ({ dungeon }) => {
      queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) =>
        old ? { ...old, dungeon } : old,
      );
    },
  });

  useEffect(() => {
    if (dungeonQuery.data) tileSetRef.current = new Set(dungeonQuery.data.tiles.map(tileKey));
  }, [dungeonQuery.data]);

  useEffect(() => {
    const finishPaint = (): void => {
      if (paintTarget !== null) {
        tilesMutation.mutate(tilesFromSet(tileSetRef.current));
        setPaintTarget(null);
      }
    };
    window.addEventListener('mouseup', finishPaint);
    return () => window.removeEventListener('mouseup', finishPaint);
  }, [paintTarget, tilesMutation]);

  useEffect(() => {
    const cancelPending = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPendingStart(null);
    };
    window.addEventListener('keydown', cancelPending);
    return () => window.removeEventListener('keydown', cancelPending);
  }, []);

  const [viewport, setViewport] = useState<{ readonly vw: number; readonly vh: number }>(() => ({
    vw: typeof window === 'undefined' ? 1440 : window.innerWidth,
    vh: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = (): void => setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const data = dungeonQuery.data;
  const tileSet = useMemo(() => new Set(data?.tiles.map(tileKey) ?? []), [data?.tiles]);
  const previewSet = useMemo(() => {
    if (!pendingStart || !hoverCell || tool !== 'PATH') return new Set<string>();
    if (pathTool === 'LINE') return new Set(bresenhamLine(pendingStart, hoverCell).map(cellKey));
    if (pathTool === 'RECTANGLE') return new Set(rectangleFill(pendingStart, hoverCell).map(cellKey));
    return new Set<string>();
  }, [hoverCell, pathTool, pendingStart, tool]);

  if (!id) return <div>Missing dungeon id.</div>;
  if (dungeonQuery.isLoading || !data) return <div>Loading...</div>;

  const { dungeon, encounters, items, warps, doors, traps } = data;
  const encounterAt = (cell: Cell): DungeonEncounter | undefined =>
    encounters.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const itemAt = (cell: Cell): DungeonItem | undefined =>
    items.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const warpAt = (cell: Cell): DungeonWarp | undefined =>
    warps.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const doorAt = (cell: Cell): DungeonDoor | undefined =>
    doors.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const trapAt = (cell: Cell): DungeonTrap | undefined =>
    traps.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const isWalkable = (cell: Cell): boolean => tileSet.has(cellKey(cell));

  function showToast(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(null), 1600);
  }

  function optimisticTiles(nextSet: Set<string>): void {
    const nextTiles = tilesFromSet(nextSet);
    tileSetRef.current = nextSet;
    queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) =>
      old ? { ...old, tiles: nextTiles } : old,
    );
  }

  function setCellWalkable(cell: Cell, walkable: boolean): void {
    const next = new Set(tileSetRef.current);
    if (walkable) next.add(cellKey(cell));
    else next.delete(cellKey(cell));
    optimisticTiles(next);
  }

  function commitCells(cells: readonly Cell[], walkable: boolean): void {
    const next = new Set(tileSetRef.current);
    for (const cell of cells) {
      if (walkable) next.add(cellKey(cell));
      else next.delete(cellKey(cell));
    }
    optimisticTiles(next);
    tilesMutation.mutate(tilesFromSet(next));
  }

  function handlePathMouseDown(cell: Cell, event: ReactMouseEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    if (pathTool === 'PAINT') {
      const nextTarget = eraseMode ? false : !tileSetRef.current.has(cellKey(cell));
      setPaintTarget(nextTarget);
      setCellWalkable(cell, nextTarget);
    }
  }

  function handleCellClick(cell: Cell): void {
    setSelectedCell(cell);
    if (tool === 'PATH') {
      if (pathTool === 'LINE' || pathTool === 'RECTANGLE') {
        if (!pendingStart) {
          setPendingStart(cell);
          setHoverCell(cell);
          return;
        }
        commitCells(pathTool === 'LINE' ? bresenhamLine(pendingStart, cell) : rectangleFill(pendingStart, cell), !eraseMode);
        setPendingStart(null);
      }
      return;
    }
    if (
      (tool === 'SPAWN' || tool === 'ENCOUNTERS' || tool === 'ITEMS' || tool === 'WARPS' || tool === 'DOORS') &&
      !isWalkable(cell)
    ) {
      showToast('Pick a walkable tile first.');
      return;
    }
    if (tool === 'SPAWN') spawnMutation.mutate(cell);
  }

  function handleHover(cell: Cell): void {
    setHoverCell(cell);
    if (pathTool === 'PAINT' && paintTarget !== null) setCellWalkable(cell, paintTarget);
  }

  function cancelContext(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    setPendingStart(null);
  }

  const CELL_MIN = 36;
  const CELL_MAX = 96;
  const availW = Math.max(320, viewport.vw - 210 - 48);
  const availH = Math.max(320, viewport.vh - 38 - 48);
  const cellSize = Math.max(
    CELL_MIN,
    Math.min(CELL_MAX, Math.floor(Math.min(availW / dungeon.width, availH / dungeon.height))),
  );
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${dungeon.width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${dungeon.height}, ${cellSize}px)`,
  };
  const activeLabel = tool === 'PATH' ? `PATH — ${eraseMode ? 'Erase ' : ''}${titleCase(pathTool)}` : tool;

  return (
    <AdminGuard>
      <>
        <div className="admin-dungeon-grid-full" style={gridStyle}>
          {Array.from({ length: dungeon.height }, (_, y) =>
            Array.from({ length: dungeon.width }, (__, x) => {
              const cell = { x, y };
              const key = cellKey(cell);
              const walkable = tileSet.has(key);
              const selected = selectedCell?.x === x && selectedCell.y === y;
              const spawn = dungeon.spawnX === x && dungeon.spawnY === y;
              const enc = encounterAt(cell);
              const item = itemAt(cell);
              const warp = warpAt(cell);
              const door = doorAt(cell);
              const trap = trapAt(cell);
              const preview = previewSet.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`dungeon-cell tool-${tool.toLowerCase()}${walkable ? ' is-walkable' : ''}${
                    selected ? ' is-selected' : ''
                  }${preview ? ' is-preview' : ''}`}
                  onMouseDown={(event) => handlePathMouseDown(cell, event)}
                  onMouseEnter={() => handleHover(cell)}
                  onContextMenu={cancelContext}
                  onClick={() => handleCellClick(cell)}
                  aria-label={`Cell ${x},${y}`}
                >
                  <span className="mk-stack">
                    {spawn ? <span className="mk mk-spawn">S</span> : null}
                    {enc ? <span className="mk mk-encounter">E</span> : null}
                    {item ? <span className="mk mk-item">I</span> : null}
                    {warp ? <span className="mk mk-warp">W</span> : null}
                    {door ? <span className="mk mk-door">D</span> : null}
                    {trap ? <span className="mk mk-trap" title={`${trap.kind} sev ${trap.severity}`}>T</span> : null}
                  </span>
                </button>
              );
            }),
          )}
        </div>

        <aside className="admin-dungeon-floating-panel" aria-label="Dungeon editor tools">
          <div className="admin-dungeon-panel-head">
            <div>
              <h2>{dungeon.name}</h2>
              <span>
                {dungeon.width} × {dungeon.height} · {activeLabel}
              </span>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={() => navigate('/admin?tab=dungeons')}
              aria-label="Close dungeon editor"
            >
              ×
            </button>
          </div>
          <div className="layer-picker tool-picker" aria-label="Dungeon tools">
            {TOOLS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={tool === entry ? 'is-active' : ''}
                onClick={() => {
                  setTool(entry);
                  setPendingStart(null);
                }}
              >
                {entry}
              </button>
            ))}
          </div>
          {tool === 'PATH' ? (
            <div className="subtool-picker" aria-label="Path drawing tools">
              {PATH_TOOLS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={pathTool === entry ? 'is-active' : ''}
                  onClick={() => {
                    setPathTool(entry);
                    setPendingStart(null);
                  }}
                >
                  {pathIcon(entry)} {entry}
                </button>
              ))}
              <button
                type="button"
                className={`erase-toggle${eraseMode ? ' is-active' : ''}`}
                onClick={() => setEraseMode(!eraseMode)}
                aria-pressed={eraseMode}
                title="Toggle erase mode (removes cells instead of adding)"
              >
                ⌫ ERASE
              </button>
            </div>
          ) : null}
          <ToolContext
            dungeonId={dungeonId}
            tool={tool}
            dungeon={dungeon}
            pathTool={pathTool}
            selectedCell={selectedCell}
            pendingStart={pendingStart}
            isWalkable={selectedCell ? isWalkable(selectedCell) : false}
            catalog={catalogQuery.data?.digimons ?? []}
            dungeons={dungeonsQuery.data?.dungeons ?? []}
            shopItems={shopItemsQuery.data?.items ?? []}
            {...(selectedCell && encounterAt(selectedCell) ? { encounter: encounterAt(selectedCell) } : {})}
            {...(selectedCell && itemAt(selectedCell) ? { item: itemAt(selectedCell) } : {})}
            {...(selectedCell && warpAt(selectedCell) ? { warp: warpAt(selectedCell) } : {})}
            {...(selectedCell && doorAt(selectedCell) ? { door: doorAt(selectedCell) } : {})}
          />
        </aside>
        {toast ? (
          <div className="toast show" role="status">
            {toast}
          </div>
        ) : null}
      </>
    </AdminGuard>
  );
}
