import type { PresenceUser } from '@digiworld/shared/ws';

export type PresenceListProps = {
  readonly users: readonly PresenceUser[];
};

export function PresenceList({ users }: PresenceListProps): JSX.Element {
  return (
    <div className="presence-list">
      {users.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 4px' }}>
          You're alone here for now — invite a friend or start a match.
        </div>
      ) : (
        users.map((user) => (
          <div className="presence-row" key={user.userId}>
            <span className="dot" aria-hidden="true" />
            <div>
              <div className="name">{user.displayName}</div>
              <div className="meta">Online</div>
            </div>
            <span />
          </div>
        ))
      )}
    </div>
  );
}
