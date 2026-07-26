import { useAuth } from '../hooks/useAuth';
import { fmtRelative } from '../lib/format';
import { useWsStore } from '../state/wsStore';

export function Home(): JSX.Element {
  const { user } = useAuth();
  const presenceCount = useWsStore((state) => state.presenceCount);
  const queue = useWsStore((state) => state.queue);
  const welcome = useWsStore((state) => state.welcome);

  if (user === null) {
    return (
      <div className="app-shell">
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <section className="card">
          <div className="card-inner stack">
            <div>
              <div className="eyebrow">Session online</div>
              <div className="card-title">
                Signed in as <b>{user.displayName}</b>
              </div>
              <div className="card-sub">Your auth cookie is active and ready for lobby/combat traffic.</div>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {user.isAdmin ? <span className="pill">Admin</span> : null}
              <span className="status-chip status--party">
                <span className="status-dot" />
                Presence <b>{presenceCount}</b>
              </span>
              <span className="status-chip status--training">
                <span className="status-dot" />
                Active matches <b>{welcome?.activeMatches ?? 0}</b>
              </span>
              <span className="status-chip">
                Queue <b>{queue.status}</b>
                <span className="note">size {queue.size}</span>
              </span>
            </div>
            <div className="card-sub">
              {queue.since === null ? 'Queue is idle.' : `Queued ${fmtRelative(queue.since)}.`}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
