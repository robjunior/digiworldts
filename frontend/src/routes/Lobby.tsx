import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect, type FormEvent } from 'react';

import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { getLastMatch, getRoster, type LastMatchSummary } from '../lib/api';
import { getPvpQuests, claimPvpQuest } from '../lib/api-pvp-quests';
import { useWsStore } from '../state/wsStore';
import { DigimonSprite } from '../components/common/DigimonSprite';
import '../styles/extensions-lobby.css';

const ROSTER_QUERY_KEY = ['roster'] as const;
const LAST_MATCH_QUERY_KEY = ['last-match'] as const;

function normalizeOutcome(outcome: LastMatchSummary['outcome']): 'win' | 'loss' | 'draw' | 'fled' {
  switch (outcome) {
    case 'win_a':
    case 'win_b':
    case 'captured_a':
    case 'win':
      return 'win';
    case 'fled_a':
    case 'fled_b':
    case 'fled':
      return 'fled';
    case 'abandoned':
    case 'draw':
      return 'draw';
    case 'loss':
      return 'loss';
    default:
      return 'draw';
  }
}

/* ── game modes ─────────────────────────────────────────────────────── */
type GameMode = 'ranked' | 'casual' | 'tournament' | 'training';

const GAME_MODES: { id: GameMode; label: string; meta: string; live?: boolean }[] = [
  { id: 'ranked', label: 'Ranked', meta: '3v3 · ELO', live: true },
  { id: 'casual', label: 'Casual', meta: '3v3 · Unranked' },
  { id: 'tournament', label: 'Tournament', meta: 'Single Elim', live: true },
  { id: 'training', label: 'Training', meta: 'vs CPU' },
];

const MODE_LABELS: Record<GameMode, string> = {
  ranked: 'Ranked 3v3',
  casual: 'Casual 3v3',
  tournament: 'Tournament',
  training: 'Training Mode',
};

const MODE_DESCS: Record<GameMode, string> = {
  ranked: 'Competitive matches with ELO-based ranking. Climb the ladder to earn seasonal rewards.',
  casual: 'Unranked matches for practice. No ELO impact, same 3v3 combat.',
  tournament: 'Single-elimination bracket. Win to advance, lose and you\'re out.',
  training: 'Battle against AI opponents to test strategies and practice rotations.',
};

