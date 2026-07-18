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
    <div className="world-hud" aria-live="polite">
      <div className="world-hud__top">
        <div className="world-pill world-pill--biome">
          <span className="world-pill__dot" style={{ backgroundColor: biome?.color ?? 'var(--muted)' }} />
          <span>{biome?.label ?? 'Loading...'}</span>
        </div>
        <div className="world-pill">Party Rating: <b>{partyRating?.rating ?? '...'}</b></div>
        <div className="world-pill" title="Total party stat power — wild encounters are capped near this number.">Power: <b>{powerLabel}</b></div>
      </div>
      <div className="world-hud__bottom">
        <span>WASD / Arrows to move</span>
        <span>Steps {steps ?? '...'}</span>
        <button className="world-text-button" type="button" onClick={onNavigateLobby}>Esc / Lobby</button>
      </div>
    </div>
  );
}
