import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect, type FormEvent } from 'react';

import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { getLastMatch, getRoster } from '../lib/api';
import type { LastMatchSummary } from '../lib/api';
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

export function Lobby(): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();
  const presenceCount = useWsStore((state) => state.presenceCount);
  const chat = useWsStore((state) => state.chat);
  const queue = useWsStore((state) => state.queue);
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const lastMatchQuery = useQuery({ queryKey: LAST_MATCH_QUERY_KEY, queryFn: getLastMatch, retry: false });
  const roster = rosterQuery.data?.roster ?? [];
  
  const partySlots = [0, 1, 2].map((slot) => roster.find((mon) => mon.status === 'party' && mon.slot === slot) ?? null);
  const filledParty = partySlots.filter(Boolean).length;
  const partyReady = filledParty >= 3;
  
  // chat form state
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chat]);

  const onChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    const t = chatInput.trim();
    if (!t) return;
    send({ type: 'chat', text: t });
    setChatInput('');
  };

  const isQueued = queue.status === 'waiting' || queue.status === 'matched';

  const lm = lastMatchQuery.data;
  let lastMatchOutcome = 'draw';
  if (lm) {
    lastMatchOutcome = normalizeOutcome(lm.outcome);
  }

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
    </>
  );
}
