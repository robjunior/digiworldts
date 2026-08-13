import type { JSX } from 'react';

import type {
  Dungeon,
  DungeonBridge,
  DungeonChest,
  DungeonDoor,
  DungeonEncounter,
  DungeonItem,
  DungeonTrap,
  DungeonTrigger,
  DungeonWarp,
  TilesetGrant,
} from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { BridgeEditor } from './BridgeEditor';
import { ChestEditor } from './ChestEditor';
import { DoorEditor } from './DoorEditor';
import { EncounterEditor } from './EncounterEditor';
import { BossEditor } from './BossEditor';
import { ItemEditor } from './ItemEditor';
import { RandomEncountersEditor } from './RandomEncountersEditor';
import { TrapEditor } from './TrapEditor';
import { TriggerEditor } from './TriggerEditor';
import { WarpEditor } from './WarpEditor';
import { ZonesEditor } from './ZonesEditor';
import type { Cell, PathTool, Tool } from './types';
import type { ShopItemView } from '../../../lib/api-admin';

/**
 * Dispatches the correct editor for the currently active tool and selected cell.
 * Previously an inline function in AdminDungeon.tsx.
 */
export function ToolContext({
  dungeonId,
  tool,
  dungeon,
  pathTool,
  selectedCell,
  pendingStart,
  isWalkable,
  encounter,
  item,
  warp,
  door,
  trap,
  chest,
  trigger,
  bridge,
  catalog,
  dungeons,
  shopItems,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly tool: Tool;
  readonly dungeon: Dungeon;
  readonly pathTool: PathTool;
  readonly selectedCell: Cell | null;
  readonly pendingStart: Cell | null;
  readonly isWalkable: boolean;
  readonly encounter?: DungeonEncounter | undefined;
  readonly item?: DungeonItem | undefined;
  readonly warp?: DungeonWarp | undefined;
  readonly door?: DungeonDoor | undefined;
  readonly trap?: DungeonTrap | undefined;
  readonly chest?: DungeonChest | undefined;
  readonly trigger?: DungeonTrigger | undefined;
  readonly bridge?: DungeonBridge | undefined;
  readonly catalog: readonly TemplateDigimon[];
  readonly dungeons: readonly { readonly id: string; readonly name: string }[];
  readonly shopItems: readonly ShopItemView[];
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  if (tool === 'PATH') {
    return (
      <div className="admin-editor-panel">
        <h3>Path drawing</h3>
        <p className="muted">
          {pathTool === 'LINE' || pathTool === 'RECTANGLE'
            ? pendingStart
              ? `Choose an end cell from ${pendingStart.x}, ${pendingStart.y}. Escape or right-click cancels.`
              : 'Click a start cell.'
            : 'Drag across cells to paint the path layer.'}
        </p>
      </div>
    );
  }
  if (tool === 'RANDOM') return <RandomEncountersEditor dungeonId={dungeonId} dungeon={dungeon} catalog={catalog} />;
  if (tool === 'ZONES') return <ZonesEditor dungeonId={dungeonId} catalog={catalog} />;
  if (!selectedCell) {
    return (
      <div className="admin-editor-panel">
        <h3>{tool}</h3>
        <p className="muted">Select a walkable cell.</p>
      </div>
    );
  }
  if (!isWalkable) {
    return (
      <div className="admin-editor-panel">
        <h3>
          Cell {selectedCell.x}, {selectedCell.y}
        </h3>
        <p className="muted">This tile is not walkable.</p>
      </div>
    );
  }
  if (tool === 'SPAWN') {
    return (
      <div className="admin-editor-panel">
        <h3>Spawn moved</h3>
        <p className="muted">Click any walkable cell to place the red S badge.</p>
      </div>
    );
  }
  if (tool === 'ENCOUNTERS') {
    return (
      <EncounterEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        catalog={catalog}
        shopItems={shopItems}
        {...(encounter ? { encounter } : {})}
      />
    );
  }
  if (tool === 'BOSS') {
    return (
      <BossEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        catalog={catalog}
        shopItems={shopItems}
        {...(encounter ? { encounter } : {})}
      />
    );
  }
  if (tool === 'ITEMS') {
    return (
      <ItemEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        {...(item ? { item } : {})}
      />
    );
  }
  if (tool === 'WARPS') {
    return (
      <WarpEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        dungeons={dungeons.filter((entry) => entry.id !== dungeonId)}
        {...(warp ? { warp } : {})}
      />
    );
  }
  if (tool === 'DOORS') {
    return (
      <DoorEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        shopItems={shopItems}
        tilesets={tilesets}
        {...(door ? { door } : {})}
      />
    );
  }
  if (tool === 'CHESTS') {
    return (
      <ChestEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        shopItems={shopItems}
        tilesets={tilesets}
        {...(chest ? { chest } : {})}
      />
    );
  }
  if (tool === 'TRIGGERS') {
    return (
      <TriggerEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        tilesets={tilesets}
        {...(trigger ? { trigger } : {})}
      />
    );
  }
  if (tool === 'BRIDGES') {
    return (
      <BridgeEditor
        dungeonId={dungeonId}
        x={selectedCell.x}
        y={selectedCell.y}
        tilesets={tilesets}
        {...(bridge ? { bridge } : {})}
      />
    );
  }
  return (
    <TrapEditor
      dungeonId={dungeonId}
      x={selectedCell.x}
      y={selectedCell.y}
      tilesets={tilesets}
      {...(trap ? { trap } : {})}
    />
  );
}
