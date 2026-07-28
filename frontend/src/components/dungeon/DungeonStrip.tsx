import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type { DungeonRunView } from '@digiworld/shared';

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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 5l-7 7 7 7M20 12H7" />
        </svg>
        Leave
      </Link>
    </>
  );
}
