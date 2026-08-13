import type { CSSProperties, ReactElement } from 'react';
import { memo, useMemo } from 'react';

type CSSVars = CSSProperties & { [key: `--${string}`]: string | number };

import type {
  Dungeon as DungeonType,
  DungeonRunView,
  DungeonTile,
  TilesetGrant,
} from '@digiworld/shared';
import { UNDERLAY_LAYER_KINDS, WALKABLE_LAYER_KINDS } from '@digiworld/shared';
import type { RosterView } from '../../lib/api';
import { gidCellStyle, primaryTileset } from '../../lib/tileset-sprite';

const PLAYER_ZOOM = 2;
const CELL_SIZE_FALLBACK = 32;
const EMPTY_TILES: readonly DungeonTile[] = [];

function cellIsWalkable(tiles: readonly DungeonTile[]): boolean {
  const hasWalkable = tiles.some((t) => (WALKABLE_LAYER_KINDS as readonly string[]).includes(t.layerKind));
  const hasObstacle = tiles.some((t) => !(WALKABLE_LAYER_KINDS as readonly string[]).includes(t.layerKind));
  return hasWalkable && !hasObstacle;
}

const BG_KIND_ORDER: Record<string, number> = {
  floor: 0,
  grass: 1,
  doors: 2,
  hidden: 3,
  decoration: 4,
  tree: 5,
  wall: 6,
  walls: 7,
  water: 8,
  pit: 9,
};

function partitionTiles(tiles: readonly DungeonTile[]): {
  readonly underlay: readonly DungeonTile[];
  readonly background: readonly DungeonTile[];
} {
  const underlay: DungeonTile[] = [];
  const background: DungeonTile[] = [];
  for (const tile of tiles) {
    if ((UNDERLAY_LAYER_KINDS as readonly string[]).includes(tile.layerKind)) {
      underlay.push(tile);
    } else {
      background.push(tile);
    }
  }
  return { underlay, background };
}

type BgCellProps = {
  readonly x: number;
  readonly y: number;
  readonly cellTiles: readonly DungeonTile[];
  readonly cellClass: string;
  readonly isAdjacent: boolean;
  readonly cellSize: number;
  readonly tilesets: readonly TilesetGrant[];
  /** Preferred GID for the cell (door/chest/trap override), already
   * fallbacked to the background tile's GID by the parent. */
  readonly poiGid: number | undefined;
  readonly onCellClick: (x: number, y: number) => void;
};

const BgCell = memo(function BgCell({
  x,
  y,
  cellTiles,
  cellClass,
  isAdjacent,
  cellSize,
  tilesets,
  poiGid,
  onCellClick,
}: BgCellProps): ReactElement {
  const { underlay, background } = partitionTiles(cellTiles);
  const underlayStyles = underlay
    .map((tile) => gidCellStyle(tile.gid, tilesets, cellSize))
    .filter((s): s is CSSProperties => s !== null);
  const bgStyles = [...background]
    .sort((a, b) => (BG_KIND_ORDER[a.layerKind] ?? 99) - (BG_KIND_ORDER[b.layerKind] ?? 99))
    .map((tile) => gidCellStyle(tile.gid, tilesets, cellSize))
    .filter((s): s is CSSProperties => s !== null);
  const visualGid = poiGid;
  const bgStyle = visualGid !== undefined ? gidCellStyle(visualGid, tilesets, cellSize) : null;

  return (
    <div
      className={cellClass}
      data-cell-x={x}
      data-cell-y={y}
      onClick={() => {
        if (isAdjacent) onCellClick(x, y);
      }}
    >
      {underlayStyles.map((style, idx) => (
        <span key={`underlay-${idx}`} className="tile-bg" style={style} aria-hidden="true" />
      ))}
      {bgStyles.map((style, idx) => (
        <span key={`bg-${idx}`} className="tile-bg" style={style} aria-hidden="true" />
      ))}
      {bgStyle ? <span className="tile-bg" style={bgStyle} aria-hidden="true" /> : null}
    </div>
  );
});

