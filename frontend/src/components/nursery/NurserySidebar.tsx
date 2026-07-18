import type { NurseryMon, NurseryView, PendingHatchEntry, SpeciesDataEntry } from '../../lib/api-nursery';
import { DigitamaPool } from './DigitamaPool';

type CareSectionProps = {
  readonly view: NurseryView | null;
  readonly loading: boolean;
  readonly busyMonId: string | null;
  readonly onPet: (mon: NurseryMon) => void;
  readonly onFeed: (mon: NurseryMon) => void;
};

type SidebarProps = CareSectionProps & {
  readonly dataEntries: readonly SpeciesDataEntry[];
  readonly pending: readonly PendingHatchEntry[];
  readonly dataLoading: boolean;
  readonly totalWeight: number;
  readonly busyCatalogId: string | null;
  readonly mixBusy: boolean;
  readonly onHatch: (entry: SpeciesDataEntry) => void;
  readonly onMix: () => void;
};

export function NurserySidebar({ view, loading, busyMonId, onPet, onFeed, dataEntries, pending, dataLoading, totalWeight, busyCatalogId, mixBusy, onHatch, onMix }: SidebarProps): JSX.Element {
  const meat = view?.meat ?? 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <div className="eyebrow">Nursery</div>
          <h1>Care</h1>
        </div>
        <div className="meat-pill" id="meat-pill"><span className="dot" />MEAT <b id="meat-amount">{meat}</b></div>
      </div>
      <div className="mon-list" id="mon-list">
        <SidebarContent view={view} loading={loading} busyMonId={busyMonId} onPet={onPet} onFeed={onFeed} />
      </div>
      <DigitamaPool
        entries={dataEntries}
        pending={pending}
        loading={dataLoading}
        totalWeight={totalWeight}
        busyCatalogId={busyCatalogId}
        mixBusy={mixBusy}
        onHatch={onHatch}
        onMix={onMix}
      />
    </aside>
  );
}

function SidebarContent(props: CareSectionProps): JSX.Element {
  if (props.loading) {
    return <div className="empty-nursery">Loading…</div>;
  }
  if (props.view === null || props.view.mons.length === 0) {
    return <div className="empty-nursery">No Digimon yet. Complete onboarding first.</div>;
  }
  const view = props.view;
  return <>{view.mons.map((mon) => <NurseryMonRow key={mon.id} mon={mon} view={view} busy={props.busyMonId === mon.id} onPet={props.onPet} onFeed={props.onFeed} />)}</>;
}

function NurseryMonRow({ mon, view, busy, onPet, onFeed }: { readonly mon: NurseryMon; readonly view: NurseryView; readonly busy: boolean; readonly onPet: (mon: NurseryMon) => void; readonly onFeed: (mon: NurseryMon) => void }): JSX.Element {
  const element = mon.template?.element ?? 'neutral';
  const canFeed = view.meat >= view.feedMeatCost;
  const petTitle = `+${view.petMoodDelta} mood · ${Math.max(0, view.maxPetsPerDay - mon.petsToday)} left today`;
  const feedTitle = `Costs ${view.feedMeatCost} Meat · +${view.feedMoodDelta} mood`;

  return (
    <div className="mon-row" data-element={element} data-row={mon.id}>
      <div className="thumb"><img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} /></div>
      <div>
        <div className="name"><span>{mon.nickname}</span><span className="lvl">Lv {mon.level}</span></div>
        <div className="mood-track" title={`Mood ${mon.mood} / 100`}><div className="mood-fill" data-mood={moodBucket(mon.mood)} /></div>
        <div className="meta-line"><span>Mood {mon.mood}</span><span>Pets {mon.petsToday}/{view.maxPetsPerDay}</span></div>
        <div className="actions">
          <button className="pet" type="button" disabled={!mon.canPet || busy} title={petTitle} onClick={() => onPet(mon)}>Pet</button>
          <button className="feed" type="button" disabled={!canFeed || busy} title={feedTitle} onClick={() => onFeed(mon)}>Feed</button>
        </div>
      </div>
    </div>
  );
}

function moodBucket(mood: number): string {
  return String(Math.max(0, Math.min(100, Math.round(mood / 5) * 5)));
}