/* ── mode icons ─────────────────────────────────────────────────────── */
function ModeIcon({ mode }: { mode: GameMode }) {
  const cn = mode === 'ranked' ? 'gold' : mode === 'casual' ? 'blue' : mode === 'tournament' ? 'red' : 'green';
  const paths: Record<GameMode, string> = {
    ranked: 'M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z',
    casual: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
    tournament: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z',
    training: 'M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83',
  };
  return (
    <span className={`mc-ico ${cn}`}>
      <svg viewBox="0 0 24 24"><path d={paths[mode]} strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

/* ── main component ─────────────────────────────────────────────────── */
export function Lobby(): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();
  const presenceCount = useWsStore((state) => state.presenceCount);
  const chat = useWsStore((state) => state.chat);
  const queue = useWsStore((state) => state.queue);
  const invalidatePvpQuests = useWsStore((state) => state.invalidatePvpQuests);
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const lastMatchQuery = useQuery({ queryKey: LAST_MATCH_QUERY_KEY, queryFn: getLastMatch, retry: false });
  const pvpQuery = useQuery({
    queryKey: ['pvp-quests'] as const,
    queryFn: getPvpQuests,
    enabled: true,
    staleTime: 30_000,
  });

  const activeBattle = useWsStore((state) => state.activeBattle);
  useEffect(() => {
    if (activeBattle?.status === 'ended') {
      invalidatePvpQuests();
      pvpQuery.refetch();
    }
  }, [activeBattle?.status, invalidatePvpQuests, pvpQuery]);

  const roster = rosterQuery.data?.roster ?? [];
  const partySlots = [0, 1, 2].map((slot) => roster.find((mon) => mon.status === 'party' && mon.slot === slot) ?? null);
  const filledParty = partySlots.filter(Boolean).length;
  const partyReady = filledParty >= 3;

  // mode selection
  const [activeMode, setActiveMode] = useState<GameMode>('ranked');

  // chat state
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [activeChannel, setActiveChannel] = useState('General');
  const chatLogRef = useRef<HTMLDivElement>(null);

  // social rail tabs
  const [socialTab, setSocialTab] = useState<'chat' | 'quests' | 'friends'>('chat');

  // quest modal state
  const [questModalOpen, setQuestModalOpen] = useState(false);

  // friends state
  const [friendSearch, setFriendSearch] = useState('');
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addFriendSearch, setAddFriendSearch] = useState('');
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  // friends data (mock for now - would come from API)
  const [friends, setFriends] = useState([
    { id: '1', displayName: 'Yusuke', avatar: 'Y', online: true, status: 'online' },
    { id: '2', displayName: 'Ryu', avatar: 'R', online: true, status: 'in_game_ranked' },
    { id: '3', displayName: 'Ken', avatar: 'K', online: true, status: 'online' },
    { id: '4', displayName: 'Akira', avatar: 'A', online: false, status: 'offline' },
    { id: '5', displayName: 'Mika', avatar: 'M', online: false, status: 'offline' },
  ]);
  const [friendRequests, setFriendRequests] = useState([
    { displayName: 'Morgana', avatar: 'M' },
  ]);

  // searchable tamers for add friend
  const searchableTamers = ['Morgana', 'Igor', 'Caroline', 'Justine', 'Sojiro', 'Takemi', 'Kawakami', 'Iwai', 'Munehisa', 'Chihaya', 'Shinya', 'Hifumi'];

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chat]);

  const onChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    const txt = chatInput.trim();
    if (!txt) return;
    if (activeChannel === 'General') {
      send({ type: 'chat', text: txt });
    } else {
      send({ type: 'chat', text: txt, room: activeChannel });
    }
    setChatInput('');
  };

  const isQueued = queue.status === 'waiting' || queue.status === 'matched';

  const lm = lastMatchQuery.data;
  let lastMatchOutcome: 'win' | 'loss' | 'draw' | 'fled' = 'draw';
  if (lm) {
    lastMatchOutcome = normalizeOutcome(lm.outcome);
  }

  const availableCount =
    pvpQuery.data?.periods.reduce((acc, w) => {
      return acc + w.quests.filter((q) => q.state === 'completed' && q.claimedAt === null).length;
    }, 0) ?? 0;

  // chat is single global log for now; channel tabs are UI-only until rooms are wired
  const filteredChat = chat;

  // quest modal
  const pvpWindow = pvpQuery.data?.periods.find((w) => w.period === 'DAILY');
  const quests = pvpWindow?.quests ?? [];
  const [claiming, setClaiming] = useState<string | null>(null);

  const handleClaim = async (instanceId: string) => {
    if (!pvpWindow) return;
    setClaiming(instanceId);
    try {
      const result = await claimPvpQuest('DAILY', pvpWindow.windowId, instanceId);
      if (result.ok) {
        await pvpQuery.refetch();
      }
    } catch {
      // keep existing state
    } finally {
      setClaiming(null);
    }
  };

  // friends filtering
  const filteredFriends = friends.filter(
    (f) => !friendSearch || f.displayName.toLowerCase().includes(friendSearch.toLowerCase()),
  );
  const onlineFriends = filteredFriends.filter((f) => f.online);
  const offlineFriends = filteredFriends.filter((f) => !f.online);

  const handleOpenDm = (displayName: string) => {
    setActiveChannel(`DM: ${displayName}`);
    setSocialTab('chat');
  };

  const handleRemoveFriend = (id: string) => {
    setFriends((prev) => prev.filter((f) => f.id !== id));
  };

  const handleAcceptRequest = (displayName: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.displayName !== displayName));
    setFriends((prev) => [...prev, { id: String(Date.now()), displayName, avatar: displayName[0] ?? 'U', online: true, status: 'online' }]);
  };

  const handleDeclineRequest = (displayName: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.displayName !== displayName));
  };

  const handleSendRequest = (displayName: string) => {
    setSentRequests((prev) => new Set(prev).add(displayName));
  };

  const filteredTamers = searchableTamers.filter(
    (name) =>
      name.toLowerCase().includes(addFriendSearch.toLowerCase()) &&
      !friends.some((f) => f.displayName === name) &&
      !friendRequests.some((r) => r.displayName === name),
  );

  // dark theme: add class to body for bg override
  useEffect(() => {
    document.documentElement.classList.add('is-lobby');
    document.body.classList.add('is-lobby');
    return () => {
      document.documentElement.classList.remove('is-lobby');
      document.body.classList.remove('is-lobby');
    };
  }, []);

  return (
    <div className="lobby-shell">
      {/* ── TOP BAR ──────────────────────────────────────────────── */}
      <header className="topbar" role="banner">
        <span className="app-mark">
          <span className="bit">Digi</span>World
        </span>

        <nav className="tnav" aria-label="Main">
          <button className="tnav-btn" aria-current="page">Home</button>
          <button className="tnav-btn">Play</button>
          <button className="tnav-btn">Collection</button>
          <button className="tnav-btn">Explore</button>
          <button className="tnav-btn">Shop</button>
        </nav>

        <div className="battle-center">
          <button
            className="battle-btn"
            onClick={() => {
              if (isQueued) {
                send({ type: 'queue', join: false });
              } else if (partyReady) {
                send({ type: 'queue', join: true });
              }
            }}
            disabled={!partyReady && !isQueued}
            aria-label={isQueued ? 'Leave queue' : `Find ${MODE_LABELS[activeMode]} match`}
          >
            <span className="b-glow" aria-hidden="true" />
            <span className="b-ico">
              <svg viewBox="0 0 24 24"><path d="M6.92 5L5 6.92l2.5 2.5L5 11.92 7.5 14.42l2.5-2.5 2.5 2.5 2.5-2.5-2.5-2.5 2.5-2.5L13 5l-2.5 2.5L8 5z" /></svg>
            </span>
            {isQueued ? 'Stop' : 'Battle'}
          </button>
        </div>

        <div className="topright">
          <div className="wallet">
            <span className="wc"><span className="dot cred" aria-hidden="true" /> <span className="am">4,820</span></span>
            <span className="wc"><span className="dot bits" aria-hidden="true" /> <span className="am b">12.4k</span></span>
          </div>

          <span className="streak-pill">
            <span className="sv">▲</span>
            <span className="sn">4d</span>
          </span>

          <button className="tb-av" aria-label="Tamer profile">{user?.displayName?.[0] ?? 'T'}</button>
        </div>
      </header>

      {/* ── BODY ─────────────────────────────────────────────────── */}
      <div className="body">
        {/* LEFT MAIN CONTENT */}
        <main className="main">
          {/* hero banner */}
          <section className="hero" data-od-id="hero-banner">
            {/* mode strip */}
            <div className="mode-strip" role="tablist" aria-label="Game mode">
              {GAME_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mode-card${activeMode === mode.id ? ' active' : ''}`}
                  onClick={() => setActiveMode(mode.id)}
                  role="tab"
                  aria-selected={activeMode === mode.id}
                >
                  {mode.live && <span className="mc-tag live">LIVE</span>}
                  <ModeIcon mode={mode.id} />
                  <span className="mc-nm">{mode.label}</span>
                  <span className="mc-meta">{mode.meta}</span>
                </button>
              ))}
            </div>

            {/* hero content */}
            <div className="hero-row">
              <div className="h-tx">
                <div className="h-kick">Arena Queue · {MODE_LABELS[activeMode]}</div>
                <h1 className="h-title">Find a Match</h1>
                <p className="h-sub">{MODE_DESCS[activeMode]}</p>
                <div className="h-meta">
                  <span className="h-chip">Bracket <b>±5 Lv</b></span>
                  <span className="h-chip">±100 trained</span>
                  <span className="h-chip gold">Widens over time</span>
                </div>
                <div className="h-cta">
                  <button
                    className={`findbtn ${isQueued ? 'searching' : ''}`}
                    disabled={!partyReady && !isQueued}
                    onClick={() => {
                      if (partyReady) send({ type: 'queue', join: !isQueued });
                    }}
                  >
                    {isQueued ? 'Searching…' : 'Find Match'}
                  </button>
                  {isQueued && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Matching by bracket…</span>}
                </div>
              </div>

              {/* party display */}
              <div className="h-party">
                <span className="party-label">Your Party</span>
                <div className="party-slots">
                  {partySlots.map((mon, i) => (
                    <div key={i} className="pslot">
                      {mon ? (
                        <>
                          <DigimonSprite catalogId={mon.catalogId} />
                          <span className="lv">Lv{mon.level}</span>
                        </>
                      ) : (
                        <span className="mono">?</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* content grid */}
          <div className="content-grid">
            {/* daily reward */}
            <div className="daily-mini">
              <div className="dm-ico">
                <span className="rico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" width="22" height="22"><path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" /></svg>
                </span>
              </div>
              <div className="dm-tx">
                <div className="dm-day">Daily Reward · Day 4 of 7</div>
                <div className="dm-rew">50 Meat + 200 Bits</div>
                <div className="dm-sub">Claim before midnight to keep your streak</div>
              </div>
              <div className="dm-pips">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <span key={d} className={`dm-pip${d < 4 ? ' claimed' : d === 4 ? ' today' : ''}`}>{d}</span>
                ))}
              </div>
              <button className="dm-claim">Claim</button>
            </div>

            {/* quick actions */}
            <div>
              <div className="card-hd">
                <span className="k">Quick Actions</span>
              </div>
              <div className="qgrid">
                {[
                  { name: 'Adventure', href: '/adventure', status: 'Explore the overworld', icon: 'M12 2C8 6 4 10 4 14c0 4 3.6 8 8 8s8-4 8-8c0-4-4-8-8-12z M12 18c-2 0-4-2-4-4s2-4 4-4 4 2 4 4-2 4-4 4z' },
                  { name: 'Farm', href: '/farm', status: 'Collect resources', icon: 'M12 22V8 M12 8c0-3 2-6 5-6s5 3 5 6-2 5-5 5 M12 8c0-3-2-6-5-6S2 5 2 8s2 5 5 5' },
                  { name: 'Training', href: '/training', status: 'Boost stats', icon: 'M2 12l5-5 3 3 4-4 5 5 M2 19l5-5 3 3 4-4 5 5' },
                  { name: 'Nursery', href: '/nursery', status: 'Hatch eggs', icon: 'M12 22c4-4 8-8 8-13a8 8 0 1 0-16 0c0 5 4 9 8 13z M12 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6z' },
                  { name: 'Roster', href: '/roster', status: 'Manage party', icon: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z M4 21a8 8 0 0 1 16 0' },
                ].map((qa) => (
                  <a key={qa.name} className="qa" href={qa.href}>
                    <div className="qa-top">
                      <div className="qa-tile">
                        <svg className="qa-ic" viewBox="0 0 24 24"><path d={qa.icon} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                      </div>
                      <span className="qa-badge idle">→</span>
                    </div>
                    <span className="qa-nm">{qa.name}</span>
                    <span className="qa-st">{qa.status}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* live matches */}
            <div className="card">
              <div className="card-hd">
                <span className="k">Live Matches</span>
                <span className="v">2 playing</span>
              </div>
              <div className="list">
                <div className="match">
                  <div className="side">
                    <span className="who">Yusuke</span>
                    <div className="pips">
                      {['Greymon', 'Garurumon', 'WereGarurumon'].map((s) => (
                        <span key={s} className="mp"><DigimonSprite catalogId={s.toLowerCase()} /></span>
                      ))}
                    </div>
                  </div>
                  <span className="vsdot">vs</span>
                  <div className="side r">
                    <span className="who">Ryu</span>
                    <div className="pips r">
                      {['MetalGreymon', 'SkullGreymon', 'Garurumon'].map((s) => (
                        <span key={s} className="mp"><DigimonSprite catalogId={s.toLowerCase()} /></span>
                      ))}
                    </div>
                  </div>
                  <button className="watch" aria-label="Watch Yusuke vs Ryu">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    Watch
                  </button>
                </div>
                <div className="match">
                  <div className="side">
                    <span className="who">Ken</span>
                    <div className="pips">
                      {['Patamon', 'Angemon', 'MagnaAngemon'].map((s) => (
                        <span key={s} className="mp"><DigimonSprite catalogId={s.toLowerCase()} /></span>
                      ))}
                    </div>
                  </div>
                  <span className="vsdot">vs</span>
                  <div className="side r">
                    <span className="who">Akira</span>
                    <div className="pips r">
                      {['Gabumon', 'Garurumon', 'MetalGarurumon'].map((s) => (
                        <span key={s} className="mp"><DigimonSprite catalogId={s.toLowerCase()} /></span>
                      ))}
                    </div>
                  </div>
                  <button className="watch" aria-label="Watch Ken vs Akira">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    Watch
                  </button>
                </div>
              </div>
            </div>

            {/* online now */}
            <div className="card">
              <div className="card-hd">
                <span className="k">Online Now</span>
                <span className="v">{presenceCount} in plaza</span>
              </div>
              <div className="list">
                {presenceCount === 0 ? (
                  <div className="empty-line">You're alone here for now — invite a friend or start a match.</div>
                ) : (
                  friends.filter((f) => f.online).map((f) => (
                    <div key={f.id} className="row">
                      <span className="dot" aria-hidden="true" />
                      <span className="nm">{f.displayName}</span>
                      <span className="tag">{f.status === 'in_game_ranked' ? 'In Game · Ranked' : 'Online'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* last match */}
            <div>
              <div className="card-hd">
                <span className="k">Last Match</span>
              </div>
              {!lm ? (
                <div className="empty-line">Play your first match to see rewards here.</div>
              ) : (
                <div className={`lastmatch ${lastMatchOutcome === 'win' ? 'win' : ''}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'var(--panel2)', border: '1px solid var(--hair)', clipPath: 'var(--notch-sm)' }}>
                  <span style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase' }}>{lastMatchOutcome === 'win' ? 'Victory' : lastMatchOutcome === 'loss' ? 'Defeat' : lastMatchOutcome === 'fled' ? 'Fled' : 'Draw'}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>vs <b style={{ color: 'var(--ink)' }}>{lm.opponent ?? 'Unknown'}</b></span>
                  <span style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)' }}>+{lm.rewards?.credits ?? 0} Bits · +{lm.rewards?.xp ?? 0} XP</span>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* RIGHT SOCIAL RAIL */}
        <aside className="social" data-od-id="social-rail">
          <div className="stabs" role="tablist">
            <button
              className="stab"
              role="tab"
              aria-selected={socialTab === 'chat'}
              onClick={() => setSocialTab('chat')}
            >
              Chat
              {activeChannel !== 'General' && <span className="rt-badge">1</span>}
            </button>
            <button
              className="stab"
              role="tab"
              aria-selected={socialTab === 'quests'}
              onClick={() => setSocialTab('quests')}
            >
              Quests
              {availableCount > 0 && <span className="rt-badge">{availableCount}</span>}
            </button>
            <button
              className="stab"
              role="tab"
              aria-selected={socialTab === 'friends'}
              onClick={() => setSocialTab('friends')}
            >
              Friends
              <span className="rt-badge">{friends.length}</span>
            </button>
          </div>

          {/* CHAT PANEL */}
          <div className="spanel" hidden={socialTab !== 'chat'}>
            <div className="chat">
              <div className="chat-channels" role="tablist" aria-label="Chat channels">
                {['General', 'Team', 'Trade'].map((ch) => (
                  <button
                    key={ch}
                    className="ch-btn"
                    role="tab"
                    aria-current={activeChannel === ch || (ch === 'General' && activeChannel.startsWith('DM:'))}
                    onClick={() => setActiveChannel(ch)}
                  >
                    {ch}
                  </button>
                ))}
                {activeChannel.startsWith('DM:') && (
                  <button className="ch-btn" role="tab" aria-current="true" onClick={() => setActiveChannel(activeChannel)}>
                    {activeChannel}
                  </button>
                )}
              </div>

              <div className="chatlog" role="log" aria-live="polite" aria-label="Chat" ref={chatLogRef}>
                {filteredChat.length === 0 ? (
                  <div className="empty-line">No messages yet — say hi to start.</div>
                ) : (
                  filteredChat.map((m) => {
                    const isMe = m.from === user?.id;
                    return (
                      <div
                        key={m.from + m.at + m.text.slice(0, 10)}
                        className="msg"
                      >
                        <span className="ts">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={`who${isMe ? ' me' : ''}`}>
                          {m.displayName}{isMe ? ' (you)' : ''}
                        </span>
                        <span className="tx">{m.text}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <form className="chatform" onSubmit={onChatSubmit}>
                <input
                  type="text"
                  placeholder={`Message ${activeChannel.startsWith('DM:') ? activeChannel.slice(4) : activeChannel}…`}
                  autoComplete="off"
                  maxLength={240}
                  aria-label="Chat message"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" disabled={!chatInput.trim()}>Send</button>
              </form>
            </div>
          </div>

          {/* QUESTS PANEL */}
          <div className="spanel" hidden={socialTab !== 'quests'}>
            <div className="quests">
              <div className="q-section">
                <div className="q-section-hd">
                  <span className="k">Daily <span className="n">({quests.filter((q) => q.state === 'completed').length}/{quests.length})</span></span>
                </div>
                {quests.length === 0 ? (
                  <div className="empty-line">No daily quests right now — check back soon.</div>
                ) : (
                  quests.map((q) => {
                    const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
                    const done = q.state === 'completed';
                    const claimed = q.state === 'claimed';
                    return (
                      <div key={q.instanceId} className="quest">
                        <span className="q-ico">
                          <svg className={`q-ic ${done ? 'gold' : 'blue'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" /></svg>
                        </span>
                        <div className="q-tx">
                          <div className="q-nm">{q.title}</div>
                          <div className="q-desc">{q.title}</div>
                          <div className="q-prog"><span className="fill" style={{ width: `${pct}%` }} /></div>
                        </div>
                        <span className={`q-count${done ? ' done' : ''}`}>{q.progress}/{q.target}</span>
                        {done && !claimed && (
                          <button className="q-claim" disabled={claiming === q.instanceId} onClick={() => handleClaim(q.instanceId)}>
                            {claiming === q.instanceId ? 'Claiming…' : 'Claim'}
                          </button>
                        )}
                        {claimed && <span className="q-claim done">Claimed</span>}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* FRIENDS PANEL */}
          <div className="spanel" hidden={socialTab !== 'friends'} style={{ position: 'relative' }}>
            <div className="friends">
              <div className="friends-toolbar">
                <input
                  type="text"
                  placeholder="Search friends…"
                  value={friendSearch}
                  onChange={(e) => setFriendSearch(e.target.value)}
                  aria-label="Search friends"
                />
                <button className="add-friend-btn" onClick={() => setAddFriendOpen(true)}>
                  <svg viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14" strokeLinecap="round" /></svg>
                  Add
                </button>
              </div>

              {/* friend requests */}
              {friendRequests.length > 0 && (
                <div className="friends-section">
                  <div className="friends-section-hd">
                    <span className="k">Friend Requests <span className="n">({friendRequests.length})</span></span>
                  </div>
                  {friendRequests.map((r) => (
                    <div key={r.displayName} className="friend-request-row">
                      <span className="friend-av">{r.avatar}</span>
                      <div className="friend-info">
                        <div className="friend-nm">{r.displayName}</div>
                        <div className="friend-sub">Wants to be your friend</div>
                      </div>
                      <div className="request-actions">
                        <button className="request-accept" onClick={() => handleAcceptRequest(r.displayName)} aria-label={`Accept ${r.displayName}`}>✓</button>
                        <button className="request-decline" onClick={() => handleDeclineRequest(r.displayName)} aria-label={`Decline ${r.displayName}`}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* online friends */}
              <div className="friends-section">
                <div className="friends-section-hd">
                  <span className="k">Online <span className="n">({onlineFriends.length})</span></span>
                </div>
                {onlineFriends.map((f) => (
                  <div key={f.id} className="friend-row">
                    <span className="friend-av">
                      {f.avatar}
                      <span className={`online-dot${f.status === 'in_game_ranked' ? ' ingame' : ''}`} aria-hidden="true" />
                    </span>
                    <div className="friend-info">
                      <div className="friend-nm">{f.displayName}</div>
                      <div className="friend-sub">{f.status === 'in_game_ranked' ? 'In game · Ranked' : 'Online'}</div>
                    </div>
                    <div className="friend-actions">
                      <button className="friend-action dm" onClick={() => handleOpenDm(f.displayName)} aria-label={`Message ${f.displayName}`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      </button>
                      <button className="friend-action remove" onClick={() => handleRemoveFriend(f.id)} aria-label={`Remove ${f.displayName}`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* offline friends */}
              {offlineFriends.length > 0 && (
                <div className="friends-section">
                  <div className="friends-section-hd">
                    <span className="k">Offline <span className="n">({offlineFriends.length})</span></span>
                  </div>
                  {offlineFriends.map((f) => (
                    <div key={f.id} className="friend-row offline">
                      <span className="friend-av">
                        {f.avatar}
                        <span className="online-dot off" aria-hidden="true" />
                      </span>
                      <div className="friend-info">
                        <div className="friend-nm">{f.displayName}</div>
                        <div className="friend-sub">Offline</div>
                      </div>
                      <div className="friend-actions">
                        <button className="friend-action dm" disabled aria-label={`Message ${f.displayName} (offline)`}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        </button>
                        <button className="friend-action remove" onClick={() => handleRemoveFriend(f.id)} aria-label={`Remove ${f.displayName}`}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* empty state */}
              {filteredFriends.length === 0 && friendSearch && (
                <div className="empty-line">No friends match "{friendSearch}"</div>
              )}
            </div>

            {/* add friend modal */}
            <div className={`add-friend-modal${addFriendOpen ? ' open' : ''}`} onClick={() => setAddFriendOpen(false)}>
              <div className="afm-box" onClick={(e) => e.stopPropagation()}>
                <div className="afm-hd">
                  <h3>Add Friend</h3>
                  <button className="afm-close" onClick={() => setAddFriendOpen(false)} aria-label="Close">×</button>
                </div>
                <input
                  className="afm-input"
                  type="text"
                  placeholder="Search tamers by name…"
                  value={addFriendSearch}
                  onChange={(e) => setAddFriendSearch(e.target.value)}
                  autoFocus
                />
                <div className="afm-results">
                  {filteredTamers.length === 0 ? (
                    <div className="afm-empty">No tamers found</div>
                  ) : (
                    filteredTamers.map((name) => (
                      <div key={name} className="afm-result">
                        <span className="nm">{name}</span>
                        <button
                          className={`afm-send${sentRequests.has(name) ? ' sent' : ''}`}
                          onClick={() => handleSendRequest(name)}
                          disabled={sentRequests.has(name)}
                        >
                          {sentRequests.has(name) ? 'Sent' : 'Add'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* toast */}
      <div className="toast" id="lobby-toast" role="status" aria-live="polite" />
    </div>
  );
}