type EntityCellProps = {
  readonly x: number;
  readonly y: number;
  readonly trailMember: RosterView | null;
  readonly isPlayer: boolean;
  readonly marker: 'door' | 'chest' | 'trap' | null;
};

const EntityCell = memo(function EntityCell({
  x,
  y,
  trailMember,
  isPlayer,
  marker,
}: EntityCellProps): ReactElement {
  return (
    <div
      className="dcell-entity"
      style={{ gridColumn: x + 1, gridRow: y + 1, position: 'relative' }}
      data-cell-x={x}
      data-cell-y={y}
    >
      {trailMember !== null ? (
        <div className="party-marker" aria-label={isPlayer ? 'Your party' : undefined}>
          <img
            className="party-sprite"
            src={`/assets/digimon/${trailMember.catalogId}/dot.gif`}
            alt={trailMember.nickname || trailMember.template?.name || 'party member'}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        </div>
      ) : null}
      {marker !== null && !isPlayer ? (
        <span className="door-marker">{marker === 'door' ? 'D' : marker === 'chest' ? 'C' : 'T'}</span>
      ) : null}
    </div>
  );
});

type DungeonGridProps = {
  readonly dungeon: DungeonType;
  readonly run: DungeonRunView['run'];
  readonly tiles: readonly DungeonTile[];
  readonly tilesets: readonly TilesetGrant[];
  readonly encounters: DungeonRunView['encounters'];
  readonly items: DungeonRunView['items'];
  readonly doors: DungeonRunView['doors'];
  readonly chests: DungeonRunView['chests'];
  readonly traps: DungeonRunView['traps'];
  readonly poiStates: DungeonRunView['poiStates'];
  readonly party: readonly RosterView[];
  /** Newest-first cells the party has occupied; `partyTrail[i]` maps to `party[i]`. Length ≤ 3. */
  readonly partyTrail: readonly { readonly x: number; readonly y: number }[];
  readonly onCellClick: (x: number, y: number) => void;
};

