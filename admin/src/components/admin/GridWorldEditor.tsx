import type { JSX, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { Dungeon } from '@digiworld/shared';

import { listAdminDungeons, updateAdminDungeon } from '../../lib/api-dungeon-admin';
import { TiledImportButton } from './dungeon/TiledImportButton';

const DUNGEONS_QUERY_KEY = ['admin', 'dungeons'] as const;
const CELL = 128;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const DRAG_THRESHOLD = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

type PanDrag = {
  readonly kind: 'pan';
  readonly startX: number;
  readonly startY: number;
  readonly panX: number;
  readonly panY: number;
  readonly moved: boolean;
};

type CellDrag = {
  readonly kind: 'cell';
  readonly dungeon: Dungeon;
  readonly originX: number;
  readonly originY: number;
  readonly startX: number;
  readonly startY: number;
  readonly moved: boolean;
};

function MiniPreview({ dungeon }: { readonly dungeon: Dungeon }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mask = dungeon.walkableMask;
    if (mask === null || mask.length === 0) return;
    const scaleX = canvas.width / dungeon.width;
    const scaleY = canvas.height / dungeon.height;
    ctx.fillStyle = 'rgba(120, 200, 140, 0.85)';
    for (const [x, y] of mask) {
      ctx.fillRect(Math.floor(x * scaleX), Math.floor(y * scaleY), Math.max(1, Math.ceil(scaleX)), Math.max(1, Math.ceil(scaleY)));
    }
  }, [dungeon]);
  return <canvas ref={ref} width={dungeon.width} height={dungeon.height} className="grid-world-mini" />;
}

