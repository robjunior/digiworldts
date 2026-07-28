import type { CSSProperties } from 'react';
import type { Biome, WorldRegion } from '@digiworld/shared/world';
import type { WorldObject } from '../../lib/api-world';
import { RegionDetail } from './RegionDetail';
import { QuestPane } from './QuestPane';

const elVar = (el: string) => `var(--el-${el})`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Derived from QuestPane props to avoid re-importing `QuestWithProgress` —
// missing from @digiworld/shared/quest (pre-existing) so a direct import breaks tsc.
type QuestForRail = Parameters<typeof QuestPane>[0]['quests'][number];

type RegionRailProps = {
  readonly regions: readonly WorldRegion[];
  readonly worldObjects: readonly WorldObject[];
  readonly quests: readonly QuestForRail[];
  readonly selectedIdx: number | null;
  readonly selectedLandmarkId: string | null;
  readonly tab: 'regions' | 'quests';
  readonly pendingQuestIds: ReadonlySet<string>;
  readonly loadingQuests: boolean;
  readonly onTabChange: (tab: 'regions' | 'quests') => void;
  readonly onSelectIdx: (idx: number) => void;
  readonly onSelectLandmark: (id: string) => void;
  readonly onEnterDungeon: (region: WorldRegion) => void;
  readonly onSelectBiome: (biome: Biome) => void;
  readonly onAcceptQuest: (id: string) => void;
  readonly onClaimQuest: (id: string) => void;
};

export function RegionRail({
  regions,
  worldObjects,
  quests,
  selectedIdx,
  selectedLandmarkId,
  tab,
  pendingQuestIds,
  loadingQuests,
  onTabChange,
  onSelectIdx,
  onSelectLandmark,
  onEnterDungeon,
  onSelectBiome,
  onAcceptQuest,
  onClaimQuest
}: RegionRailProps): JSX.Element {
  const selectedRegion = selectedIdx !== null ? (regions[selectedIdx] ?? null) : null;

  return (
    <aside className="rail" data-od-id="region-rail">
      <div className="rtabs" role="tablist" aria-label="Regions and Quests">
        <button
          type="button"
          className="rtab"
          role="tab"
          aria-selected={tab === 'regions'}
          onClick={() => onTabChange('regions')}
        >
          Regions <span className="tcount">{regions.length}</span>
        </button>
        <button
          type="button"
          className="rtab"
          role="tab"
          aria-selected={tab === 'quests'}
          onClick={() => onTabChange('quests')}
        >
          Quests <span className="tcount">{quests.length}</span>
        </button>
      </div>

      <div className={`rpane${tab === 'regions' ? ' show' : ''}`} role="tabpanel" aria-label="Regions" hidden={tab !== 'regions'}>
        <div className="rhead">
          <div className="rt">Regions</div>
          <div className="rs"><b id="rail-count">{regions.length}</b> discovered · sorted by danger</div>
        </div>
        
        <div className="rlist" id="rlist" role="listbox" aria-label="World regions">
          {[...regions].sort((a, z) => z.danger - a.danger).map((b) => {
            const i = regions.indexOf(b);
            const isSel = selectedIdx === i;
            return (
              <button 
                key={i}
                className={`rrow ${isSel ? 'sel' : ''}`} 
                data-region={i} 
                role="option" 
                aria-selected={isSel}
                onClick={() => onSelectIdx(i)}
                style={{ '--el': elVar(b.element) } as CSSProperties}
                aria-label={`${b.label}, ${b.element}, danger ${b.danger} of 5${b.scouted ? ', scouted' : ''}`}
              >
                <span className="rdot"></span>
                <span className="rnm">{b.label}<span className="rsub">{cap(b.element)} · {cap(b.biome)}</span></span>
                <span className="rdg">D{b.danger}{b.scouted ? ' ·✓' : ''}</span>
              </button>
            );
          })}
        </div>

        {worldObjects.length > 0 ? (
          <>
            <div className="rhead">
              <div className="rt">Landmarks</div>
              <div className="rs"><b>{worldObjects.length}</b> placed by admin</div>
            </div>
            <div className="rlist" role="listbox" aria-label="Admin-placed world landmarks">
              {worldObjects.map((obj) => {
                const isSel = selectedLandmarkId === obj.id;
                const label = obj.label && obj.label.trim().length > 0 ? obj.label : `Unnamed ${obj.kind}`;
                return (
                  <button
                    key={obj.id}
                    className={`rrow ${isSel ? 'sel' : ''}`}
                    role="option"
                    aria-selected={isSel}
                    onClick={() => onSelectLandmark(obj.id)}
                    style={{ '--el': obj.tint ?? '#c8b48a' } as CSSProperties}
                    aria-label={`${label}, ${obj.kind}, at ${obj.lat.toFixed(1)}° ${obj.lon.toFixed(1)}°`}
                  >
                    <span className="rdot"></span>
                    <span className="rnm">{label}<span className="rsub">{cap(obj.kind)} · {obj.lat.toFixed(1)}°, {obj.lon.toFixed(1)}°</span></span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <RegionDetail selectedRegion={selectedRegion} onEnterDungeon={onEnterDungeon} />
      </div>

      <div className={`rpane${tab === 'quests' ? ' show' : ''}`} role="tabpanel" aria-label="Quests" hidden={tab !== 'quests'}>
        <QuestPane
          quests={quests}
          regions={regions}
          loading={loadingQuests}
          pendingIds={pendingQuestIds}
          onAreaClick={onSelectBiome}
          onLocate={onSelectBiome}
          onAccept={onAcceptQuest}
          onClaim={onClaimQuest}
        />
      </div>
    </aside>
  );
}