export const DungeonGrid = memo(function DungeonGrid({
  dungeon,
  run,
  tiles,
  tilesets,
  encounters,
  items,
  doors,
  chests,
  traps,
  poiStates,
  party,
  partyTrail,
  onCellClick,
}: DungeonGridProps): ReactElement {
  const tilesByCoord = useMemo(() => {
    const map = new Map<string, DungeonTile[]>();
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      const list = map.get(key) ?? [];
      list.push(tile);
      map.set(key, list);
    }
    return map;
  }, [tiles]);
  const poiStateByKey = useMemo(
    () => new Map(poiStates.map((s) => [`${s.poiKind}:${s.poiId}`, s.state] as const)),
    [poiStates],
  );
  const encounterByKey = useMemo(
    () => new Map<string, DungeonRunView['encounters'][number]>(encounters.map((e) => [`${e.x},${e.y}`, e] as const)),
    [encounters],
  );
  const itemByKey = useMemo(
    () => new Map<string, DungeonRunView['items'][number]>(items.map((i) => [`${i.x},${i.y}`, i] as const)),
    [items],
  );
  const doorByKey = useMemo(
    () => new Map<string, DungeonRunView['doors'][number]>(doors.map((d) => [`${d.x},${d.y}`, d] as const)),
    [doors],
  );
  const chestByKey = useMemo(
    () => new Map<string, DungeonRunView['chests'][number]>(chests.map((c) => [`${c.x},${c.y}`, c] as const)),
    [chests],
  );
  const trapByKey = useMemo(
    () => new Map<string, DungeonRunView['traps'][number]>(traps.map((t) => [`${t.x},${t.y}`, t] as const)),
    [traps],
  );
  const canonicalTileset = primaryTileset(tilesets);
  const cellSize = canonicalTileset ? canonicalTileset.tileWidth * PLAYER_ZOOM : CELL_SIZE_FALLBACK;

  const gridTemplateColumns = `repeat(${dungeon.width}, ${cellSize}px)`;
  const gridTemplateRows = `repeat(${dungeon.height}, ${cellSize}px)`;
  const gridSize: CSSVars = {
    '--dw': dungeon.width,
    '--dh': dungeon.height,
    '--cell-size': `${cellSize}px`,
    gridTemplateColumns,
    gridTemplateRows,
    width: `${dungeon.width * cellSize}px`,
    height: `${dungeon.height * cellSize}px`,
  };

  const bgCells: ReactElement[] = [];
  const entityCells: ReactElement[] = [];

  for (let y = 0; y < dungeon.height; y++) {
    for (let x = 0; x < dungeon.width; x++) {
      const key = `${x},${y}`;
      const cellTiles = tilesByCoord.get(key) ?? EMPTY_TILES;
      const isWalkable = cellIsWalkable(cellTiles);
      const isPlayer = run.currentX === x && run.currentY === y;
      const isAdjacent =
        !isPlayer && isWalkable && Math.abs(x - run.currentX) + Math.abs(y - run.currentY) === 1;

      const encounterAt = encounterByKey.get(key);
      const isUndefeatedEncounter =
        encounterAt !== undefined && !run.defeatedEncounters.includes(encounterAt.id);
      const itemAt = itemByKey.get(key);
      const isUncollectedItem = itemAt !== undefined && !run.collectedItems.includes(itemAt.id);
      const doorAt = doorByKey.get(key);
      const isLockedDoor = doorAt !== undefined && !run.unlockedDoors.includes(doorAt.id);
      const chestAt = chestByKey.get(key);
      const chestState = chestAt
        ? (poiStateByKey.get(`chest:${chestAt.id}`) ?? 'unused')
        : 'unused';
      const trapAt = trapByKey.get(key);
      const trapState = trapAt ? (poiStateByKey.get(`trap:${trapAt.id}`) ?? 'unused') : 'unused';

      let cellClass = 'dcell';
      if (!isWalkable) {
        cellClass += ' wall';
      } else {
        cellClass += ' walk';
        if (isPlayer) cellClass += ' player';
        else if (isUndefeatedEncounter) cellClass += ' enc';
        else if (isUncollectedItem) cellClass += ' item';
        if (doorAt) cellClass += ` is-door ${isLockedDoor ? 'is-locked' : 'is-unlocked'}`;
      }

      const bgTileGid = doorAt || chestAt || (trapAt && trapState === 'used')
        ? partitionTiles(cellTiles).background[0]?.gid
        : undefined;
      const poiGid = doorAt
        ? (isLockedDoor ? doorAt.unusedTileGid : doorAt.usedTileGid) ?? bgTileGid
        : chestAt
          ? (chestState === 'used' ? chestAt.usedTileGid : chestAt.unusedTileGid) ?? bgTileGid
          : trapAt && trapState === 'used'
            ? trapAt.usedTileGid ?? bgTileGid
            : undefined;

      bgCells.push(
        <BgCell
          key={key}
          x={x}
          y={y}
          cellTiles={cellTiles}
          cellClass={cellClass}
          isAdjacent={isAdjacent}
          cellSize={cellSize}
          tilesets={tilesets}
          poiGid={poiGid}
          onCellClick={onCellClick}
        />,
      );

      const trailIdx = partyTrail.findIndex((p) => p.x === x && p.y === y);
      const trailMember = trailIdx >= 0 ? party[trailIdx] ?? null : null;
      const doorMarker = doorAt !== undefined && !isPlayer ? 'door' : null;
      const chestMarker = chestAt !== undefined && !isPlayer ? 'chest' : null;
      const trapUsed = trapAt !== undefined && trapState === 'used' && !isPlayer;
      const marker = doorMarker ?? chestMarker ?? (trapUsed ? 'trap' : null);

      entityCells.push(
        <EntityCell
          key={key}
          x={x}
          y={y}
          trailMember={trailMember}
          isPlayer={isPlayer}
          marker={marker}
        />,
      );
    }
  }

  return (
    <div className="dgrid" style={{ ...gridSize, position: 'relative' }}>
      <div className="dgrid-layer dgrid-bg" style={{ ...gridSize, display: 'grid' }}>
        {bgCells}
      </div>
      <div className="dgrid-layer dgrid-entities" style={{ ...gridSize, display: 'grid' }}>
        {entityCells}
      </div>
    </div>
  );
});