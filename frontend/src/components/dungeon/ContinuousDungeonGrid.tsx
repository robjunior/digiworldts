import type { CSSProperties, ReactElement, RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { DungeonGridNeighbor, DungeonRunView } from '@digiworld/shared';
import type { RosterView } from '../../lib/api';
import { primaryTileset } from '../../lib/tileset-sprite';
import { DungeonGrid, type DungeonGridProps } from './DungeonGrid';

type ContinuousDungeonGridProps = {
  readonly viewportRef: RefObject<HTMLDivElement>;
  readonly active: DungeonRunView;
  readonly neighbors: readonly DungeonGridNeighbor[];
  readonly party: readonly RosterView[];
  readonly facing: DungeonGridProps['facing'];
  readonly moveDurationMs: number;
  readonly partyTrail: DungeonGridProps['partyTrail'];
  readonly onCellClick: DungeonGridProps['onCellClick'];
};

type PositionedView = {
  readonly view: DungeonRunView;
  readonly gridX: number;
  readonly gridY: number;
  readonly active: boolean;
};

const EMPTY_PARTY: readonly RosterView[] = [];
const EMPTY_TRAIL: readonly { readonly x: number; readonly y: number }[] = [];
const NOOP = (): void => undefined;

function primaryCellSize(view: DungeonRunView): number {
  const tileset = primaryTileset(view.tilesets);
  return tileset ? tileset.tileWidth * 2 : 32;
}

export function ContinuousDungeonGrid({
  viewportRef,
  active,
  neighbors,
  party,
  facing,
  moveDurationMs,
  partyTrail,
  onCellClick,
}: ContinuousDungeonGridProps): ReactElement {
  const positions = useMemo<readonly PositionedView[]>(() => [
    {
      view: active,
      gridX: active.dungeon.gridX ?? 0,
      gridY: active.dungeon.gridY ?? 0,
      active: true,
    },
    ...neighbors.map((neighbor) => ({
      view: neighbor.view,
      gridX: neighbor.gridX,
      gridY: neighbor.gridY,
      active: false,
    })),
  ], [active, neighbors]);
  const cellSize = primaryCellSize(active);
  const slotWidth = Math.max(...positions.map((entry) => entry.view.dungeon.width)) * cellSize;
  const slotHeight = Math.max(...positions.map((entry) => entry.view.dungeon.height)) * cellSize;
  const minGridX = Math.min(...positions.map((entry) => entry.gridX));
  const minGridY = Math.min(...positions.map((entry) => entry.gridY));
  const maxGridX = Math.max(...positions.map((entry) => entry.gridX));
  const maxGridY = Math.max(...positions.map((entry) => entry.gridY));
  const canvasWidth = (maxGridX - minGridX + 1) * slotWidth;
  const canvasHeight = (maxGridY - minGridY + 1) * slotHeight;
  const activeEntry = positions[0];
  const playerX = ((activeEntry?.gridX ?? 0) - minGridX) * slotWidth + active.run.currentX * cellSize + cellSize / 2;
  const playerY = ((activeEntry?.gridY ?? 0) - minGridY) * slotHeight + active.run.currentY * cellSize + cellSize / 2;
  const [viewportSize, setViewportSize] = useState({
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = (): void => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportRef]);

  // Player-follow camera. Canvas bigger than the viewport: clamp the follow
  // to [vp - canvas, 0] so no void shows past the map edges. Canvas smaller:
  // follow exactly — the digimon stays screen-centered and, being on the
  // canvas, keeps the map within view.
  const boundsX = viewportSize.width - canvasWidth;
  const targetX = boundsX > 0
    ? viewportSize.width / 2 - playerX
    : Math.min(0, Math.max(boundsX, viewportSize.width / 2 - playerX));
  const boundsY = viewportSize.height - canvasHeight;
  const targetY = boundsY > 0
    ? viewportSize.height / 2 - playerY
    : Math.min(0, Math.max(boundsY, viewportSize.height / 2 - playerY));

  const canvasStyle: CSSProperties = {
    position: 'absolute',
    width: canvasWidth,
    height: canvasHeight,
    transform: `translate(${targetX}px, ${targetY}px)`,
    transition: 'transform 180ms ease-out',
    willChange: 'transform',
  };

  return (
    <div ref={viewportRef} className="dgrid-scroll-inner continuous-dungeon-grid" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div className="continuous-dungeon-canvas" style={canvasStyle}>
        {positions.map((entry) => {
          const left = (entry.gridX - minGridX) * slotWidth;
          const top = (entry.gridY - minGridY) * slotHeight;
          const slotStyle: CSSProperties = {
            position: 'absolute',
            left,
            top,
            width: slotWidth,
            height: slotHeight,
          };
          return (
            <div key={entry.view.dungeon.id} className={`continuous-dungeon-slot${entry.active ? ' is-active' : ''}`} style={slotStyle}>
              <DungeonGrid
                dungeon={entry.view.dungeon}
                run={entry.view.run}
                tiles={entry.view.tiles}
                tilesets={entry.view.tilesets}
                encounters={entry.view.encounters}
                items={entry.view.items}
                doors={entry.view.doors}
                chests={entry.view.chests}
                traps={entry.view.traps}
                triggers={entry.view.triggers}
                bridges={entry.view.bridges}
                poiStates={entry.view.poiStates}
                firedTriggerIds={entry.view.firedTriggerIds}
                facing={facing}
                moveDurationMs={moveDurationMs}
                party={entry.active ? party : EMPTY_PARTY}
                partyTrail={entry.active ? partyTrail : EMPTY_TRAIL}
                onCellClick={entry.active ? onCellClick : NOOP}
                cellSizeOverride={cellSize}
                cameraMode="none"
                interactive={entry.active}
                renderParty={entry.active}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
