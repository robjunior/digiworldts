import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import type { DungeonDoor, DungeonEncounter, DungeonItem, DungeonTile, DungeonView, DungeonWarp, EncounterDigimon } from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';
import { AdminGuard } from '../components/admin/AdminGuard';
import { getCatalog, getShopItems, type ShopItemView } from '../lib/api-admin';
import { createAdminDoor, createAdminEncounter, createAdminItem, createAdminWarp, deleteAdminDoor, deleteAdminEncounter, deleteAdminItem, deleteAdminWarp, getAdminDungeon, listAdminDungeons, putAdminDungeonTiles, updateAdminDoor, updateAdminDungeon, updateAdminEncounter, updateAdminWarp } from '../lib/api-dungeon-admin';
import '../styles/extensions-admin.css';

type Tool = 'PATH' | 'SPAWN' | 'ENCOUNTERS' | 'ITEMS' | 'WARPS' | 'DOORS';
type PathTool = 'PAINT' | 'LINE' | 'RECTANGLE';
type Cell = { readonly x: number; readonly y: number };
type Difficulty = DungeonEncounter['difficulty'];

const TOOLS: readonly Tool[] = ['PATH', 'SPAWN', 'ENCOUNTERS', 'ITEMS', 'WARPS', 'DOORS'] as const;
const PATH_TOOLS: readonly PathTool[] = ['PAINT', 'LINE', 'RECTANGLE'] as const;
const ADMIN_DUNGEON_QUERY = (id: string): readonly string[] => ['admin-dungeon', id] as const;

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
  const dungeonQuery = useQuery({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId), queryFn: () => getAdminDungeon(dungeonId), enabled: dungeonId.length > 0 });
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
      queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) => old ? { ...old, dungeon } : old);
    },
  });

  useEffect(() => {
    if (dungeonQuery.data) tileSetRef.current = new Set(dungeonQuery.data.tiles.map(tileKey));
  }, [dungeonQuery.data]);

  useEffect(() => {
    const finishPaint = (): void => {
      if (paintTarget !== null) {
        flushTiles();
        setPaintTarget(null);
      }
    };
    window.addEventListener('mouseup', finishPaint);
    return () => window.removeEventListener('mouseup', finishPaint);
  }, [paintTarget]);

  useEffect(() => {
    const cancelPending = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPendingStart(null);
    };
    window.addEventListener('keydown', cancelPending);
    return () => window.removeEventListener('keydown', cancelPending);
  }, []);

  const [viewport, setViewport] = useState<{ readonly vw: number; readonly vh: number }>(() => ({ vw: typeof window === 'undefined' ? 1440 : window.innerWidth, vh: typeof window === 'undefined' ? 900 : window.innerHeight }));

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

  const { dungeon, tiles, encounters, items, warps, doors } = data;
  const encounterAt = (cell: Cell): DungeonEncounter | undefined => encounters.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const itemAt = (cell: Cell): DungeonItem | undefined => items.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const warpAt = (cell: Cell): DungeonWarp | undefined => warps.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const doorAt = (cell: Cell): DungeonDoor | undefined => doors.find((entry) => entry.x === cell.x && entry.y === cell.y);
  const isWalkable = (cell: Cell): boolean => tileSet.has(cellKey(cell));

  function showToast(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(null), 1600);
  }

  function optimisticTiles(nextSet: Set<string>): void {
    const nextTiles = tilesFromSet(nextSet);
    tileSetRef.current = nextSet;
    queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) => old ? { ...old, tiles: nextTiles } : old);
  }

  function flushTiles(): void {
    tilesMutation.mutate(tilesFromSet(tileSetRef.current));
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
    if ((tool === 'SPAWN' || tool === 'ENCOUNTERS' || tool === 'ITEMS' || tool === 'WARPS' || tool === 'DOORS') && !isWalkable(cell)) {
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
  const cellSize = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(Math.min(availW / dungeon.width, availH / dungeon.height))));
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${dungeon.width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${dungeon.height}, ${cellSize}px)`,
  };
  const activeLabel = tool === 'PATH' ? `PATH — ${eraseMode ? 'Erase ' : ''}${titleCase(pathTool)}` : tool;

  return (
    <AdminGuard>
      <>
        <div className="admin-dungeon-grid-full" style={gridStyle}>
          {Array.from({ length: dungeon.height }, (_, y) => Array.from({ length: dungeon.width }, (__, x) => {
            const cell = { x, y };
            const key = cellKey(cell);
            const walkable = tileSet.has(key);
            const selected = selectedCell?.x === x && selectedCell.y === y;
            const spawn = dungeon.spawnX === x && dungeon.spawnY === y;
            const enc = encounterAt(cell);
            const item = itemAt(cell);
            const warp = warpAt(cell);
            const door = doorAt(cell);
            const preview = previewSet.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`dungeon-cell tool-${tool.toLowerCase()}${walkable ? ' is-walkable' : ''}${selected ? ' is-selected' : ''}${preview ? ' is-preview' : ''}`}
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
                </span>
              </button>
            );
          }))}
        </div>

        <aside className="admin-dungeon-floating-panel" aria-label="Dungeon editor tools">
          <div className="admin-dungeon-panel-head">
            <div>
              <h2>{dungeon.name}</h2>
              <span>{dungeon.width} × {dungeon.height} · {activeLabel}</span>
            </div>
            <button type="button" className="modal-close" onClick={() => navigate('/admin?tab=dungeons')} aria-label="Close dungeon editor">×</button>
          </div>
          <div className="layer-picker tool-picker" aria-label="Dungeon tools">
            {TOOLS.map((entry) => <button key={entry} type="button" className={tool === entry ? 'is-active' : ''} onClick={() => { setTool(entry); setPendingStart(null); }}>{entry}</button>)}
          </div>
          {tool === 'PATH' ? (
            <div className="subtool-picker" aria-label="Path drawing tools">
              {PATH_TOOLS.map((entry) => <button key={entry} type="button" className={pathTool === entry ? 'is-active' : ''} onClick={() => { setPathTool(entry); setPendingStart(null); }}>{pathIcon(entry)} {entry}</button>)}
              <button type="button" className={`erase-toggle${eraseMode ? ' is-active' : ''}`} onClick={() => setEraseMode(!eraseMode)} aria-pressed={eraseMode} title="Toggle erase mode (removes cells instead of adding)">⌫ ERASE</button>
            </div>
          ) : null}
          <ToolContext
            dungeonId={dungeonId}
            tool={tool}
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
        {toast ? <div className="toast show" role="status">{toast}</div> : null}
      </>
    </AdminGuard>
  );
}

function ToolContext({ dungeonId, tool, pathTool, selectedCell, pendingStart, isWalkable, encounter, item, warp, door, catalog, dungeons, shopItems }: { readonly dungeonId: string; readonly tool: Tool; readonly pathTool: PathTool; readonly selectedCell: Cell | null; readonly pendingStart: Cell | null; readonly isWalkable: boolean; readonly encounter?: DungeonEncounter | undefined; readonly item?: DungeonItem | undefined; readonly warp?: DungeonWarp | undefined; readonly door?: DungeonDoor | undefined; readonly catalog: readonly TemplateDigimon[]; readonly dungeons: readonly { readonly id: string; readonly name: string }[]; readonly shopItems: readonly ShopItemView[] }): JSX.Element {
  if (tool === 'PATH') return <div className="admin-editor-panel"><h3>Path drawing</h3><p className="muted">{pathTool === 'LINE' || pathTool === 'RECTANGLE' ? pendingStart ? `Choose an end cell from ${pendingStart.x}, ${pendingStart.y}. Escape or right-click cancels.` : 'Click a start cell.' : 'Drag across cells to paint the path layer.'}</p></div>;
  if (!selectedCell) return <div className="admin-editor-panel"><h3>{tool}</h3><p className="muted">Select a walkable cell.</p></div>;
  if (!isWalkable) return <div className="admin-editor-panel"><h3>Cell {selectedCell.x}, {selectedCell.y}</h3><p className="muted">This tile is not walkable.</p></div>;
  if (tool === 'SPAWN') return <div className="admin-editor-panel"><h3>Spawn moved</h3><p className="muted">Click any walkable cell to place the red S badge.</p></div>;
  if (tool === 'ENCOUNTERS') return <EncounterEditor dungeonId={dungeonId} x={selectedCell.x} y={selectedCell.y} catalog={catalog} {...(encounter ? { encounter } : {})} />;
  if (tool === 'ITEMS') return <ItemEditor dungeonId={dungeonId} x={selectedCell.x} y={selectedCell.y} {...(item ? { item } : {})} />;
  if (tool === 'WARPS') return <WarpEditor dungeonId={dungeonId} x={selectedCell.x} y={selectedCell.y} dungeons={dungeons.filter((dungeon) => dungeon.id !== dungeonId)} {...(warp ? { warp } : {})} />;
  return <DoorEditor dungeonId={dungeonId} x={selectedCell.x} y={selectedCell.y} shopItems={shopItems} {...(door ? { door } : {})} />;
}

function EncounterEditor({ dungeonId, x, y, encounter, catalog }: { readonly dungeonId: string; readonly x: number; readonly y: number; readonly encounter?: DungeonEncounter; readonly catalog: readonly TemplateDigimon[] }): JSX.Element {
  const queryClient = useQueryClient();
  const createMut = useMutation({ mutationFn: (body: { readonly x: number; readonly y: number; readonly digimon: readonly EncounterDigimon[] }) => createAdminEncounter(dungeonId, body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  const updateMut = useMutation({ mutationFn: ({ encounterId, body }: { readonly encounterId: string; readonly body: { readonly label?: string | null; readonly difficulty: Difficulty; readonly digimon: readonly EncounterDigimon[] } }) => updateAdminEncounter(dungeonId, encounterId, body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  const deleteMut = useMutation({ mutationFn: (encounterId: string) => deleteAdminEncounter(dungeonId, encounterId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  const [digimonList, setDigimonList] = useState<EncounterDigimon[]>(encounter?.digimon ? [...encounter.digimon] : []);
  const fallbackCatalogId = catalog[0]?.id ?? 'agumon';

  if (!encounter && !createMut.isPending) return <div><h3>No Encounter at {x},{y}</h3><button type="button" onClick={() => createMut.mutate({ x, y, digimon: [{ catalogId: fallbackCatalogId, level: 1 }] })}>Add Encounter</button></div>;
  if (!encounter) return <div>Creating...</div>;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const difficulty = toDifficulty(form.get('difficulty'));
    const label = toOptionalText(form.get('label'));
    updateMut.mutate({ encounterId: encounter.id, body: { ...(label === null ? {} : { label }), difficulty, digimon: digimonList } });
  };

  return <div className="admin-editor-panel"><h3>Edit Encounter</h3><form onSubmit={submit}><label>Label <input name="label" defaultValue={encounter.label ?? ''} /></label><label>Difficulty <select name="difficulty" defaultValue={encounter.difficulty}><option value="easy">Easy</option><option value="normal">Normal</option><option value="elite">Elite</option><option value="boss">Boss</option></select></label><h4>Digimon</h4>{digimonList.map((entry, index) => <div key={`${entry.catalogId}-${index}`} className="editor-sub-panel"><select value={entry.catalogId} onChange={(event) => setDigimonList(replaceAt(digimonList, index, { ...entry, catalogId: event.target.value }))}>{catalog.map((catalogEntry) => <option key={catalogEntry.id} value={catalogEntry.id}>{catalogEntry.name}</option>)}</select><input type="number" value={entry.level} onChange={(event) => setDigimonList(replaceAt(digimonList, index, { ...entry, level: Number.parseInt(event.target.value, 10) || 1 }))} /><button type="button" onClick={() => setDigimonList(digimonList.filter((_, entryIndex) => entryIndex !== index))}>Remove</button></div>)}<button type="button" onClick={() => setDigimonList([...digimonList, { catalogId: fallbackCatalogId, level: 1 }])}>Add Digimon</button><div className="admin-poi-actions"><button type="submit" disabled={updateMut.isPending}>Save</button><button type="button" onClick={() => deleteMut.mutate(encounter.id)}>Delete</button></div></form></div>;
}

function ItemEditor({ dungeonId, x, y, item }: { readonly dungeonId: string; readonly x: number; readonly y: number; readonly item?: DungeonItem }): JSX.Element {
  const queryClient = useQueryClient();
  const createMut = useMutation({ mutationFn: (body: { readonly x: number; readonly y: number; readonly itemId: string; readonly qty: number }) => createAdminItem(dungeonId, body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  const deleteMut = useMutation({ mutationFn: (itemId: string) => deleteAdminItem(dungeonId, itemId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  if (!item && !createMut.isPending) return <div><h3>No Item at {x},{y}</h3><button type="button" onClick={() => createMut.mutate({ x, y, itemId: 'hp_potion', qty: 1 })}>Add Item</button></div>;
  if (!item) return <div>Creating...</div>;
  return <div className="admin-editor-panel"><h3>Item</h3><p>ItemId: {item.itemId}</p><p>Qty: {item.qty}</p><button type="button" onClick={() => deleteMut.mutate(item.id)}>Delete</button></div>;
}

function WarpEditor({ dungeonId, x, y, warp, dungeons }: { readonly dungeonId: string; readonly x: number; readonly y: number; readonly warp?: DungeonWarp; readonly dungeons: readonly { readonly id: string; readonly name: string }[] }): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (view: DungeonView): void => { queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), view); };
  const createMut = useMutation({ mutationFn: (body: { readonly x: number; readonly y: number; readonly targetDungeonId?: string | null; readonly label?: string | null }) => createAdminWarp(dungeonId, body), onSuccess: applyView });
  const updateMut = useMutation({ mutationFn: (body: { readonly targetDungeonId?: string | null; readonly label?: string | null }) => updateAdminWarp(dungeonId, warp?.id ?? '', body), onSuccess: applyView });
  const deleteMut = useMutation({ mutationFn: (warpId: string) => deleteAdminWarp(dungeonId, warpId), onSuccess: applyView });
  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = toOptionalText(form.get('targetDungeonId'));
    const label = toOptionalText(form.get('label'));
    const body = { targetDungeonId: target, ...(label === null ? {} : { label }) };
    if (warp) updateMut.mutate(body);
    else createMut.mutate({ x, y, ...body });
  };
  return <div className="admin-editor-panel"><h3>Warp at ({x}, {y})</h3><form onSubmit={save}><label>Target<select name="targetDungeonId" defaultValue={warp?.targetDungeonId ?? ''}><option value="">— Exit to world —</option>{dungeons.map((dungeon) => <option key={dungeon.id} value={dungeon.id}>{dungeon.name}</option>)}</select></label><label>Label<input name="label" defaultValue={warp?.label ?? ''} placeholder="Optional label" /></label><div className="admin-poi-actions"><button type="submit" disabled={createMut.isPending || updateMut.isPending}>Save</button>{warp ? <button type="button" onClick={() => deleteMut.mutate(warp.id)} disabled={deleteMut.isPending}>Delete</button> : null}</div></form></div>;
}

function DoorEditor({ dungeonId, x, y, door, shopItems }: { readonly dungeonId: string; readonly x: number; readonly y: number; readonly door?: DungeonDoor; readonly shopItems: readonly ShopItemView[] }): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => { queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view); };
  const createMut = useMutation({ mutationFn: (body: { readonly x: number; readonly y: number; readonly keyItemId: string; readonly label?: string | null }) => createAdminDoor(dungeonId, body), onSuccess: applyView });
  const updateMut = useMutation({ mutationFn: (body: { readonly keyItemId?: string; readonly label?: string | null }) => updateAdminDoor(dungeonId, door?.id ?? '', body), onSuccess: applyView });
  const deleteMut = useMutation({ mutationFn: (doorId: string) => deleteAdminDoor(dungeonId, doorId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }) });
  const fallbackKeyItemId = door?.keyItemId ?? shopItems[0]?.id ?? '';
  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const keyItemId = toOptionalText(form.get('keyItemId')) ?? fallbackKeyItemId;
    const label = toOptionalText(form.get('label'));
    if (!keyItemId) return;
    if (door) updateMut.mutate({ keyItemId, label });
    else createMut.mutate({ x, y, keyItemId, ...(label === null ? {} : { label }) });
  };
  if (shopItems.length === 0) return <div className="admin-editor-panel"><h3>Door at ({x}, {y})</h3><p>No shop items exist yet. Create a consumable key in the Shop Admin tab first.</p></div>;
  return <div className="admin-editor-panel"><h3>Door at ({x}, {y})</h3><form onSubmit={save}><label>Key item<select name="keyItemId" defaultValue={fallbackKeyItemId}>{shopItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></label><label>Label<input name="label" defaultValue={door?.label ?? ''} placeholder="Optional door label" /></label><div className="admin-poi-actions"><button type="submit" disabled={createMut.isPending || updateMut.isPending}>Save</button>{door ? <button type="button" onClick={() => deleteMut.mutate(door.id)} disabled={deleteMut.isPending}>Delete</button> : null}</div></form></div>;
}

function tileKey(tile: DungeonTile): string { return `${tile.x},${tile.y}`; }
function cellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }
function tilesFromSet(keys: Set<string>): readonly DungeonTile[] { return [...keys].map((key) => { const [rawX, rawY] = key.split(','); return { x: Number(rawX), y: Number(rawY) }; }).sort((a, b) => a.y - b.y || a.x - b.x); }
function titleCase(value: string): string { return value.charAt(0) + value.slice(1).toLowerCase(); }
function pathIcon(value: PathTool): string { switch (value) { case 'PAINT': return '◆'; case 'LINE': return '╱'; case 'RECTANGLE': return '▣'; default: return assertNever(value); } }
function rectangleFill(a: Cell, b: Cell): readonly Cell[] { const cells: Cell[] = []; for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) cells.push({ x, y }); return cells; }
function bresenhamLine(a: Cell, b: Cell): readonly Cell[] { const cells: Cell[] = []; let x0 = a.x; let y0 = a.y; const dx = Math.abs(b.x - x0); const sx = x0 < b.x ? 1 : -1; const dy = -Math.abs(b.y - y0); const sy = y0 < b.y ? 1 : -1; let err = dx + dy; while (true) { cells.push({ x: x0, y: y0 }); if (x0 === b.x && y0 === b.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } return cells; }
function replaceAt<T>(items: readonly T[], index: number, value: T): T[] { return items.map((entry, entryIndex) => entryIndex === index ? value : entry); }
function toOptionalText(value: FormDataEntryValue | null): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function toDifficulty(value: FormDataEntryValue | null): Difficulty { return value === 'easy' || value === 'normal' || value === 'elite' || value === 'boss' ? value : 'normal'; }
function assertNever(value: never): never { throw new Error(`Unhandled value: ${String(value)}`); }
