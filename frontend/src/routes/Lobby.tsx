import { useQuery } from '@tanstack/react-query';

import { AppNav } from '../components/AppNav';

import { PageStrip } from '../components/common/PageStrip';
import { BattleStrip } from '../components/lobby/BattleStrip';
import { ChatDrawer } from '../components/lobby/ChatDrawer';
import { DAILY_QUERY_KEY, DailyStrip } from '../components/lobby/DailyStrip';
import { LastMatch } from '../components/lobby/LastMatch';
import { PartyHero } from '../components/lobby/PartyHero';
import { PresenceList } from '../components/lobby/PresenceList';
import { RoomsPanel } from '../components/lobby/RoomsPanel';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { getDaily, getLastMatch, getRoster } from '../lib/api';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-lobby.css';

const ROSTER_QUERY_KEY = ['roster'] as const;
const LAST_MATCH_QUERY_KEY = ['last-match'] as const;

export function Lobby(): JSX.Element {
  const { user, logout } = useAuth();
  const { send } = useWebSocket();
  const presence = useWsStore((state) => state.presence);
  const presenceCount = useWsStore((state) => state.presenceCount);
  const chat = useWsStore((state) => state.chat);
  const queue = useWsStore((state) => state.queue);
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const dailyQuery = useQuery({ queryKey: DAILY_QUERY_KEY, queryFn: getDaily });
  const lastMatchQuery = useQuery({ queryKey: LAST_MATCH_QUERY_KEY, queryFn: getLastMatch, retry: false });
  const roster = rosterQuery.data?.roster ?? [];
  const filledParty = roster.filter((mon) => mon.status === 'party').length;
  const partyReady = filledParty >= 3;
  const dailyStatus = dailyQuery.data?.canClaim === true ? `Day ${dailyQuery.data.wouldGrantDay} ready to claim` : 'Daily claimed';

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main" data-od-id="lobby-main">
        <PageStrip
          name="Lobby"
          tone={partyReady ? 'reward' : 'warn'}
          metrics={[
            { label: <><b>{presenceCount}</b> online</> },
            { label: <><b>{queue.size}</b> queued</> },
            { label: <><b>{filledParty}</b>/3 party</> },
            { label: dailyStatus, className: dailyQuery.data?.canClaim === true ? 'reward' : 'muted' },
          ]}
          actions={<span className="mono muted" style={{ fontSize: 10 }}>Streak <b>{dailyQuery.data?.streakDay ?? 0}d</b></span>}
        />
        <div className="lobby-grid-v2" data-od-id="lobby-grid">
          <aside className="lobby-col-v2 lobby-left" data-od-id="lobby-left">
            <section className="lobby-section" data-od-id="presence-section">
              <h2>Online players</h2>
              <PresenceList users={presence} />
            </section>
          </aside>
          <section className="lobby-col-v2 lobby-center" data-od-id="lobby-center">
            <section className="lobby-section" data-od-id="party-section">
              <div className="row spread" style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Your party</h2>
                <a className="btn btn--secondary btn--sm" href="/roster">Edit</a>
              </div>
              <PartyHero roster={roster} />
            </section>
            <section className="lobby-section matchmaking-strip" data-od-id="queue-section">
              <BattleStrip status={queue.status} since={queue.since} size={queue.size} partyReady={partyReady} send={send} />
            </section>
            <section className="lobby-section" data-od-id="last-match-section">
              <h2>Last match</h2>
              <LastMatch match={lastMatchQuery.data ?? null} />
            </section>
          </section>
          <aside className="lobby-col-v2 lobby-right" data-od-id="lobby-right">
            <section className="lobby-section" data-od-id="daily-section">
              <h2>Daily reward</h2>
              <DailyStrip daily={dailyQuery.data ?? null} />
            </section>
            <section className="lobby-section objectives-section" data-od-id="objectives-section">
              <h2>Objectives</h2>
              <ul aria-label="Daily objectives" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <Objective color="var(--claim-done)" text="Log in today" />
                <Objective color="var(--claim-done)" text="Feed a digimon" />
                <Objective color="var(--claim-next)" text="Win 1 match today (0/1)" />
                <Objective color="var(--claim-todo)" text="Reach player level 15" />
              </ul>
            </section>
            <section className="lobby-section" data-od-id="rooms-section">
              <RoomsPanel send={send} />
            </section>
          </aside>
        </div>
      </main>
      <ChatDrawer onlineCount={presenceCount} chat={chat} send={send} />
    </div>
  );
}

function Objective({ color, text }: { readonly color: string; readonly text: string }): JSX.Element {
  return (
    <li className="row" style={{ gap: 8 }}>
      <span className="dot" style={{ width: 6, height: 6, background: color, borderRadius: '50%' }} />
      {text}
    </li>
  );
}
