import type { WorldRegion } from '@digiworld/shared/world';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type WorldStripProps = {
  readonly selectedRegion: WorldRegion | null;
  readonly autoSpin: boolean;
  readonly onToggleAutoSpin: () => void;
};

export function WorldStrip({ selectedRegion, autoSpin, onToggleAutoSpin }: WorldStripProps): JSX.Element {
  return (
    <>
      <div className="wstrip" data-od-id="world-strip">
        <span className="wk">The World</span>
        <span className="wv">Region<b id="strip-region">{selectedRegion ? selectedRegion.label : '—'}</b></span>
        <span className="wv" style={{ borderLeft: '1px solid var(--hair)' }}>Element<b id="strip-el">{selectedRegion ? cap(selectedRegion.element) : '—'}</b></span>
      </div>
      
      <button 
        className={`spin-toggle ${autoSpin ? 'on' : 'off'}`} 
        id="spin-toggle" 
        aria-pressed={autoSpin}
        onClick={onToggleAutoSpin}
      >
        <span className="dot"></span>Auto-spin: {autoSpin ? 'On' : 'Off'}
      </button>
      
      <div className="whint">Drag to rotate · scroll to zoom · <b>click a node</b> to enter the dungeon</div>
    </>
  );
}
