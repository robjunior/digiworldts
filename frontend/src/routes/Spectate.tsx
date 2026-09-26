import type { BattleEvent, BattleView } from '@digiworld/shared/battle';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useWebSocket } from '../hooks/useWebSocket';
import { ApiError, battleSpectate } from '../lib/api';
import { useWsStore } from '../state/wsStore';

type SpectateStatus = 'loading' | 'ok' | 'not-found' | 'full' | 'error';

export function Spectate(): JSX.Element {
  const [params] = useSearchParams();
  const matchId = params.get('matchId') ?? '';
  const { send, readyState } = useWebSocket();
  const activeBattle = useWsStore((s) => s.activeBattle);
  const activeMatchId = useWsStore((s) => s.activeMatchId);
  const battleEvents = useWsStore((s) => s.battleEvents);
  const clearActiveBattle = useWsStore((s) => s.clearActiveBattle);

  const [status, setStatus] = useState<SpectateStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [spectatorCount, setSpectatorCount] = useState<number | null>(null);

  useEffect(() => {
    if (matchId.length === 0) {
      setStatus('error');
      setErrorMessage('Missing matchId in URL.');
      return;
    }
    let cancelled = false;
    battleSpectate(matchId)
      .then((response) => {
        if (cancelled) return;
        setStatus('ok');
        setSpectatorCount(response.spectatorCount);
        useWsStore.setState({
          activeMatchId: response.matchId,
          activeBattle: response.view,
          battleEvents: response.view.log.slice(-100),
          battleOutcome: response.view.outcome,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus('not-found');
        } else {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      });
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    if (matchId.length === 0 || readyState !== 1) return;
    send({ type: 'spectate', matchId, join: true });
    return () => {
      send({ type: 'spectate', matchId, join: false });
      clearActiveBattle();
    };
  }, [matchId, readyState, send, clearActiveBattle]);

  if (status === 'loading') {
    return <ShellMessage title="Spectate" body="Loading match…" />;
  }
  if (status === 'not-found') {
    return <ShellMessage title="Match not found" body={`No live match with id ${matchId}.`} />;
  }
  if (status === 'error') {
    return <ShellMessage title="Spectate failed" body={errorMessage} />;
  }
  const battle = activeMatchId === matchId ? activeBattle : null;
  if (!battle) {
    return <ShellMessage title="Waiting for battle state…" body="Live updates should arrive shortly." />;
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="Spectator view" style={{ maxWidth: 720 }}>
        <div className="auth-card-in">
          <div>
            <div className="eyebrow">Spectating {matchId}</div>
            <h1>
              Round {battle.round} — {formatStatus(battle.status, battle.outcome)}
            </h1>
            <p className="lede">
              {battle.currentTurnUnitId ? `Current turn: ${battle.currentTurnUnitId}` : 'No active turn.'}
              {typeof spectatorCount === 'number' ? ` · ${spectatorCount} spectator${spectatorCount === 1 ? '' : 's'}` : null}
            </p>
          </div>

          <TeamBlock label="Team A (friendly view)" units={battle.friendly} showFullStats />
          <TeamBlock label="Team B" units={battle.enemy} showFullStats={false} />

          <EventList events={battleEvents} />

          <Link to="/" className="btn btn--wide" style={{ marginTop: 12 }}>
            Leave spectator mode
          </Link>
        </div>
      </section>
    </main>
  );
}

function ShellMessage({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label={title}>
        <div className="auth-card-in">
          <h1>{title}</h1>
          <p className="lede">{body}</p>
          <Link className="btn btn--wide" to="/">Return to lobby</Link>
        </div>
      </section>
    </main>
  );
}

type UnitLike = {
  id: string;
  name: string;
  level: number;
  hp: number;
  hpMax: number;
  ailments?: readonly { kind: string; turnsLeft: number }[];
};

function TeamBlock({ label, units, showFullStats: _showFullStats }: { label: string; units: readonly UnitLike[]; showFullStats: boolean }): JSX.Element {
  return (
    <div className="stack" style={{ gap: 6, marginTop: 12 }}>
      <div className="eyebrow">{label}</div>
      {units.map((u) => {
        const pct = u.hpMax > 0 ? Math.max(0, Math.min(1, u.hp / u.hpMax)) : 0;
        const barLen = 20;
        const filled = Math.round(pct * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        const ailments = (u.ailments ?? []).map((a) => `${a.kind}(${a.turnsLeft})`).join(', ');
        return (
          <div key={u.id} style={{ fontFamily: 'monospace', fontSize: 13 }}>
            <span>{u.name} L{u.level}</span>
            <span style={{ opacity: 0.7 }}>  [{bar}] {u.hp}/{u.hpMax}</span>
            {ailments ? <span style={{ color: '#c66' }}>  {ailments}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function EventList({ events }: { events: readonly BattleEvent[] }): JSX.Element {
  const recent = events.slice(-15);
  return (
    <div className="stack" style={{ gap: 4, marginTop: 12 }}>
      <div className="eyebrow">Recent events (last {recent.length})</div>
      <div style={{ maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, opacity: 0.85 }}>
        {recent.map((e, i) => (
          <div key={`${e.at}-${i}`}>
            R{e.round} · {e.type}
            {'actor' in e && e.actor ? ` — actor ${e.actor}` : null}
            {'target' in e && e.target ? ` → ${e.target}` : null}
            {'damage' in e && typeof e.damage === 'number' ? ` (${e.damage} dmg)` : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatStatus(status: BattleView['status'], outcome: BattleView['outcome']): string {
  if (status === 'ended') return `Ended — ${outcome ?? 'unknown'}`;
  if (status === 'awaiting-loadout') return 'Awaiting loadout';
  return 'In progress';
}
