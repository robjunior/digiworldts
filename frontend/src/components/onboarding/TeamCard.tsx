import type { OnboardingTeamView } from '../../lib/api-onboarding';
import { MonTile } from './MonTile';

type TeamCardProps = {
  readonly team: OnboardingTeamView;
  readonly selected: boolean;
  readonly onSelect: (team: OnboardingTeamView) => void;
};

export function TeamCard({ team, selected, onSelect }: TeamCardProps): JSX.Element {
  return (
    <button
      type="button"
      className={selected ? 'team-card is-selected' : 'team-card'}
      id={`team-${team.id}`}
      onClick={() => onSelect(team)}
      aria-disabled={selected}
    >
      <h3 className="team-name">{team.name}</h3>
      <p className="team-desc">{team.description}</p>
      <div className="team-mons">
        {team.mons.map((mon) => (
          <MonTile key={mon.catalogId} mon={mon} />
        ))}
      </div>
    </button>
  );
}
