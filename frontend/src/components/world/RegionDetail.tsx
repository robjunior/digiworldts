import type { WorldRegion } from '@digiworld/shared/world';
import type { CSSProperties } from 'react';
import type { WorldObject } from '../../lib/api-world';

const BLURB: Record<string, string> = {
  desert: 'Heat-warped dunes where Virus-types thrive. Ember storms scour the ridgelines at dusk.',
  forest: 'Dense canopy sheltering Vaccine-types. The deeper trails hide rarer species.',
  lake: 'A glass-still basin. Data-types surface at the shallows; the depths run cold.',
  storm: 'A permanent thunderhead. Free-types charge the air — high risk, high reward.',
  tundra: 'Frostbitten spires. Slow encounters, but tundra-hardened mons hit hard.',
  mountain: 'Sheer stone shelves. Earthbound giants guard the passes.',
  foundry: 'Molten industrial ruins. Steel-types patrol the slag rivers.',
  plateau: 'Wind-carved highlands. Fast, evasive fliers dominate the currents.',
  prairie: 'Sunlit grassland. The calmest scouting run — gentle first encounters.',
  swamp: 'Fog-drowned mire. Dark-types stalk the shallows; visibility is near zero.',
  void: 'A tear in the map. The Static churns out anomalies. Enter only fully prepared.',
};

const elVar = (el: string) => `var(--el-${el})`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type RegionDetailProps = {
  readonly selectedRegion: WorldRegion | null;
  readonly selectedLandmark: WorldObject | null;
  readonly onEnterDungeon: (dungeonId: string) => void;
};

export function RegionDetail({ selectedRegion, selectedLandmark, onEnterDungeon }: RegionDetailProps): JSX.Element {
  if (selectedRegion) {
    const dungeonId = selectedRegion.dungeonId;
    return (
      <div className="rdetail" id="rdetail">
        <div className="dk">Selected Region</div>
        <h3>{selectedRegion.label}</h3>
        <div className="dmeta" style={{ '--el': elVar(selectedRegion.element) } as CSSProperties}>
          <span className="rchip"><span className="cx"></span>{cap(selectedRegion.element)}</span>
          <span className="rchip" style={{ '--el': 'var(--muted)' } as CSSProperties}><span className="cx"></span>{cap(selectedRegion.biome)}</span>
          {selectedRegion.scouted && <span className="rchip" style={{ '--el': 'var(--signal)' } as CSSProperties}><span className="cx"></span>Scouted</span>}
        </div>
        <div className="dblurb">{BLURB[selectedRegion.biome] || ''}</div>
        <div className="dgauge">
          <div className="gl"><span>Danger</span><b>{selectedRegion.danger} / 5</b></div>
          <div className="gbar"><i style={{ width: `${selectedRegion.danger / 5 * 100}%` }}></i></div>
        </div>
        <button
          className="dbtn"
          id="scout-btn"
          disabled={dungeonId === null}
          onClick={() => { if (dungeonId !== null) onEnterDungeon(dungeonId); }}
        >
          Enter Dungeon
        </button>
      </div>
    );
  }

  if (selectedLandmark) {
    const dungeonId = selectedLandmark.dungeonId ?? null;
    const label = selectedLandmark.label && selectedLandmark.label.trim().length > 0
      ? selectedLandmark.label
      : `Unnamed ${selectedLandmark.kind}`;
    return (
      <div className="rdetail" id="rdetail">
        <div className="dk">Selected Landmark</div>
        <h3>{label}</h3>
        <div className="dmeta" style={{ '--el': selectedLandmark.tint ?? 'var(--muted)' } as CSSProperties}>
          <span className="rchip"><span className="cx"></span>{cap(selectedLandmark.kind)}</span>
          <span className="rchip" style={{ '--el': 'var(--muted)' } as CSSProperties}><span className="cx"></span>{selectedLandmark.lat.toFixed(1)}°, {selectedLandmark.lon.toFixed(1)}°</span>
        </div>
        {dungeonId !== null ? (
          <button
            className="dbtn"
            id="scout-btn"
            onClick={() => onEnterDungeon(dungeonId)}
          >
            Enter Dungeon
          </button>
        ) : (
          <div className="rempty">This landmark has no dungeon linked yet.</div>
        )}
      </div>
    );
  }

  return (
    <div className="rdetail" id="rdetail">
      <div className="rempty">Select a region or landmark on the globe or list to scout it.</div>
    </div>
  );
}
