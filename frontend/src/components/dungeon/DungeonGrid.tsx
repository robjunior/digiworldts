import type { CSSProperties, ReactElement } from 'react';
import type {
  Dungeon as DungeonType,
  DungeonRunView,
  DungeonTile,
  DungeonEncounter,
  DungeonItem,
  DungeonDoor,
  TilesetGrant,
} from '@digiworld/shared';
import type { RosterView } from '../../lib/api';
import { gidCellStyle, primaryTileset } from '../../lib/tileset-sprite';

const PLAYER_ZOOM = 2;
const CELL_SIZE_FALLBACK = 32;

type DungeonGridProps = {
  readonly dungeon: DungeonType;
  readonly run: DungeonRunView['run'];
  readonly tiles: readonly DungeonTile[];
  readonly tilesets: readonly TilesetGrant[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
  readonly doors: readonly DungeonDoor[];
  readonly party: readonly RosterView[];
  /** Newest-first cells the party has occupied; `partyTrail[i]` maps to `party[i]`. Length ≤ 3. */
  readonly partyTrail: readonly { readonly x: number; readonly y: number }[];
  readonly onCellClick: (x: number, y: number) => void;
};

export function DungeonGrid({
  dungeon,
  run,
  tiles,
  tilesets,
  encounters,
  items,
  doors,
  party,
  partyTrail,
  onCellClick,
}: DungeonGridProps): ReactElement {
  const gridCells = [];
  const tilesByCoord = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  const canonicalTileset = primaryTileset(tilesets);
  const cellSize = canonicalTileset
    ? canonicalTileset.tileWidth * PLAYER_ZOOM
    : CELL_SIZE_FALLBACK;
  const spriteScale = canonicalTileset ? cellSize / canonicalTileset.tileWidth : 1;

  for (let y = 0; y < dungeon.height; y++) {
    for (let x = 0; x < dungeon.width; x++) {
      const tile = tilesByCoord.get(`${x},${y}`);
      const isWalkable = tile !== undefined;
      const isPlayer = run.currentX === x && run.currentY === y;
      const isAdjacent =
        !isPlayer &&
        isWalkable &&
        Math.abs(x - run.currentX) + Math.abs(y - run.currentY) === 1;

      const encounterAt = encounters.find((e) => e.x === x && e.y === y);
      const isUndefeatedEncounter =
        encounterAt && !run.defeatedEncounters.includes(encounterAt.id);

      const itemAt = items.find((i) => i.x === x && i.y === y);
      const isUncollectedItem =
        itemAt && !run.collectedItems.includes(itemAt.id);
      const doorAt = doors.find((door) => door.x === x && door.y === y);
      const isLockedDoor = doorAt ? !run.unlockedDoors.includes(doorAt.id) : false;

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

      const spriteStyle = tile !== undefined ? gidCellStyle(tile.gid, tilesets, spriteScale) : null;

      const trailIdx = partyTrail.findIndex((p) => p.x === x && p.y === y);
      const trailMember = trailIdx >= 0 ? party[trailIdx] ?? null : null;

      gridCells.push(
        <div
          key={`${x},${y}`}
          className={cellClass}
          style={spriteStyle ?? undefined}
          data-cell-x={x}
          data-cell-y={y}
          onClick={() => {
            if (isAdjacent) onCellClick(x, y);
          }}
        >
          {trailMember ? (
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
          {doorAt && !isPlayer ? <span className="door-marker">D</span> : null}
        </div>
      );
    }
  }

  return (
    <div
      className="dgrid"
      style={
        {
          '--dw': dungeon.width,
          '--dh': dungeon.height,
          '--cell-size': `${cellSize}px`,
          gridTemplateColumns: `repeat(${dungeon.width}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${dungeon.height}, ${cellSize}px)`,
          width: `${dungeon.width * cellSize}px`,
          height: `${dungeon.height * cellSize}px`,
        } as CSSProperties
      }
    >
      {gridCells}
    </div>
  );
}
