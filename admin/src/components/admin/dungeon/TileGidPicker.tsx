import type { JSX } from 'react';

import type { TilesetGrant } from '@digiworld/shared';

import { gidCellStyle } from '../../../lib/tileset-sprite';

type TileGidPickerProps = {
  readonly label: string;
  readonly value: number | null;
  readonly tilesets: readonly TilesetGrant[];
  readonly onChange: (gid: number | null) => void;
};

function gidsForTilesets(tilesets: readonly TilesetGrant[]): readonly number[] {
  return tilesets.flatMap((tileset) =>
    Array.from({ length: tileset.tileCount }, (_, index) => tileset.firstgid + index),
  );
}

export function TileGidPicker({ label, value, tilesets, onChange }: TileGidPickerProps): JSX.Element {
  const gids = gidsForTilesets(tilesets);
  return (
    <fieldset className="tile-gid-picker">
      <legend>{label}</legend>
      <div className="tile-gid-picker-actions">
        <span className="muted">Selected: {value ?? 'default'}</span>
        <button type="button" onClick={() => onChange(null)} disabled={value === null}>
          Clear
        </button>
      </div>
      {gids.length === 0 ? (
        <p className="muted">No tilesets attached to this dungeon.</p>
      ) : (
        <div className="tile-gid-grid" role="listbox" aria-label={label}>
          {gids.map((gid) => {
            const style = gidCellStyle(gid, tilesets, 1);
            return (
              <button
                key={gid}
                type="button"
                className={value === gid ? 'is-active' : ''}
                style={style ?? undefined}
                title={`GID ${gid}`}
                aria-label={`Select tile GID ${gid}`}
                onClick={() => onChange(gid)}
              >
                <span>{gid}</span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
