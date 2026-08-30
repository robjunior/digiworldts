import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type { DungeonRunView } from '@digiworld/shared';
import { LeaveIcon } from './icons';

type DungeonStripProps = {
  readonly dungeonName: string;
  readonly currentX: number;
  readonly currentY: number;
};

export function DungeonStrip({ dungeonName, currentX, currentY }: DungeonStripProps): ReactElement {
  return (
    <>
      <div className="dstrip">
        <span className="dk">{dungeonName}</span>
        <span className="dv">
          Tile<b>{currentX}, {currentY}</b>
        </span>
      </div>
      <Link to="/world" className="leave" aria-label="Leave dungeon">
        <LeaveIcon />
        Leave
      </Link>
    </>
  );
}
