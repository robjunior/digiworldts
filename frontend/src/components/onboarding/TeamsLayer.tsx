import type { OnboardingTeamView } from '../../lib/api-onboarding';
import { TeamCard } from './TeamCard';

type TeamsLayerProps = {
  readonly teams: readonly OnboardingTeamView[];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly selectedTeamId: string | null;
  readonly onSelect: (team: OnboardingTeamView) => void;
};

export function TeamsLayer({ teams, visible, locked, selectedTeamId, onSelect }: TeamsLayerProps): JSX.Element {
  const layerClassName = [visible ? 'is-active' : 'hidden', locked ? 'is-locked' : ''].filter(Boolean).join(' ');
  const enabledTeams = teams.filter((team) => team.enabled).toSorted((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  return (
    <div id="teams-layer" className={layerClassName}>
      {enabledTeams.map((team) => (
        <TeamCard key={team.id} team={team} selected={team.id === selectedTeamId} onSelect={onSelect} />
      ))}
    </div>
  );
}
