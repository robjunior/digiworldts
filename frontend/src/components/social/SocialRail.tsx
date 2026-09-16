import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";

import {
  getFriends,
  requestFriend,
  acceptFriend,
  removeFriend,
  ApiError,
  type FriendView,
  type FriendRequestView,
} from "../../lib/api";
import { getPvpQuests, claimPvpQuest, formatPvpQuestReward } from "../../lib/api-pvp-quests";
import type { PvpQuestPeriod } from "@digiworld/shared/pvp-quest";
import { useWsStore } from "../../state/wsStore";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocket } from "../../hooks/useWebSocket";
import "../../styles/social-rail.css";

const FRIENDS_QUERY_KEY = ["friends"] as const;

type DmSession = { readonly userId: string; readonly name: string };

export function SocialRail(): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();
  const invalidatePvpQuests = useWsStore((s) => s.invalidatePvpQuests);
  const chat = useWsStore((s) => s.chat);
  const queue = useWsStore((s) => s.queue);
  const activeBattle = useWsStore((s) => s.activeBattle);
  const dmsByPeer = useWsStore((s) => s.dmsByPeer);
  const queryClient = useQueryClient();

  // ── local UI state ────────────────────────────────────────────
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialTab, setSocialTab] = useState<"chat" | "quests" | "friends">(
    "chat",
  );
  const [chatInput, setChatInput] = useState("");
  const [activeChannel, setActiveChannel] = useState("general");
  const [openDms, setOpenDms] = useState<readonly DmSession[]>([]);
  const chatLogRef = useRef<HTMLDivElement>(null);

  const [friendSearch, setFriendSearch] = useState("");
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addFriendSearch, setAddFriendSearch] = useState("");
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  const [selectedPeriod, setSelectedPeriod] = useState<PvpQuestPeriod>("DAILY");
  const [claiming, setClaiming] = useState<string | null>(null);

  // ── friends query ─────────────────────────────────────────────
  const friendsQuery = useQuery({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: getFriends,
    staleTime: 15_000,
  });
  const allFriends: readonly FriendView[] = friendsQuery.data?.friends ?? [];
  const incomingRequests: readonly FriendRequestView[] =
    friendsQuery.data?.incoming ?? [];

  // ── pvp quests ────────────────────────────────────────────────
  const pvpQuery = useQuery({
    queryKey: ["pvp-quests"] as const,
    queryFn: getPvpQuests,
    enabled: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (activeBattle?.status === "ended") {
      invalidatePvpQuests();
      pvpQuery.refetch();
    }
  }, [activeBattle?.status, invalidatePvpQuests, pvpQuery]);

  // ── derived counters ──────────────────────────────────────────
  const activeDmUserId = activeChannel.startsWith("dm:")
    ? activeChannel.slice(3)
    : null;
  const activeDmName = openDms.find((d) => d.userId === activeDmUserId)?.name;
  const visibleLog = activeDmUserId
    ? (dmsByPeer[activeDmUserId] ?? [])
    : chat;

  const unreadDmCount = openDms.filter((d) => {
    const msgs = dmsByPeer[d.userId] ?? [];
    const last = msgs[msgs.length - 1];
    return (
      last !== undefined &&
      last.from !== user?.id &&
      activeChannel !== `dm:${d.userId}`
    );
  }).length;

  const availableCount =
    pvpQuery.data?.periods.reduce((acc, w) => {
      return (
        acc +
        w.quests.filter((q) => q.state === "completed" && q.claimedAt === null)
          .length
      );
    }, 0) ?? 0;

  // auto-scroll chat
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [visibleLog]);

  // ── chat handlers ─────────────────────────────────────────────
  const handleOpenDm = useCallback(
    (userId: string, name: string) => {
      setOpenDms((prev) =>
        prev.some((d) => d.userId === userId)
          ? prev
          : [...prev, { userId, name }],
      );
      setActiveChannel(`dm:${userId}`);
      setSocialTab("chat");
    },
    [],
  );

  const closeDm = useCallback((userId: string) => {
    setOpenDms((prev) => prev.filter((d) => d.userId !== userId));
    setActiveChannel((cur) => (cur === `dm:${userId}` ? "general" : cur));
  }, []);

  const onChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    const txt = chatInput.trim();
    if (!txt) return;
    if (activeDmUserId) {
      send({ type: "chat", text: txt, toUserId: activeDmUserId });
    } else {
      send({ type: "chat", text: txt });
    }
    setChatInput("");
  };

  // ── quest handlers ────────────────────────────────────────────
  const periods = pvpQuery.data?.periods ?? [];
  const selectedWindow = periods.find((w) => w.period === selectedPeriod);
  const quests = selectedWindow?.quests ?? [];

  const handleClaim = async (
    period: PvpQuestPeriod,
    windowId: string,
    instanceId: string,
  ) => {
    setClaiming(instanceId);
    try {
      const result = await claimPvpQuest(period, windowId, instanceId);
      if (result.ok) {
        await pvpQuery.refetch();
      }
    } catch {
      // keep existing state
    } finally {
      setClaiming(null);
    }
  };

  // ── friends handlers ──────────────────────────────────────────
  const filteredFriends = allFriends.filter(
    (f) =>
      !friendSearch ||
      f.displayName.toLowerCase().includes(friendSearch.toLowerCase()),
  );
  const onlineFriends = filteredFriends.filter((f) => f.online);
  const offlineFriends = filteredFriends.filter((f) => !f.online);

  const handleRemoveFriend = async (userId: string) => {
    await removeFriend(userId);
    friendsQuery.refetch();
  };

  const handleAcceptRequest = async (userId: string) => {
    await acceptFriend(userId);
    friendsQuery.refetch();
  };

  const handleDeclineRequest = async (userId: string) => {
    await removeFriend(userId);
    friendsQuery.refetch();
  };

  const handleSendRequest = async (displayName: string) => {
    await requestFriend(displayName);
    setSentRequests((prev) => new Set(prev).add(displayName));
    friendsQuery.refetch();
  };

  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    const el = document.getElementById("lobby-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => el.classList.remove("show"),
      2600,
    );
  }, []);

  return (
    <aside
      className={`social${socialOpen ? "" : " collapsed"}`}
      data-od-id="social-rail"
    >

      <div className="social-icons" role="tablist">
        <button
          className={`social-icon-btn${socialOpen && socialTab === "chat" ? " active" : ""}`}
          role="tab"
          aria-selected={socialOpen && socialTab === "chat"}
          onClick={() => {
            if (socialOpen && socialTab === "chat") {
              setSocialOpen(false);
            } else {
              setSocialOpen(true);
              setSocialTab("chat");
            }
          }}
          title="Chat"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {unreadDmCount > 0 && (
            <span className="social-counter">{unreadDmCount}</span>
          )}
        </button>
        <button
          className={`social-icon-btn${socialOpen && socialTab === "quests" ? " active" : ""}`}
          role="tab"
          aria-selected={socialOpen && socialTab === "quests"}
          onClick={() => {
            if (socialOpen && socialTab === "quests") {
              setSocialOpen(false);
            } else {
              setSocialOpen(true);
              setSocialTab("quests");
            }
          }}
          title="Quests"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
          </svg>
          {availableCount > 0 && (
            <span className="social-counter">{availableCount}</span>
          )}
        </button>
        <button
          className={`social-icon-btn${socialOpen && socialTab === "friends" ? " active" : ""}`}
          role="tab"
          aria-selected={socialOpen && socialTab === "friends"}
          onClick={() => {
            if (socialOpen && socialTab === "friends") {
              setSocialOpen(false);
            } else {
              setSocialOpen(true);
              setSocialTab("friends");
            }
          }}
          title="Friends"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {allFriends.length > 0 && (
            <span className="social-counter">{allFriends.length}</span>
          )}
        </button>
      </div>

      {/* Panel content — only rendered when open */}
      {socialOpen && (
        <>
          {/* CHAT PANEL */}
          <div className="spanel" hidden={socialTab !== "chat"}>
            <div className="chat">
              <div
                className="chat-channels"
                role="tablist"
                aria-label="Chat channels"
              >
                <button
                  className="ch-btn"
                  role="tab"
                  aria-current={activeChannel === "general"}
                  onClick={() => setActiveChannel("general")}
                >
                  General
                </button>
                {openDms.map((dm) => (
                  <span key={dm.userId} className="ch-tab">
                    <button
                      className="ch-btn"
                      role="tab"
                      aria-current={activeChannel === `dm:${dm.userId}`}
                      onClick={() => setActiveChannel(`dm:${dm.userId}`)}
                    >
                      {dm.name}
                    </button>
                    <button
                      className="ch-close"
                      aria-label={`Close DM with ${dm.name}`}
                      onClick={() => closeDm(dm.userId)}
                    >
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      >
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>

              <div
                className="chatlog"
                role="log"
                aria-live="polite"
                aria-label="Chat"
                ref={chatLogRef}
              >
                {visibleLog.length === 0 ? (
                  <div className="empty-line">
                    {activeDmUserId
                      ? `No messages yet — say hi to ${activeDmName ?? "them"}.`
                      : "No messages yet — say hi to start."}
                  </div>
                ) : (
                  visibleLog.map((m) => {
                    const isMe = m.from === user?.id;
                    return (
                      <div
                        key={m.from + m.at + m.text.slice(0, 10)}
                        className="msg"
                      >
                        <span className="ts">
                          {new Date(m.at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className={`who${isMe ? " me" : ""}`}>
                          {m.displayName}
                          {isMe ? " (you)" : ""}
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
                  placeholder={`Message ${activeDmName ?? "General"}…`}
                  autoComplete="off"
                  maxLength={240}
                  aria-label="Chat message"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" disabled={!chatInput.trim()}>
                  Send
                </button>
              </form>
            </div>
          </div>

          {/* QUESTS PANEL */}
          <div className="spanel" hidden={socialTab !== "quests"}>
            <div className="quests">
              <div className="qp-tabs" role="tablist" aria-label="Quest period">
                {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((period) => {
                  const window = periods.find((w) => w.period === period);
                  const completedCount =
                    window?.quests.filter((q) => q.state === "completed")
                      .length ?? 0;
                  const totalCount = window?.quests.length ?? 0;
                  return (
                    <button
                      key={period}
                      className={`qp-tab${selectedPeriod === period ? " active" : ""}`}
                      role="tab"
                      aria-selected={selectedPeriod === period}
                      onClick={() => setSelectedPeriod(period)}
                    >
                      {period.charAt(0) + period.slice(1).toLowerCase()}
                      {totalCount > 0 && (
                        <span className="qp-tab-count">
                          {completedCount}/{totalCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {quests.length === 0 ? (
                <div className="empty-line">
                  No {selectedPeriod.toLowerCase()} quests right now — check back
                  soon.
                </div>
              ) : (
                quests.map((q) => {
                  const pct =
                    q.target > 0
                      ? Math.min(
                          100,
                          Math.round((q.progress / q.target) * 100),
                        )
                      : 0;
                  const done = q.state === "completed";
                  const claimed = q.state === "claimed";
                  return (
                    <div key={q.instanceId} className="quest">
                      <span className="q-ico">
                        <svg
                          className={`q-ic ${done ? "gold" : "blue"}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
                        </svg>
                      </span>
                      <div className="q-tx">
                        <div className="q-nm">{q.title}</div>
                        <div className="q-desc">{formatPvpQuestReward(q.reward)}</div>
                        <div className="q-prog">
                          <span className="fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={`q-count${done ? " done" : ""}`}>
                        {q.progress}/{q.target}
                      </span>
                      {done && !claimed && (
                        <button
                          className="q-claim"
                          disabled={claiming === q.instanceId}
                          onClick={() =>
                            handleClaim(
                              selectedPeriod,
                              selectedWindow!.windowId,
                              q.instanceId,
                            )
                          }
                        >
                          {claiming === q.instanceId ? "Claiming…" : "Claim"}
                        </button>
                      )}
                      {claimed && <span className="q-claim done">Claimed</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* FRIENDS PANEL */}
          <div
            className="spanel"
            hidden={socialTab !== "friends"}
            style={{ position: "relative" }}
          >
            <div className="friends">
              <div className="friends-toolbar">
                <input
                  type="text"
                  placeholder="Search friends…"
                  value={friendSearch}
                  onChange={(e) => setFriendSearch(e.target.value)}
                  aria-label="Search friends"
                />
                <button
                  className="add-friend-btn"
                  onClick={() => setAddFriendOpen(true)}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M12 5v14m-7-7h14" strokeLinecap="round" />
                  </svg>
                  Add
                </button>
              </div>

              {incomingRequests.length > 0 && (
                <div className="friends-section">
                  <div className="friends-section-hd">
                    <span className="k">
                      Friend Requests{" "}
                      <span className="n">({incomingRequests.length})</span>
                    </span>
                  </div>
                  {incomingRequests.map((r) => (
                    <div key={r.userId} className="friend-request-row">
                      <span className="friend-av">{r.displayName[0]}</span>
                      <div className="friend-info">
                        <div className="friend-nm">{r.displayName}</div>
                        <div className="friend-sub">Wants to be your friend</div>
                      </div>
                      <div className="request-actions">
                        <button
                          className="request-accept"
                          onClick={() => handleAcceptRequest(r.userId)}
                          aria-label={`Accept ${r.displayName}`}
                        >
                          ✓
                        </button>
                        <button
                          className="request-decline"
                          onClick={() => handleDeclineRequest(r.userId)}
                          aria-label={`Decline ${r.displayName}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="friends-section">
                <div className="friends-section-hd">
                  <span className="k">
                    Online <span className="n">({onlineFriends.length})</span>
                  </span>
                </div>
                {onlineFriends.map((f) => (
                  <div key={f.userId} className="friend-row">
                    <span className="friend-av">
                      {f.displayName[0]}
                      <span className="online-dot" aria-hidden="true" />
                    </span>
                    <div className="friend-info">
                      <div className="friend-nm">{f.displayName}</div>
                      <div className="friend-sub">Online</div>
                    </div>
                    <div className="friend-actions">
                      <button
                        className="friend-action dm"
                        onClick={() => handleOpenDm(f.userId, f.displayName)}
                        aria-label={`Message ${f.displayName}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                      <button
                        className="friend-action remove"
                        onClick={() => handleRemoveFriend(f.userId)}
                        aria-label={`Remove ${f.displayName}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {offlineFriends.length > 0 && (
                <div className="friends-section">
                  <div className="friends-section-hd">
                    <span className="k">
                      Offline{" "}
                      <span className="n">({offlineFriends.length})</span>
                    </span>
                  </div>
                  {offlineFriends.map((f) => (
                    <div key={f.userId} className="friend-row offline">
                      <span className="friend-av">
                        {f.displayName[0]}
                        <span className="online-dot off" aria-hidden="true" />
                      </span>
                      <div className="friend-info">
                        <div className="friend-nm">{f.displayName}</div>
                        <div className="friend-sub">Offline</div>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="friend-action dm"
                          disabled
                          aria-label={`Message ${f.displayName} (offline)`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        <button
                          className="friend-action remove"
                          onClick={() => handleRemoveFriend(f.userId)}
                          aria-label={`Remove ${f.displayName}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filteredFriends.length === 0 && friendSearch && (
                <div className="empty-line">
                  No friends match &quot;{friendSearch}&quot;
                </div>
              )}
            </div>

            {/* add friend modal */}
            <div
              className={`add-friend-modal${addFriendOpen ? " open" : ""}`}
              onClick={() => setAddFriendOpen(false)}
            >
              <div className="afm-box" onClick={(e) => e.stopPropagation()}>
                <div className="afm-hd">
                  <h3>Add Friend</h3>
                  <button
                    className="afm-close"
                    onClick={() => setAddFriendOpen(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <input
                  className="afm-input"
                  type="text"
                  placeholder="Enter username…"
                  value={addFriendSearch}
                  onChange={(e) => setAddFriendSearch(e.target.value)}
                  autoFocus
                />
                <div className="afm-results">
                  {addFriendSearch.trim().length < 3 ? (
                    <div className="afm-empty">
                      Enter a username to send a friend request
                    </div>
                  ) : sentRequests.has(addFriendSearch.trim()) ? (
                    <div className="afm-empty">Request already sent</div>
                  ) : (
                    <div className="afm-result">
                      <span className="nm">{addFriendSearch.trim()}</span>
                      <button
                        className="afm-send"
                        onClick={() =>
                          handleSendRequest(addFriendSearch.trim())
                        }
                      >
                        Send Request
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
