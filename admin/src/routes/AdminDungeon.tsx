import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';

import { LAYER_KINDS } from '@digiworld/shared';
import type { DungeonBridge, DungeonChest, DungeonDoor, DungeonEncounter, DungeonItem, DungeonTile, DungeonTrap, DungeonTrigger, DungeonView, DungeonWarp, DungeonZone, LayerKind } from '@digiworld/shared';

import { AdminGuard } from '../components/admin/AdminGuard';
import { ToolContext } from '../components/admin/dungeon/ToolContext';
import { GridPositionEditor } from '../components/admin/dungeon/GridPositionEditor';
import { TiledImportButton } from '../components/admin/dungeon/TiledImportButton';
import { ADMIN_DUNGEON_QUERY } from '../components/admin/dungeon/query-keys';
import type { Cell, PathTool, Tool } from '../components/admin/dungeon/types';
import { PATH_TOOLS, TOOLS } from '../components/admin/dungeon/types';
import {
  bresenhamLine,
  cellKey,
  pathIcon,
  rectangleFill,
  tileGidMap,
  tileKey,
  tilesFromMap,
  titleCase,
} from '../components/admin/dungeon/utils';
import { getCatalog, getShopItems } from '../lib/api-admin';
import { gidCellStyle, primaryTileset } from '../lib/tileset-sprite';
import {
  getAdminDungeon,
  listAdminDungeons,
  putAdminDungeonTiles,
  updateAdminDungeon,
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
  const [showImport, setShowImport] = useState<boolean>(false);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKind, boolean>>(() =>
    Object.fromEntries(LAYER_KINDS.map((kind) => [kind, true])) as Record<LayerKind, boolean>
  );
  const [showZones, setShowZones] = useState<boolean>(true);
  const tileSetRef = useRef<Map<string, number>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);

  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.25;
  const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));

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
    mutationFn: (tiles: readonly DungeonTile[]) => putAdminDungeonTiles(dungeonId, tiles),
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
    if (dungeonQuery.data) tileSetRef.current = tileGidMap(dungeonQuery.data.tiles);
  }, [dungeonQuery.data]);

  useEffect(() => {
    const finishPaint = (): void => {
      if (paintTarget !== null) {
        tilesMutation.mutate(tilesFromMap(tileSetRef.current));
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

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => clampZoom(z + delta));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((z) => clampZoom(z + ZOOM_STEP)); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom((z) => clampZoom(z - ZOOM_STEP)); }
      else if (event.key === '0') { event.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const tileGidByCoord = useMemo(() => new Map<string, number>((data?.tiles ?? []).map((t) => [`${t.x},${t.y}`, t.gid])), [data?.tiles]);
  const tilesByCoord = useMemo(() => {
    const map = new Map<string, DungeonTile[]>();
    for (const tile of data?.tiles ?? []) {
      const key = `${tile.x},${tile.y}`;
      const list = map.get(key) ?? [];
      list.push(tile);
      map.set(key, list);
    }
    return map;
  }, [data?.tiles]);
  const tilesets = data?.tilesets ?? [];
  const previewSet = useMemo(() => {
    if (!pendingStart || !hoverCell || tool !== 'PATH') return new Set<string>();
    if (pathTool === 'LINE') return new Set(bresenhamLine(pendingStart, hoverCell).map(cellKey));
    if (pathTool === 'RECTANGLE') return new Set(rectangleFill(pendingStart, hoverCell).map(cellKey));
    return new Set<string>();
  }, [hoverCell, pathTool, pendingStart, tool]);

  if (!id) return <div>Missing dungeon id.</div>;
  if (dungeonQuery.isLoading || !data) return <div>Loading...</div>;

  const { dungeon, encounters, items, warps, doors, traps, chests, zones, triggers, bridges } = data;
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
  const chestAt = (cell: Cell): DungeonChest | undefined =>
    chests.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const triggerAt = (cell: Cell): DungeonTrigger | undefined =>
    triggers.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const bridgeAt = (cell: Cell): DungeonBridge | undefined =>
    bridges.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const isWalkable = (cell: Cell): boolean => tileSet.has(cellKey(cell));

  function showToast(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(null), 1600);
  }

  function optimisticTiles(nextMap: Map<string, number>): void {
    const nextTiles = tilesFromMap(nextMap);
    tileSetRef.current = nextMap;
    queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) =>
      old ? { ...old, tiles: nextTiles } : old,
    );
  }

  function setCellWalkable(cell: Cell, walkable: boolean): void {
    const next = new Map(tileSetRef.current);
    const key = cellKey(cell);
    if (walkable) next.set(key, next.get(key) ?? 1);
    else next.delete(key);
    optimisticTiles(next);
  }

  function commitCells(cells: readonly Cell[], walkable: boolean): void {
    const next = new Map(tileSetRef.current);
    for (const cell of cells) {
      const key = cellKey(cell);
      if (walkable) next.set(key, next.get(key) ?? 1);
      else next.delete(key);
    }
    optimisticTiles(next);
    tilesMutation.mutate(tilesFromMap(next));
  }

  function handlePathMouseDown(cell: Cell, event: ReactMouseEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || tool !== 'PATH') return;
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
      (tool === 'SPAWN' || tool === 'ENCOUNTERS' || tool === 'ITEMS' || tool === 'WARPS' || tool === 'DOORS' || tool === 'TRAPS' || tool === 'CHESTS' || tool === 'TRIGGERS' || tool === 'BRIDGES') &&
      !isWalkable(cell)
    ) {
      showToast('Pick a walkable tile first.');
      return;
    }
    if (tool === 'SPAWN') spawnMutation.mutate(cell);
  }

  function handleHover(cell: Cell): void {
    setHoverCell(cell);
    if (tool === 'PATH' && pathTool === 'PAINT' && paintTarget !== null) setCellWalkable(cell, paintTarget);
  }

  function cancelContext(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    setPendingStart(null);
  }

  const CELL_MIN = 12;
  const CELL_MAX = 256;
  const availW = Math.max(320, viewport.vw - 210 - 48);
  const availH = Math.max(320, viewport.vh - 38 - 48);
  const fitSize = Math.floor(Math.min(availW / dungeon.width, availH / dungeon.height));
  const cellSize = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(fitSize * zoom)));
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${dungeon.width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${dungeon.height}, ${cellSize}px)`,
  };
  const canonicalTileset = primaryTileset(tilesets);
  const spriteScale = canonicalTileset ? cellSize / canonicalTileset.tileWidth : 1;
  const activeLabel = tool === 'PATH' ? `PATH — ${eraseMode ? 'Erase ' : ''}${titleCase(pathTool)}` : tool;

  return (
    <AdminGuard>
      <>
        <div ref={gridRef} className="admin-dungeon-grid-full" style={gridStyle}>
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
              const chest = chestAt(cell);
              const trigger = triggerAt(cell);
              const bridge = bridgeAt(cell);
              const preview = previewSet.has(key);
              const cellTiles = (tilesByCoord.get(key) ?? []).filter((tile) => visibleLayers[tile.layerKind]);
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
                  {cellTiles.map((tile, tileIndex) => {
                    const style = gidCellStyle(tile.gid, tilesets, cellSize);
                    return style ? (
                      <span
                        key={`${tile.layerKind}-${tileIndex}`}
                        className="tile-bg"
                        style={style}
                        aria-hidden="true"
                      />
                    ) : null;
                  })}
                  {bridge ? (() => {
                    const gid = bridge.downTileGid ?? bridge.upTileGid;
                    const style = gid !== null ? gidCellStyle(gid, tilesets, cellSize) : null;
                    return style ? <span className="tile-bg poi-sprite" style={style} aria-hidden="true" /> : null;
                  })() : null}
                  {trigger ? (() => {
                    const style = trigger.unusedTileGid !== null ? gidCellStyle(trigger.unusedTileGid, tilesets, cellSize) : null;
                    return style ? <span className="tile-bg poi-sprite" style={style} aria-hidden="true" /> : null;
                  })() : null}
                  <span className="mk-stack">
                    {spawn ? <span className="mk mk-spawn">S</span> : null}
                    {enc ? <span className="mk mk-encounter">E</span> : null}
                    {item ? <span className="mk mk-item">I</span> : null}
                    {warp ? <span className="mk mk-warp">W</span> : null}
                    {door ? <span className="mk mk-door">D</span> : null}
                    {chest ? <span className="mk mk-item" title={chest.label ?? 'Chest'}>C</span> : null}
                    {trap ? <span className="mk mk-trap" title={`${trap.kind} sev ${trap.severity}`}>T</span> : null}
                    {bridge ? <span className="mk mk-bridge" title={bridge.label ?? 'Bridge'}>B</span> : null}
                    {trigger ? <span className="mk mk-trigger" title={trigger.label ?? 'Trigger'}>L</span> : null}
                  </span>
                </button>
              );
            }),
          )}
          {showZones ? (
            <div
              className="admin-dungeon-zone-overlay"
              aria-label="Zone overlay"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: dungeon.width * cellSize,
                height: dungeon.height * cellSize,
                pointerEvents: 'none',
              }}
            >
              {zones.map((zone: DungeonZone, index: number) => (
                <div
                  key={`${zone.name ?? 'zone'}-${index}`}
                  className={`admin-dungeon-zone ${zone.safe ? 'is-safe' : 'is-unsafe'}`}
                  style={{
                    position: 'absolute',
                    left: zone.x * cellSize,
                    top: zone.y * cellSize,
                    width: zone.width * cellSize,
                    height: zone.height * cellSize,
                  }}
                  title={`${zone.name ?? `Zone ${index + 1}`}${zone.safe ? ' (safe)' : ''}`}
                >
                  <span className="admin-dungeon-zone-label">{zone.name ?? `Zone ${index + 1}`}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className={`admin-dungeon-floating-panel${panelCollapsed ? ' is-collapsed' : ''}`} aria-label="Dungeon editor tools">
          <div className="admin-dungeon-panel-head">
            <div>
              <h2>{dungeon.name}</h2>
              <span>
                {dungeon.width} × {dungeon.height} · {activeLabel}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className="admin-dungeon-panel-toggle"
                onClick={() => setPanelCollapsed((v) => !v)}
                aria-label={panelCollapsed ? 'Expand tool panel' : 'Collapse tool panel'}
                aria-expanded={!panelCollapsed}
                title={panelCollapsed ? 'Expand tool panel' : 'Collapse tool panel'}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setShowImport((v) => !v)}
                title="Replace this dungeon's tiles and POIs from a Tiled JSON export"
              >
                {showImport ? 'Cancel import' : 'Re-import Tiled'}
              </button>
              <button
                type="button"
                className="modal-close"
                onClick={() => navigate('/admin?tab=dungeons')}
                aria-label="Close dungeon editor"
              >
                ×
              </button>
            </div>
          </div>
          {showImport ? (
            <TiledImportButton
              mode="replace"
              dungeonId={dungeonId}
              onImported={() => {
                void queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) });
                setShowImport(false);
              }}
            />
          ) : null}
          <div className="admin-dungeon-zoombar" aria-label="Zoom controls">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              disabled={zoom <= ZOOM_MIN}
              title="Zoom out (−, Ctrl+wheel down)"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="admin-dungeon-zoom-readout" title="Cell size (px) at current zoom">
              {Math.round(zoom * 100)}% · {cellSize}px
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              disabled={zoom >= ZOOM_MAX}
              title="Zoom in (+, Ctrl+wheel up)"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
              title="Reset zoom to fit (0)"
              aria-label="Reset zoom"
            >
              Fit
            </button>
          </div>
          <GridPositionEditor dungeon={dungeon} />
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
          <div className="admin-dungeon-layer-toggles" aria-label="Layer visibility">
            {LAYER_KINDS.map((kind) => (
              <label key={kind} className="layer-toggle" title={`Toggle ${titleCase(kind)} layer`}>
                <input
                  type="checkbox"
                  checked={visibleLayers[kind]}
                  onChange={() =>
                    setVisibleLayers((prev) => ({ ...prev, [kind]: !prev[kind] }))
                  }
                />
                {titleCase(kind)}
              </label>
            ))}
            <label className="layer-toggle" title="Toggle zone overlay">
              <input
                type="checkbox"
                checked={showZones}
                onChange={() => setShowZones((v) => !v)}
              />
              Zones
            </label>
          </div>
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
            tilesets={tilesets}
            {...(selectedCell && encounterAt(selectedCell) ? { encounter: encounterAt(selectedCell) } : {})}
            {...(selectedCell && itemAt(selectedCell) ? { item: itemAt(selectedCell) } : {})}
            {...(selectedCell && warpAt(selectedCell) ? { warp: warpAt(selectedCell) } : {})}
            {...(selectedCell && doorAt(selectedCell) ? { door: doorAt(selectedCell) } : {})}
            {...(selectedCell && trapAt(selectedCell) ? { trap: trapAt(selectedCell) } : {})}
            {...(selectedCell && chestAt(selectedCell) ? { chest: chestAt(selectedCell) } : {})}
            {...(selectedCell && triggerAt(selectedCell) ? { trigger: triggerAt(selectedCell) } : {})}
            {...(selectedCell && bridgeAt(selectedCell) ? { bridge: bridgeAt(selectedCell) } : {})}
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
