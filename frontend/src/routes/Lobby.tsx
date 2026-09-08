import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect, type FormEvent } from 'react';

import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { useT } from '../hooks/useLocale';
import { getLastMatch, getRoster } from '../lib/api';
import type { LastMatchSummary } from '../lib/api';
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

/* ── bottom-right quest icon + badge ─────────────────────────── */
function QuestIcon({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="quest-fab"
      aria-label={count > 0 ? `${count} PVP quests to claim` : 'PVP Quests'}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
      </svg>
      {count > 0 ? <span className="quest-badge">{count}</span> : null}
    </button>
  );
}

/* ── period tab bar ──────────────────────────────────────────── */
function PeriodTabs({
  period,
  onChange,
}: {
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  onChange: (p: 'DAILY' | 'WEEKLY' | 'MONTHLY') => void;
}) {
  const t = useT();
  const tabs: { period: 'DAILY' | 'WEEKLY' | 'MONTHLY'; label: string }[] = [
    { period: 'DAILY', label: t('quest.pvp.daily') },
    { period: 'WEEKLY', label: t('quest.pvp.weekly') },
    { period: 'MONTHLY', label: t('quest.pvp.monthly') },
  ];
  return (
    <div className="qp-tabs">
      {tabs.map(({ period: p, label }) => (
        <button
          key={p}
          type="button"
          className={`qp-tab${period === p ? ' active' : ''}`}
          onClick={() => onChange(p)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── single quest row ────────────────────────────────────────── */
function QuestRow({
  quest,
  onClaim,
  claiming,
}: {
  quest: import('@digiworld/shared/pvp-quest').PvpQuestWithProgress;
  onClaim: (instanceId: string) => void;
  claiming: string | null;
}) {
  const t = useT();
  const done = quest.state === 'completed';
  const claimed = quest.state === 'claimed';
  const pct = quest.target > 0 ? Math.min(100, Math.round((quest.progress / quest.target) * 100)) : 0;

  let rewardLabel = '';
  if (quest.reward.kind === 'netcore') rewardLabel = `${quest.reward.amount} NetCore`;
  else if (quest.reward.kind === 'credits') rewardLabel = `${quest.reward.amount} Credits`;
  else if (quest.reward.kind === 'item') rewardLabel = `${quest.reward.qty}x ${quest.reward.itemId}`;
  else if (quest.reward.kind === 'pvp_points') rewardLabel = `${quest.reward.amount} PVP pts`;
  else if (quest.reward.kind === 'xp') rewardLabel = `${quest.reward.amount} XP`;
  else if (quest.reward.kind === 'battle_item') rewardLabel = `${quest.reward.qty}x ${quest.reward.itemId}`;
  else if (quest.reward.kind === 'cosmetic') rewardLabel = `cosmetic ${quest.reward.cosmeticId}`;

  return (
    <div className={`qp-row${done ? ' done' : ''}${claimed ? ' claimed' : ''}`}>
      <div className="qp-info">
        <div className="qp-title">{quest.title}</div>
        <div className="qp-bar">
          <div className="qp-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="qp-meta">
          <span>{quest.progress}/{quest.target}</span>
          <span className="qp-reward">{rewardLabel}</span>
        </div>
      </div>
      <div className="qp-action">
        {claimed ? (
          <span className="qp-claimed">{t('quest.pvp.claimed')}</span>
        ) : done ? (
          <button
            type="button"
            className="qp-claim-btn"
            disabled={claiming === quest.instanceId}
            onClick={() => onClaim(quest.instanceId)}
          >
            {claiming === quest.instanceId ? t('quest.pvp.completing') : t('quest.pvp.claim')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ── modal ───────────────────────────────────────────────────── */
function QuestModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const pvpQuery = useQuery({ queryKey: ['pvp-quests'] as const, queryFn: getPvpQuests, staleTime: 30_000 });
  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [claiming, setClaiming] = useState<string | null>(null);

  if (!open) return null;

  const window = pvpQuery.data?.periods.find((w) => w.period === period);
  const quests = window?.quests ?? [];

  const handleClaim = async (instanceId: string) => {
    if (!window) return;
    setClaiming(instanceId);
    try {
      const result = await claimPvpQuest(period, window.windowId, instanceId);
      if (result.ok) {
        await pvpQuery.refetch();
      }
    } catch {
      // keep existing state
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="qp-overlay" onClick={onClose}>
      <div className="qp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qp-head">
          <h2>{t('quest.pvp')}</h2>
          <button type="button" className="qp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <PeriodTabs period={period} onChange={setPeriod} />
        <div className="qp-body">
          {pvpQuery.isLoading ? (
            <div className="empty-line">Loading…</div>
          ) : quests.length === 0 ? (
            <div className="empty-line">{t('quest.pvp.no_quests')}</div>
          ) : (
            quests.map((q) => (
              <QuestRow key={q.instanceId} quest={q} onClaim={handleClaim} claiming={claiming} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function Lobby(): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();
  const t = useT();
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
  const roster = rosterQuery.data?.roster ?? [];

  const partySlots = [0, 1, 2].map((slot) => roster.find((mon) => mon.status === 'party' && mon.slot === slot) ?? null);
  const filledParty = partySlots.filter(Boolean).length;
  const partyReady = filledParty >= 3;

  // chat form state
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // quest modal state
  const [questModalOpen, setQuestModalOpen] = useState(false);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chat]);

  // invalidate pvp quests after a battle ends
  useEffect(() => {
    const activeBattle = useWsStore.getState().activeBattle;
    if (activeBattle?.status === 'ended') {
      invalidatePvpQuests();
    }
  }, [pvpQuery.data, invalidatePvpQuests]);

  const onChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    const txt = chatInput.trim();
    if (!txt) return;
    send({ type: 'chat', text: txt });
    setChatInput('');
  };

  const isQueued = queue.status === 'waiting' || queue.status === 'matched';

  const lm = lastMatchQuery.data;
  let lastMatchOutcome = 'draw';
  if (lm) {
    lastMatchOutcome = normalizeOutcome(lm.outcome);
  }

  // derive total available (completed but unclaimed) quest count
  const availableCount =
    pvpQuery.data?.periods.reduce((acc, w) => {
      return acc + w.quests.filter((q) => q.state === 'completed' && q.claimedAt === null).length;
    }, 0) ?? 0;

  return (
    <>
      {/* matchmaking strip */}
      <section className="mmstrip" data-od-id="matchmaking-strip">
        <div className="mm-left">
          <div className="kick">Arena Queue</div>
          <h1>Find a Match</h1>
          <div className="bracket" id="bracket">Bracket · <b>±5 Lv</b> · <b>±100 trained</b> — widens the longer you wait</div>
          <div className="mm-hint" id="mm-hint">
            {!partyReady && !isQueued ? `Assign ${3 - filledParty} more Digimon to your party to queue.` : ''}
          </div>
        </div>
        <div className="mm-right">
          <button
            className={`findbtn ${isQueued ? 'searching' : ''}`}
            id="findbtn"
            disabled={!partyReady && !isQueued}
            onClick={() => {
              if (partyReady) send({ type: 'queue', join: !isQueued });
            }}
          >
            {isQueued ? 'Leave queue' : 'Find match'}
          </button>
          <span className="q" id="qstate">
            {isQueued && <><span className="dot"></span>Searching — matching by bracket</>}
          </span>
        </div>
      </section>

      <div className="grid">
        <div className="colL">
          {/* party */}
          <div>
            <h3 className="stitle">Your Party <span className="n" id="party-sum">{filledParty}/3 ready</span></h3>
            <div className="party" id="party" data-od-id="party-row">
              {partySlots.map((p, i) => {
                if (!p) {
                  return (
                    <div key={i} className="pcard empty">
                      <div className="emptyslot">
                        <div className="plus">+</div>Slot {i + 1} empty
                      </div>
                    </div>
                  );
                }
                const stats = p.template?.baseStats ?? { hp: 100, en: 100, atk: 10, def: 10, spd: 10 };
                const hpMax = stats.hp + (p.statBonus?.hp ?? 0);
                const hp = hpMax;
                const pct = Math.round((hp / hpMax) * 100);
                const nickname = p.nickname || p.template?.name || 'Unknown';
                const species = p.template?.name || 'Unknown';

                return (
                  <div key={p.id} className="pcard" aria-label={`${nickname}, Level ${p.level}, HP ${hp} of ${hpMax}`}>
                    <span className="sp"><DigimonSprite catalogId={p.catalogId} /></span>
                    <div>
                      <div className="pn">{nickname}</div>
                      <div className="pl">Lv {p.level} · {species}</div>
                      <div className="hp">
                        <div className="bar"><span className="fill" style={{ width: `${pct}%` }}></span></div>
                        <div className="num">{hp.toLocaleString('en-US')} / {hpMax.toLocaleString('en-US')}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* last match */}
          <div>
            <h3 className="stitle">Last Match</h3>
            <div id="lastmatch-wrap">
              {!lm ? (
                <div className="empty-line">Play your first match to see rewards here.</div>
              ) : (
                <div className={`lastmatch ${lastMatchOutcome === 'win' ? 'win' : ''}`}>
                  <div className="res">{lastMatchOutcome === 'win' ? 'Victory' : lastMatchOutcome === 'loss' ? 'Defeat' : lastMatchOutcome === 'fled' ? 'Fled' : 'Draw'}</div>
                  <div className="vs">vs <b>{lm.opponent ?? 'Unknown'}</b></div>
                  <div className="rw">+{lm.rewards?.credits ?? 0} Bits · +{lm.rewards?.xp ?? 0} XP</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* chat */}
        <aside className={`colR${chatOpen ? ' is-open' : ''}`} data-od-id="chat-drawer">
          <button
            type="button"
            className="chathead"
            aria-expanded={chatOpen}
            aria-controls="chatlog"
            onClick={() => setChatOpen((prev) => !prev)}
          >
            <div className="k">Global Chat</div>
            <div className="s" id="chat-sub">{presenceCount} in the plaza</div>
            <span className="chat-caret" aria-hidden="true">{chatOpen ? '▾' : '▴'}</span>
          </button>
          <div className="chatlog" id="chatlog" role="log" aria-live="polite" aria-label="Global chat" ref={chatLogRef}>
            {chat.length === 0 ? (
              <div className="empty-line">No messages yet — say hi to start.</div>
            ) : (
              chat.map((m) => {
                const isMe = m.from === user?.id;
                return (
                  <div key={m.from + m.at} className="msg">
                    <span className={`who ${isMe ? 'me' : ''}`}>{m.displayName}{isMe ? ' (you)' : ''}</span>
                    <span className="tx">{m.text}</span>
                  </div>
                );
              })
            )}
          </div>
          <form className="chatform" id="chatform" onSubmit={onChatSubmit}>
            <input
              id="chatinput"
              type="text"
              placeholder="Say something to the plaza…"
              autoComplete="off"
              maxLength={240}
              aria-label="Chat message"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button type="submit">Send</button>
          </form>
        </aside>
      </div>

      {/* ── PVP Quest FAB + modal ── */}
      <QuestIcon count={availableCount} onClick={() => setQuestModalOpen(true)} />
      <QuestModal open={questModalOpen} onClose={() => setQuestModalOpen(false)} />
    </>
  );
}