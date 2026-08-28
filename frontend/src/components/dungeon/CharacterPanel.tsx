type CharacterPanelProps = {
  readonly username: string;
};

export function CharacterPanel({ username }: CharacterPanelProps): JSX.Element {
  return (
    <div className="character-panel">
      <div className="character-row">
        <span className="character-label">Tamer</span>
        <span className="character-value">{username}</span>
      </div>
      <div className="character-row">
        <span className="character-label">Classe</span>
        <span className="character-value">—</span>
      </div>
      <div className="character-row">
        <span className="character-label">Rank</span>
        <span className="character-value">—</span>
      </div>
    </div>
  );
}
