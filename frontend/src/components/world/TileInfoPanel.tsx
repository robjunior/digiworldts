import type { WorldPosition, WorldTile } from '../../lib/api-world';

type TileInfoPanelProps = {
  readonly position: WorldPosition | null;
  readonly focusedTile: WorldTile | null;
};

export function TileInfoPanel({ position, focusedTile }: TileInfoPanelProps): JSX.Element {
  return (
    <div className="rhead">
      <div className="rt">Coordinates</div>
      <div className="rs"><b>{position ? `${position.x}, ${position.y}` : '—'}</b> · {focusedTile?.biome ?? position?.biome.biome ?? 'unknown'}</div>
    </div>
  );
}