export function GridWorldEditor(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dungeonsQuery = useQuery({ queryKey: DUNGEONS_QUERY_KEY, queryFn: listAdminDungeons });
  const allDungeons = dungeonsQuery.data?.dungeons ?? [];

  const [group, setGroup] = useState<string>('');
  const [newGroup, setNewGroup] = useState<string>('');
  const [zoom, setZoom] = useState<number>(0.75);
  const [pan, setPan] = useState<{ readonly x: number; readonly y: number }>({ x: 60, y: 60 });
  const [selected, setSelected] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [drag, setDrag] = useState<PanDrag | CellDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [assignId, setAssignId] = useState<string>('');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (wrapEl === null) return;
    const update = (): void => setViewportSize({ width: wrapEl.clientWidth, height: wrapEl.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapEl);
    return () => observer.disconnect();
  }, [wrapEl]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDungeons) if (d.dungeonGroupId !== null) set.add(d.dungeonGroupId);
    return [...set].sort();
  }, [allDungeons]);

  const groupDungeons = useMemo(
    () => allDungeons.filter((d) => d.dungeonGroupId === group),
    [allDungeons, group],
  );

  const cells = useMemo(() => {
    const map = new Map<string, Dungeon>();
    for (const d of groupDungeons) {
      if (d.gridX !== null && d.gridY !== null) map.set(cellKey(d.gridX, d.gridY), d);
    }
    return map;
  }, [groupDungeons]);

  const placedInGroup = useMemo(() => {
    const ids = new Set<string>();
    for (const d of groupDungeons) if (d.gridX !== null && d.gridY !== null) ids.add(d.id);
    return ids;
  }, [groupDungeons]);

  const assignable = useMemo(() => allDungeons.filter((d) => !placedInGroup.has(d.id)), [allDungeons, placedInGroup]);

  const gridBounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const d of groupDungeons) {
      if (d.gridX !== null && d.gridY !== null) {
        xs.push(d.gridX);
        ys.push(d.gridY);
      }
    }
    if (xs.length === 0) return null;
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [groupDungeons]);

  const mutation = useMutation({
    mutationFn: ({ id, body }: { readonly id: string; readonly body: Parameters<typeof updateAdminDungeon>[1] }) => updateAdminDungeon(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DUNGEONS_QUERY_KEY });
    },
  });

  const cellFromEvent = (clientX: number, clientY: number): { readonly x: number; readonly y: number } | null => {
    const wrap = wrapEl;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const worldX = (clientX - rect.left - pan.x) / zoom;
    const worldY = (clientY - rect.top - pan.y) / zoom;
    return { x: Math.floor(worldX / CELL), y: Math.floor(worldY / CELL) };
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const wrap = wrapEl;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    setZoom((current) => {
      const factor = event.deltaY > 0 ? 1 / 1.15 : 1.15;
      const next = clamp(current * factor, ZOOM_MIN, ZOOM_MAX);
      setPan((p) => ({ x: mx - ((mx - p.x) * next) / current, y: my - ((my - p.y) * next) / current }));
      return next;
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest('[data-gx]') as HTMLElement | null;
    if (target !== null) {
      const gx = Number(target.dataset.gx);
      const gy = Number(target.dataset.gy);
      const dungeon = cells.get(cellKey(gx, gy));
      if (dungeon !== undefined) {
        setDrag({ kind: 'cell', dungeon, originX: gx, originY: gy, startX: event.clientX, startY: event.clientY, moved: false });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y, moved: false });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    if (drag.kind === 'pan') {
      const moved = drag.moved || Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD || Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
      setPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) });
      if (moved !== drag.moved) setDrag({ ...drag, moved });
      return;
    }
    const moved = drag.moved || Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD || Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
    if (moved) {
      const cell = cellFromEvent(event.clientX, event.clientY);
      setDropTarget(cell !== null && (cell.x !== drag.originX || cell.y !== drag.originY) ? cell : null);
    }
    if (moved !== drag.moved) setDrag({ ...drag, moved });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.kind === 'cell') {
      if (!drag.moved) {
        setSelected({ x: drag.originX, y: drag.originY });
      } else if (dropTarget !== null && !cells.has(cellKey(dropTarget.x, dropTarget.y))) {
        mutation.mutate({
          id: drag.dungeon.id,
          body: {
            dungeonGroupId: group,
            floorIndex: drag.dungeon.floorIndex,
            gridX: dropTarget.x,
            gridY: dropTarget.y,
          },
        });
      }
    } else {
      if (!drag.moved) {
        const cell = cellFromEvent(event.clientX, event.clientY);
        if (cell !== null) setSelected(cell);
      }
    }
    setDrag(null);
    setDropTarget(null);
  };

  const fitGroup = (): void => {
    if (gridBounds === null) return;
    const { minX, maxX, minY, maxY } = gridBounds;
    const w = (maxX - minX + 1) * CELL;
    const h = (maxY - minY + 1) * CELL;
    const next = clamp(Math.min(viewportSize.width / w, viewportSize.height / h, 1), ZOOM_MIN, ZOOM_MAX);
    setZoom(next);
    setPan({ x: (viewportSize.width - w * next) / 2 - minX * CELL * next, y: (viewportSize.height - h * next) / 2 - minY * CELL * next });
  };

  const assign = (): void => {
    if (selected === null || assignId === '') return;
    const dungeon = allDungeons.find((d) => d.id === assignId);
    if (dungeon === undefined) return;
    mutation.mutate({
      id: dungeon.id,
      body: { dungeonGroupId: group, floorIndex: dungeon.floorIndex, gridX: selected.x, gridY: selected.y },
    });
    setAssignId('');
  };

  const removeFromGrid = (dungeon: Dungeon): void => {
    mutation.mutate({ id: dungeon.id, body: { dungeonGroupId: null, gridX: null, gridY: null } });
  };

  const worldLeft = -pan.x / zoom;
  const worldTop = -pan.y / zoom;
  const worldRight = (viewportSize.width - pan.x) / zoom;
  const worldBottom = (viewportSize.height - pan.y) / zoom;
  const gx0 = Math.floor(worldLeft / CELL) - 1;
  const gy0 = Math.floor(worldTop / CELL) - 1;
  const gx1 = Math.ceil(worldRight / CELL) + 1;
  const gy1 = Math.ceil(worldBottom / CELL) + 1;

  const visibleCells: { readonly x: number; readonly y: number }[] = [];
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) visibleCells.push({ x: gx, y: gy });
  }

  const selectedDungeon = selected !== null ? cells.get(cellKey(selected.x, selected.y)) : undefined;
  const originGroup = selectedDungeon === undefined && assignId !== '' ? allDungeons.find((d) => d.id === assignId) : undefined;
  const assignLabel = originGroup !== undefined && originGroup.dungeonGroupId !== null && originGroup.dungeonGroupId !== group
    ? `${originGroup.name} (moves from ${originGroup.dungeonGroupId})`
    : originGroup?.name ?? '';

  return (
    <div className="grid-world-editor">
      <div className="grid-world-toolbar">
        <label className="muted">
          Grid group
          <select value={group} onChange={(event) => { setGroup(event.target.value); setSelected(null); setAssignId(''); }}>
            <option value="">— select group —</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <div className="grid-world-toolbar-new">
          <input
            className="input"
            value={newGroup}
            onChange={(event) => setNewGroup(event.target.value)}
            placeholder="new group name"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newGroup.trim() !== '') {
                setGroup(newGroup.trim());
                setNewGroup('');
              }
            }}
          />
          <button type="button" className="btn btn--secondary btn--sm" disabled={newGroup.trim() === ''} onClick={() => { setGroup(newGroup.trim()); setNewGroup(''); }}>
            Use group
          </button>
        </div>
        <div className="grid-world-toolbar-zoom">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setZoom((z) => clamp(z * 1.25, ZOOM_MIN, ZOOM_MAX))} aria-label="Zoom in">+</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setZoom((z) => clamp(z / 1.25, ZOOM_MIN, ZOOM_MAX))} aria-label="Zoom out">−</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={fitGroup} aria-label="Fit group in view">Fit</button>
          <span className="muted">{Math.round(zoom * 100)}% · {group === '' ? 'no group' : `${groupDungeons.length} placed · ${gridBounds !== null ? `${gridBounds.maxX - gridBounds.minX + 1}×${gridBounds.maxY - gridBounds.minY + 1} cells` : 'empty'}`}</span>
        </div>
      </div>

      {group === '' ? (
        <div className="grid-world-empty">
          <p>Select or create a grid group to start placing dungeons.</p>
          <p className="muted">Cells that share a group and are orthogonally adjacent connect as one continuous world in-game.</p>
        </div>
      ) : (
        <div className="grid-world-body">
          <div
            ref={setWrapEl}
            className="grid-world-canvas-wrap"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { setDrag(null); setDropTarget(null); }}
          >
            <div
              className="grid-world-canvas"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: (gx1 + 1) * CELL, height: (gy1 + 1) * CELL }}
            >
              {visibleCells.map(({ x, y }) => {
                const dungeon = cells.get(cellKey(x, y));
                const isSelected = selected !== null && selected.x === x && selected.y === y;
                const isTarget = dropTarget !== null && dropTarget.x === x && dropTarget.y === y;
                return (
                  <div
                    key={cellKey(x, y)}
                    data-gx={x}
                    data-gy={y}
                    className={[
                      'grid-world-cell',
                      dungeon !== undefined ? 'is-occupied' : '',
                      isSelected ? 'is-selected' : '',
                      isTarget ? 'is-drop-target' : '',
                      drag?.kind === 'cell' && drag.dungeon.id === dungeon?.id ? 'is-dragging' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }}
                  >
                    {dungeon !== undefined ? (
                      <>
                        <MiniPreview dungeon={dungeon} />
                        <span className="grid-world-cell-name" title={dungeon.name}>{dungeon.name}</span>
                        <span className="grid-world-cell-meta">
                          {dungeon.width}×{dungeon.height} · {dungeon.biome}{dungeon.floorIndex !== null ? ` · F${dungeon.floorIndex}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="grid-world-cell-add">+</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="grid-world-panel">
            {selected === null ? (
              <p className="muted">Click a cell to assign a dungeon, or drag an occupied cell onto an empty one to move it.</p>
            ) : (
              <>
                <h3>Cell ({selected.x}, {selected.y})</h3>
                {selectedDungeon !== undefined ? (
                  <>
                    <p><b>{selectedDungeon.name}</b></p>
                    <p className="muted">{selectedDungeon.width}×{selectedDungeon.height} · {selectedDungeon.biome} · {selectedDungeon.id}</p>
                    <div className="grid-world-actions">
                      <button type="button" className="btn btn--sm" onClick={() => navigate(`/dungeons/${selectedDungeon.id}`)}>Open editor</button>
                      <button type="button" className="btn btn--secondary btn--sm" disabled={mutation.isPending} onClick={() => removeFromGrid(selectedDungeon)}>Remove from grid</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted">Empty cell — place an existing dungeon or create one from a Tiled export.</p>
                    <label className="muted">
                      Dungeon to place
                      <select value={assignId} onChange={(event) => setAssignId(event.target.value)}>
                        <option value="">— choose dungeon —</option>
                        {assignable.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}{d.dungeonGroupId !== null && d.dungeonGroupId !== group ? ` (moves from ${d.dungeonGroupId})` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="btn btn--sm" disabled={assignId === '' || mutation.isPending} onClick={assign}>
                      Place at ({selected.x}, {selected.y})
                    </button>
                    {assignId !== '' && originGroup !== undefined && originGroup.dungeonGroupId !== null ? (
                      <p className="muted grid-world-move-warning">Placing moves the dungeon — it will leave its current group. {assignLabel}</p>
                    ) : null}
                    <div className="grid-world-import">
                      <div className="muted">…or create a new map here:</div>
                      <TiledImportButton
                        mode="new"
                        onImported={(dungeonId) => {
                          void queryClient.invalidateQueries({ queryKey: DUNGEONS_QUERY_KEY });
                          mutation.mutate({
                            id: dungeonId,
                            body: { dungeonGroupId: group, floorIndex: null, gridX: selected.x, gridY: selected.y },
                          });
                        }}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
