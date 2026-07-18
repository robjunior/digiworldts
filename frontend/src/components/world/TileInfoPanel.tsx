import type { WorldPosition, WorldTile } from '../../lib/api-world';

type TileInfoPanelProps = {
  readonly position: WorldPosition | null;
  readonly focusedTile: WorldTile | null;
};

export function TileInfoPanel({ position, focusedTile }: TileInfoPanelProps): JSX.Element {
  return (
    <aside className="world-tile-panel" aria-label="Current tile">
      <div className="world-tile-panel__cap">Coordinates</div>
      <div className="world-tile-panel__coords">{position ? `${position.x}, ${position.y}` : '—'}</div>
      <div className="world-tile-panel__meta">
        <span>{position?.biome.label ?? 'Loading biome'}</span>
        <span>{focusedTile?.biome ?? position?.biome.biome ?? 'unknown'}</span>
      </div>
    </aside>
  );
}
