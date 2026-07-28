import type { CSSProperties, ReactElement } from 'react';
import type {
  Dungeon as DungeonType,
  DungeonRunView,
  DungeonTile,
  DungeonEncounter,
  DungeonItem,
  DungeonDoor,
} from '@digiworld/shared';
import type { RosterView } from '../../lib/api';

type DungeonGridProps = {
  readonly dungeon: DungeonType;
  readonly run: DungeonRunView['run'];
  readonly tiles: readonly DungeonTile[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
  readonly doors: readonly DungeonDoor[];
  readonly party: readonly RosterView[];
  readonly onCellClick: (x: number, y: number) => void;
};

export function DungeonGrid({
  dungeon,
  run,
  tiles,
  encounters,
  items,
  doors,
  party,
  onCellClick,
}: DungeonGridProps): ReactElement {
  const gridCells = [];
  const tilesSet = new Set(tiles.map((t) => `${t.x},${t.y}`));

  for (let y = 0; y < dungeon.height; y++) {
    for (let x = 0; x < dungeon.width; x++) {
      const isWalkable = tilesSet.has(`${x},${y}`);
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
        if (isAdjacent) cellClass += ' adj';
      }

      gridCells.push(
        <div
          key={`${x},${y}`}
          className={cellClass}
          onClick={() => {
            if (isWalkable && !isPlayer) onCellClick(x, y);
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
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
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
    <div
      className="dgrid"
      style={
        {
          '--dw': dungeon.width,
          '--dh': dungeon.height,
          gridTemplateColumns: `repeat(${dungeon.width}, 1fr)`,
          gridTemplateRows: `repeat(${dungeon.height}, 1fr)`,
        } as CSSProperties
      }
    >
      {gridCells}
    </div>
  );
}
