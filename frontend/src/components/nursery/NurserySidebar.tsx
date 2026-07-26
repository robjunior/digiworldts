import type { NurseryMon, NurseryView } from '../../lib/api-nursery';

type SidebarProps = {
  readonly view: NurseryView | null;
  readonly loading: boolean;
  readonly busyMonId: string | null;
  readonly onPet: (mon: NurseryMon) => void;
  readonly onFeed: (mon: NurseryMon) => void;
};

export function NurserySidebar({ view, loading, busyMonId, onPet, onFeed }: SidebarProps): JSX.Element {
  if (loading) {
    return <div className="caregrid" id="caregrid" data-od-id="care-grid"><div className="rempty">Loading…</div></div>;
  }
  if (!view || view.mons.length === 0) {
    return <div className="caregrid" id="caregrid" data-od-id="care-grid"><div className="rempty">No Digimon yet. Complete onboarding first.</div></div>;
  }

  return (
    <div className="caregrid" id="caregrid" data-od-id="care-grid">
      {view.mons.map((mon) => (
        <NurseryMonCard key={mon.id} mon={mon} view={view} busy={busyMonId === mon.id} onPet={onPet} onFeed={onFeed} />
      ))}
    </div>
  );
}

function NurseryMonCard({ mon, view, busy, onPet, onFeed }: { readonly mon: NurseryMon; readonly view: NurseryView; readonly busy: boolean; readonly onPet: (mon: NurseryMon) => void; readonly onFeed: (mon: NurseryMon) => void }): JSX.Element {
  const canPet = mon.petsToday < view.maxPetsPerDay;
  const canFeed = view.meat >= view.feedMeatCost;
  
  function moodBand(v: number): string {
    return v >= 70 ? 'high' : v >= 35 ? 'mid' : 'low';
  }
  
  const band = moodBand(mon.mood);
  const dots = Array.from({ length: view.maxPetsPerDay }, (_, i) => (
    <i key={i} className={i < mon.petsToday ? 'on' : ''} />
  ));

  return (
    <article className="carecard" data-mood={band} data-mon={mon.id}>
      <div className="carehead">
        <span className="spr">
          <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        </span>
        <div>
          <div className="nm">{mon.nickname}</div>
          <div className="sub">{mon.template?.name ?? mon.catalogId} · Lv {mon.level}</div>
        </div>
      </div>
      <div className="moodrow">
        <div className="ml"><span>Mood</span><b>{Math.round(mon.mood)}/100</b></div>
        <div className="moodbar"><i style={{ width: `${mon.mood}%` }} /></div>
      </div>
      <div className="petsdots" title={`${mon.petsToday}/${view.maxPetsPerDay} pets today`}>{dots}</div>
      <div className="careacts">
        <button 
          type="button"
          className="cbtn pet" 
          disabled={!canPet || busy} 
          title={canPet ? `Pet (+${view.petMoodDelta} mood)` : `Petted ${view.maxPetsPerDay}× today`}
          onClick={() => onPet(mon)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 21c-4-2.5-7-5.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 12c0 3.5-3 6.5-7 9z"/>
          </svg>Pet
        </button>
        <button 
          type="button"
          className="cbtn feed" 
          disabled={!canFeed || busy} 
          title={canFeed ? `Feed (+${view.feedMoodDelta} mood)` : 'Not enough Meat'}
          onClick={() => onFeed(mon)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3c4 0 7 3 7 7 0 5-4 9-7 11-3-2-7-6-7-11 0-4 3-7 7-7z"/>
          </svg>Feed <span className="cost">{view.feedMeatCost}🍖</span>
        </button>
      </div>
    </article>
  );
}
