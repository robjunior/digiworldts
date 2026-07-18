import type { OnboardingMonSummary } from '../../lib/api-onboarding';

type MonTileProps = {
  readonly mon: OnboardingMonSummary;
};

export function MonTile({ mon }: MonTileProps): JSX.Element {
  const imageSrc = mon.portrait || mon.dot || '/assets/digimon/default.png';

  return (
    <div className="mon-tile">
      <img src={imageSrc} alt={mon.name} className="mon-portrait" />
      <div className="mon-name">{mon.name}</div>
      <div className="mon-pills">
        <span className="pill" data-element={mon.element}>
          <span className="dot" />
          {mon.element}
        </span>
        <span className="pill" data-stage={mon.stage}>
          {mon.stage}
        </span>
      </div>
    </div>
  );
}
