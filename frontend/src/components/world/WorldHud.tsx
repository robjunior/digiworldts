import type { BiomeMeta, PartyRating } from '../../lib/api-world';

type WorldHudProps = {
  readonly biome: BiomeMeta | null;
  readonly partyRating: PartyRating | null;
  readonly steps: number | null;
  readonly onNavigateLobby: () => void;
};

const powerFormatter = new Intl.NumberFormat('en-US');

export function WorldHud({ biome, partyRating, steps, onNavigateLobby }: WorldHudProps): JSX.Element {
  const powerValue = partyRating?.digiratingTotal;
  const powerLabel = powerValue !== undefined ? powerFormatter.format(powerValue) : '...';
  
  return (
    <>
      <div className="wstrip" data-od-id="world-strip">
        <span className="wk">The World</span>
        <span className="wv">Region<b id="strip-region">{biome?.label ?? 'Loading...'}</b></span>
        <span className="wv" style={{ borderLeft: '1px solid var(--hair)' }}>Power<b id="strip-el">{powerLabel}</b></span>
      </div>

      <button className="spin-toggle on" id="spin-toggle" aria-pressed="true" onClick={onNavigateLobby}>
        <span className="dot"></span>Esc / Lobby
      </button>

      <div className="whint">WASD / Arrows to move · <b>Steps {steps ?? '...'}</b></div>
    </>
  );
}
