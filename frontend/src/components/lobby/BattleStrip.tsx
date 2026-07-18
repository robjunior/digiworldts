import type { QueueStatus, WSClientMessage } from '@digiworld/shared/ws';

export type BattleStripProps = {
  readonly status: QueueStatus;
  readonly since: number | null;
  readonly size: number;
  readonly partyReady: boolean;
  readonly send: (msg: WSClientMessage) => void;
};

export function BattleStrip({ status, since, size, partyReady, send }: BattleStripProps): JSX.Element {
  const waiting = status === 'waiting';
  return (
    <>
      <div className="row spread" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Matchmaking</h2>
        <span className={queueStatusClass(status)}>{queueStatusText(status)}</span>
      </div>
      <div className="bracket-line" role="status" aria-live="polite">
        <span>Bracket</span>
        <span>
          <b>±5 levels</b> · {size} queued
        </span>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button
          className={waiting ? 'btn btn--wide queue-btn is-waiting' : 'btn btn--wide queue-btn'}
          type="button"
          data-od-id="btn-queue"
          disabled={!partyReady || status === 'matched'}
          onClick={() => send({ type: 'queue', join: !waiting })}
        >
          {queueButtonText(status, since)}
        </button>
      </div>
      <div className={partyReady ? 'reserved-hint' : 'reserved-hint is-warn'} role="status" aria-live="polite">
        {partyReady ? '' : 'Assign 3 Digimon to queue'}
      </div>
    </>
  );
}

function queueStatusClass(status: QueueStatus): string {
  switch (status) {
    case 'idle':
      return 'queue-status';
    case 'waiting':
      return 'queue-status is-waiting';
    case 'matched':
      return 'queue-status is-matched';
    default:
      status satisfies never;
      return 'queue-status';
  }
}

function queueStatusText(status: QueueStatus): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'waiting':
      return 'Searching…';
    case 'matched':
      return 'Match found';
    default:
      status satisfies never;
      return 'Idle';
  }
}

function queueButtonText(status: QueueStatus, since: number | null): string {
  switch (status) {
    case 'idle':
      return 'Enter Queue';
    case 'waiting':
      return since === null ? 'Cancel Queue' : `Cancel Queue (${elapsed(since)})`;
    case 'matched':
      return 'Match Found';
    default:
      status satisfies never;
      return 'Enter Queue';
  }
}

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}
