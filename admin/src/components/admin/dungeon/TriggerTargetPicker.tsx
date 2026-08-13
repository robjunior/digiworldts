import type { CSSProperties, JSX } from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { DungeonView } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { listAdminDungeons, getAdminDungeon } from '../../../lib/api-dungeon-admin';
import { gidCellStyle, primaryTileset } from '../../../lib/tileset-sprite';

export type PickedTriggerTarget = {
  readonly kind: 'door' | 'bridge';
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
};

type CellButtonProps = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly gid: number | null;
  readonly tilesets: DungeonView['tilesets'];
  readonly marker: 'D' | 'B' | null;
  readonly markerTitle: string | null;
  readonly onClick: () => void;
};

const CellButton = ({ x, y, size, gid, tilesets, marker, markerTitle, onClick }: CellButtonProps): JSX.Element => {
  const style = gid !== null ? gidCellStyle(gid, tilesets, size) : null;
  return (
    <button
      type="button"
      className="tpt-cell"
      style={{
        width: size,
        height: size,
        ...(style ?? { background: '#101014' }),
      } as CSSProperties}
      onClick={onClick}
      title={markerTitle ?? `(${x}, ${y})`}
    >
      {marker !== null ? <span className="tpt-marker">{marker}</span> : null}
    </button>
  );
};

export function TriggerTargetPicker({
  currentDungeonId,
  groupId,
  kind,
  onPicked,
  onClose,
}: {
  readonly currentDungeonId: string;
  readonly groupId: string | null;
  readonly kind: 'door' | 'bridge';
  readonly onPicked: (target: PickedTriggerTarget) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [selectedDungeonId, setSelectedDungeonId] = useState<string>(currentDungeonId);
  const [hint, setHint] = useState<string | null>(null);

  const dungeonsQuery = useQuery({ queryKey: ['admin', 'dungeons'] as const, queryFn: listAdminDungeons });
  const eligible = useMemo(
    () => (dungeonsQuery.data?.dungeons ?? []).filter((d) =>
      groupId !== null ? d.dungeonGroupId === groupId : d.id === currentDungeonId,
    ),
    [dungeonsQuery.data, groupId, currentDungeonId],
  );
  const viewQuery = useQuery({
    queryKey: ADMIN_DUNGEON_QUERY(selectedDungeonId),
    queryFn: () => getAdminDungeon(selectedDungeonId),
    enabled: selectedDungeonId.length > 0,
  });
  const view = viewQuery.data;

  const tilesets = view?.tilesets ?? [];
  const tileSet = useMemo(() => new Set((view?.tiles ?? []).map((t) => `${t.x},${t.y}`)), [view?.tiles]);
  const doorByKey = useMemo(
    () => new Map<string, DungeonView['doors'][number]>((view?.doors ?? []).map((d) => [`${d.x},${d.y}`, d] as const)),
    [view?.doors],
  );
  const bridgeByKey = useMemo(
    () => new Map<string, DungeonView['bridges'][number]>((view?.bridges ?? []).map((b) => [`${b.x},${b.y}`, b] as const)),
    [view?.bridges],
  );
  const canonicalTileset = primaryTileset(tilesets);
  const cellSize = Math.max(28, Math.min(48, (canonicalTileset?.tileWidth ?? 32) * 1.5));

  if (view === null || view === undefined) {
    return (
      <div className="tpt-overlay" role="dialog" aria-modal="true" aria-label="Pick trigger target">
        <div className="tpt-panel">Loading map…</div>
      </div>
    );
  }

  const clickCell = (x: number, y: number): void => {
    if (kind === 'door') {
      const door = doorByKey.get(`${x},${y}`);
      if (!door) {
        setHint('No door on this tile.');
        return;
      }
      onPicked({ kind: 'door', id: door.id, dungeonId: selectedDungeonId, x, y, label: door.label });
      return;
    }
    const bridge = bridgeByKey.get(`${x},${y}`);
    if (!bridge) {
      setHint('No bridge on this tile.');
      return;
    }
    onPicked({ kind: 'bridge', id: bridge.id, dungeonId: selectedDungeonId, x, y, label: bridge.label });
  };

  const cells: JSX.Element[] = [];
  for (let y = 0; y < view.dungeon.height; y++) {
    for (let x = 0; x < view.dungeon.width; x++) {
      const key = `${x},${y}`;
      const walkable = tileSet.has(key);
      const door = doorByKey.get(key);
      const bridge = bridgeByKey.get(key);
      const gid = walkable ? (view.tiles.find((t) => `${t.x},${t.y}` === key)?.gid ?? null) : null;
      const marker = door !== undefined ? 'D' : bridge !== undefined ? 'B' : null;
      const markerTitle = door !== undefined
        ? `Door at (${x}, ${y})${door.label ? ` — ${door.label}` : ''}`
        : bridge !== undefined
          ? `Bridge at (${x}, ${y})${bridge.label ? ` — ${bridge.label}` : ''}`
          : null;
      cells.push(
        <CellButton
          key={key}
          x={x}
          y={y}
          size={cellSize}
          gid={gid}
          tilesets={tilesets}
          marker={marker}
          markerTitle={markerTitle}
          onClick={() => clickCell(x, y)}
        />,
      );
    }
  }

  return (
    <div className="tpt-overlay" role="dialog" aria-modal="true" aria-label="Pick trigger target">
      <div className="tpt-panel">
        <div className="tpt-header">
          <h3>Pick {kind} target</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <p className="muted">Click a {kind} on the map below. Maps of the same dungeon group are available — cross-map triggers keep their state.</p>
        <label className="tpt-dungeon-select">
          Map
          <select value={selectedDungeonId} onChange={(event) => setSelectedDungeonId(event.target.value)}>
            {eligible.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        {hint !== null ? <p className="tpt-hint">{hint}</p> : null}
        <div
          className="tpt-grid"
          style={{
            gridTemplateColumns: `repeat(${view.dungeon.width}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${view.dungeon.height}, ${cellSize}px)`,
          }}
        >
          {cells}
        </div>
      </div>
    </div>
  );
}
