import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../hooks/useAuth";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  getLastMatch,
  getRoster,
  getFriends,
  requestFriend,
  requestFriendById,
  acceptFriend,
  removeFriend,
  getLiveMatches,
  getDaily,
  claimDaily,
  ApiError,
  type LastMatchSummary,
  type FriendView,
  type FriendRequestView,
  type LiveMatchSummary,
  type DayReward,
} from "../lib/api";
import { getPvpQuests, claimPvpQuest } from "../lib/api-pvp-quests";
import type { PvpQuestPeriod } from "@digiworld/shared/pvp-quest";
import { useWsStore } from "../state/wsStore";
import { DigimonSprite } from "../components/common/DigimonSprite";
import { TopBar } from "../components/topbar/TopBar";
import "../styles/topbar.css";
import "../styles/extensions-lobby.css";

const ROSTER_QUERY_KEY = ["roster"] as const;
const LAST_MATCH_QUERY_KEY = ["last-match"] as const;
const FRIENDS_QUERY_KEY = ["friends"] as const;
const LIVE_MATCHES_QUERY_KEY = ["live-matches"] as const;
const DAILY_QUERY_KEY = ["daily"] as const;

type DmSession = { readonly userId: string; readonly name: string };

function normalizeOutcome(
  outcome: LastMatchSummary["outcome"],
): "win" | "loss" | "draw" | "fled" {
  switch (outcome) {
    case "win_a":
    case "win_b":
    case "captured_a":
    case "win":
      return "win";
    case "fled_a":
    case "fled_b":
    case "fled":
      return "fled";
    case "abandoned":
    case "draw":
      return "draw";
    case "loss":
      return "loss";
    default:
      return "draw";
  }
}

function fmtReward(r?: DayReward): string {
  if (!r) return "—";
  const parts: string[] = [];
  if (r.meat) parts.push(`${r.meat} Meat`);
  if (r.bits) parts.push(`${r.bits} Bits`);
  if (r.data) parts.push(`${r.data} Data`);
  if (r.netcore) parts.push(`${r.netcore} NetCore`);
  return parts.join(" + ") || "—";
}

function fmtCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/* ── game modes ─────────────────────────────────────────────────────── */
type GameMode = "ranked" | "casual" | "tournament" | "training";

const GAME_MODES: {
  id: GameMode;
  label: string;
  meta: string;
  live?: boolean;
}[] = [
  { id: "ranked", label: "Ranked", meta: "3v3 · ELO", live: true },
  { id: "casual", label: "Casual", meta: "3v3 · Unranked" },
  { id: "tournament", label: "Tournament", meta: "Single Elim", live: true },
  { id: "training", label: "Training", meta: "vs CPU" },
];

const MODE_LABELS: Record<GameMode, string> = {
  ranked: "Ranked 3v3",
  casual: "Casual 3v3",
  tournament: "Tournament",
  training: "Training Mode",
};

const MODE_DESCS: Record<GameMode, string> = {
  ranked:
    "Competitive matches with ELO-based ranking. Climb the ladder to earn seasonal rewards.",
  casual: "Unranked matches for practice. No ELO impact, same 3v3 combat.",
  tournament:
    "Single-elimination bracket. Win to advance, lose and you're out.",
  training:
    "Battle against AI opponents to test strategies and practice rotations.",
};

/* ── mode icons ─────────────────────────────────────────────────────── */
function ModeIcon({ mode }: { mode: GameMode }) {
  const cn =
    mode === "ranked"
      ? "gold"
      : mode === "casual"
        ? "blue"
        : mode === "tournament"
          ? "red"
          : "green";
  const paths: Record<GameMode, string> = {
    ranked: "M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z",
    casual:
      "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
    tournament: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z",
    training:
      "M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83",
  };
  return (
    <span className={`mc-ico ${cn}`}>
      <svg viewBox="0 0 24 24">
        <path d={paths[mode]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ── main component ─────────────────────────────────────────────────── */
export function Lobby(): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();
  const navigate = useNavigate();
  const presenceCount = useWsStore((state) => state.presenceCount);
  const chat = useWsStore((state) => state.chat);
  const queue = useWsStore((state) => state.queue);
  const invalidatePvpQuests = useWsStore((state) => state.invalidatePvpQuests);
  const rosterQuery = useQuery({
    queryKey: ROSTER_QUERY_KEY,
    queryFn: getRoster,
  });
  const lastMatchQuery = useQuery({
    queryKey: LAST_MATCH_QUERY_KEY,
    queryFn: getLastMatch,
    retry: false,
  });
  const pvpQuery = useQuery({
    queryKey: ["pvp-quests"] as const,
    queryFn: getPvpQuests,
    enabled: true,
    staleTime: 30_000,
  });

  const activeBattle = useWsStore((state) => state.activeBattle);
  useEffect(() => {
    if (activeBattle?.status === "ended") {
      invalidatePvpQuests();
      pvpQuery.refetch();
    }
  }, [activeBattle?.status, invalidatePvpQuests, pvpQuery]);

  const roster = rosterQuery.data?.roster ?? [];
  const partySlots = [0, 1, 2].map(
    (slot) =>
      roster.find((mon) => mon.status === "party" && mon.slot === slot) ?? null,
  );
  const filledParty = partySlots.filter(Boolean).length;
  const partyReady = filledParty >= 3;

  // mode selection
  const [activeMode, setActiveMode] = useState<GameMode>("ranked");

  // chat state — General + per-user DM tabs
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  // 'general' | `dm:${userId}`
  const [activeChannel, setActiveChannel] = useState("general");
  const [openDms, setOpenDms] = useState<readonly DmSession[]>([]);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // social rail tabs
  const [socialTab, setSocialTab] = useState<"chat" | "quests" | "friends">(
    "chat",
  );

  // friends state (from API)
  const friendsQuery = useQuery({ queryKey: FRIENDS_QUERY_KEY, queryFn: getFriends, staleTime: 15_000 });
  const allFriends: readonly FriendView[] = friendsQuery.data?.friends ?? [];
  const incomingRequests: readonly FriendRequestView[] = friendsQuery.data?.incoming ?? [];
  const [friendSearch, setFriendSearch] = useState("");
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addFriendSearch, setAddFriendSearch] = useState("");
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [presenceSent, setPresenceSent] = useState<Set<string>>(new Set());

  // live matches (from API)
  const liveMatchesQuery = useQuery({
    queryKey: LIVE_MATCHES_QUERY_KEY,
    queryFn: getLiveMatches,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const liveMatches: readonly LiveMatchSummary[] = liveMatchesQuery.data ?? [];

  // daily reward (real /api/daily endpoint)
  const dailyQuery = useQuery({
    queryKey: DAILY_QUERY_KEY,
    queryFn: getDaily,
    staleTime: 30_000,
  });
  const daily = dailyQuery.data;
  const streakDay = daily?.streakDay ?? 0;
  const nextDay = daily?.wouldGrantDay ?? 0;
  const canClaim = daily?.canClaim ?? false;
  const previewDay = canClaim ? nextDay : Math.max(1, streakDay);
  const previewReward = daily?.cycle[previewDay - 1];
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (canClaim || !daily?.secondsUntilNext) {
      setTick(0);
      return undefined;
    }
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [canClaim, daily?.secondsUntilNext]);
  const secondsLeft = daily?.secondsUntilNext
    ? Math.max(0, daily.secondsUntilNext - tick)
    : 0;

  // presence (online now) from WS
  const presence = useWsStore((state) => state.presence);
  const dmsByPeer = useWsStore((state) => state.dmsByPeer);

  // DM tabs derived state
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

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [visibleLog]);

  const handleOpenDm = (userId: string, name: string): void => {
    setOpenDms((prev) =>
      prev.some((d) => d.userId === userId)
        ? prev
        : [...prev, { userId, name }],
    );
    setActiveChannel(`dm:${userId}`);
    setSocialTab("chat");
  };

  const closeDm = (userId: string): void => {
    setOpenDms((prev) => prev.filter((d) => d.userId !== userId));
    setActiveChannel((cur) => (cur === `dm:${userId}` ? "general" : cur));
  };

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

  const isQueued = queue.status === "waiting" || queue.status === "matched";

  const lm = lastMatchQuery.data;
  let lastMatchOutcome: "win" | "loss" | "draw" | "fled" = "draw";
  if (lm) {
    lastMatchOutcome = normalizeOutcome(lm.outcome);
  }

  const availableCount =
    pvpQuery.data?.periods.reduce((acc, w) => {
      return (
        acc +
        w.quests.filter((q) => q.state === "completed" && q.claimedAt === null)
          .length
      );
    }, 0) ?? 0;

  // quest period tabs
  const [selectedPeriod, setSelectedPeriod] = useState<PvpQuestPeriod>("DAILY");
  const periods = pvpQuery.data?.periods ?? [];
  const selectedWindow = periods.find((w) => w.period === selectedPeriod);
  const quests = selectedWindow?.quests ?? [];
  const [claiming, setClaiming] = useState<string | null>(null);

  const handleClaim = async (period: PvpQuestPeriod, windowId: string, instanceId: string) => {
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

  // daily reward claim + toast
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string): void => {
    const el = document.getElementById("lobby-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(
      () => el.classList.remove("show"),
      2600,
    );
  };

  const handleDailyClaim = async (): Promise<void> => {
    setClaimingDaily(true);
    try {
      const res = await claimDaily();
      await dailyQuery.refetch();
      showToast(`Day ${res.streakDay} claimed: ${fmtReward(res.granted)}`);
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : "Couldn't claim today's reward",
      );
    } finally {
      setClaimingDaily(false);
    }
  };

  // friends filtering
  const filteredFriends = allFriends.filter(
    (f) =>
      !friendSearch ||
      f.displayName.toLowerCase().includes(friendSearch.toLowerCase()),
  );
  const onlineFriends = filteredFriends.filter((f) => f.online);
  const offlineFriends = filteredFriends.filter((f) => !f.online);

  const handleAddFromPresence = async (userId: string, name: string): Promise<void> => {
    try {
      await requestFriendById(userId);
      setPresenceSent((prev) => new Set(prev).add(userId));
      showToast(`Friend request sent to ${name}`);
      friendsQuery.refetch();
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : "Couldn't send friend request",
      );
    }
  };

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

  // dark theme: add class to body for bg override
  useEffect(() => {
    document.documentElement.classList.add("is-lobby");
    document.body.classList.add("is-lobby");
    return () => {
      document.documentElement.classList.remove("is-lobby");
      document.body.classList.remove("is-lobby");
    };
  }, []);

  return (
    <div className="lobby-shell">
      {/* ── TOP BAR ──────────────────────────────────────────────── */}
      <TopBar />

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
                  className={`mode-card${activeMode === mode.id ? " active" : ""}`}
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
                <div className="h-kick">
                  Arena Queue · {MODE_LABELS[activeMode]}
                </div>
                <h1 className="h-title">Find a Match</h1>
                <p className="h-sub">{MODE_DESCS[activeMode]}</p>
                <div className="h-meta">
                  <span className="h-chip">
                    Bracket <b>±5 Lv</b>
                  </span>
                  <span className="h-chip">±100 trained</span>
                  <span className="h-chip gold">Widens over time</span>
                </div>
                <div className="h-cta">
                  <button
                    className={`findbtn ${isQueued ? "searching" : ""}`}
                    disabled={!partyReady && !isQueued}
                    onClick={() => {
                      if (partyReady) send({ type: "queue", join: !isQueued });
                    }}
                  >
                    {isQueued ? "Searching…" : "Find Match"}
                  </button>
                  {isQueued && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Matching by bracket…
                    </span>
                  )}
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
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--gold)"
                    strokeWidth="2"
                    width="22"
                    height="22"
                  >
                    <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
                  </svg>
                </span>
              </div>
              <div className="dm-tx">
                <div className="dm-day">
                  Daily Reward · Day {previewDay} of 7
                </div>
                <div className="dm-rew">{fmtReward(previewReward)}</div>
                <div className="dm-sub">
                  {!daily
                    ? "Fetching your streak…"
                    : canClaim
                      ? "Claim to keep your streak alive"
                      : streakDay === 0
                        ? "Claim your first daily reward"
                        : `Next reward in ${fmtCountdown(secondsLeft)}`}
                </div>
              </div>
              <div className="dm-pips">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <span
                    key={d}
                    className={`dm-pip${d <= streakDay ? " claimed" : ""}${canClaim && d === nextDay ? " today" : ""}`}
                  >
                    {d}
                  </span>
                ))}
              </div>
              <button
                className="dm-claim"
                disabled={!canClaim || claimingDaily}
                onClick={handleDailyClaim}
              >
                {claimingDaily
                  ? "Claiming…"
                  : !daily
                    ? "…"
                    : canClaim
                      ? "Claim"
                      : "Claimed"}
              </button>
            </div>

            {/* quick actions */}
            <div>
              <div className="card-hd">
                <span className="k">Quick Actions</span>
              </div>
              <div className="qgrid">
                {[
                  {
                    name: "Adventure",
                    href: "/adventure",
                    status: "Explore the overworld",
                    icon: "M12 2C8 6 4 10 4 14c0 4 3.6 8 8 8s8-4 8-8c0-4-4-8-8-12z M12 18c-2 0-4-2-4-4s2-4 4-4 4 2 4 4-2 4-4 4z",
                  },
                  {
                    name: "Farm",
                    href: "/farm",
                    status: "Collect resources",
                    icon: "M12 22V8 M12 8c0-3 2-6 5-6s5 3 5 6-2 5-5 5 M12 8c0-3-2-6-5-6S2 5 2 8s2 5 5 5",
                  },
                  {
                    name: "Training",
                    href: "/training",
                    status: "Boost stats",
                    icon: "M2 12l5-5 3 3 4-4 5 5 M2 19l5-5 3 3 4-4 5 5",
                  },
                  {
                    name: "Nursery",
                    href: "/nursery",
                    status: "Hatch eggs",
                    icon: "M12 22c4-4 8-8 8-13a8 8 0 1 0-16 0c0 5 4 9 8 13z M12 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
                  },
                  {
                    name: "Roster",
                    href: "/roster",
                    status: "Manage party",
                    icon: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z M4 21a8 8 0 0 1 16 0",
                  },
                ].map((qa) => (
                  <a key={qa.name} className="qa" href={qa.href}>
                    <div className="qa-top">
                      <div className="qa-tile">
                        <svg className="qa-ic" viewBox="0 0 24 24">
                          <path
                            d={qa.icon}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                        </svg>
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
                <span className="v">{liveMatches.length} playing</span>
              </div>
              <div className="list">
                {liveMatches.length === 0 ? (
                  <div className="empty-line">No live matches right now — start one!</div>
                ) : (
                  liveMatches.map((m) => (
                    <div key={m.matchId} className="match">
                      <div className="side">
                        <span className="who">{m.playerA.displayName}</span>
                        <div className="pips">
                          {[0, 1, 2].map((i) => (
                            <span key={i} className="mp" />
                          ))}
                        </div>
                      </div>
                      <span className="vsdot">vs</span>
                      <div className="side r">
                        <span className="who">{m.playerB.displayName}</span>
                        <div className="pips r">
                          {[0, 1, 2].map((i) => (
                            <span key={i} className="mp" />
                          ))}
                        </div>
                      </div>
                      <button
                        className="watch"
                        aria-label={`Watch ${m.playerA.displayName} vs ${m.playerB.displayName}`}
                        onClick={() => navigate(`/spectate?matchId=${m.matchId}`)}
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        Watch
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* online now */}
            <div className="card">
              <div className="card-hd">
                <span className="k">Online Now</span>
                <span className="v">{presenceCount} in plaza</span>
              </div>
              <div className="list">
                {presence.length === 0 ? (
                  <div className="empty-line">
                    You're alone here for now — invite a friend or start a
                    match.
                  </div>
                ) : (
                  presence.map((p) => {
                    const isFriend = allFriends.some(
                      (f) => f.userId === p.userId,
                    );
                    const isSelf = p.userId === user?.id;
                    const alreadySent =
                      presenceSent.has(p.userId) ||
                      (friendsQuery.data?.outgoing ?? []).some(
                        (r) => r.userId === p.userId,
                      );
                    return (
                      <div key={p.userId} className="row">
                        <span className="dot" aria-hidden="true" />
                        <span className="nm">{p.displayName}</span>
                        <span className="tag">Online</span>
                        {!isSelf && !isFriend && (
                          <button
                            className="row-add"
                            disabled={alreadySent}
                            title={alreadySent ? "Request sent" : "Add friend"}
                            aria-label={`Add ${p.displayName} as friend`}
                            onClick={() =>
                              handleAddFromPresence(p.userId, p.displayName)
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M19 8v6M22 11h-6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* last match */}
            <div>
              <div className="card-hd">
                <span className="k">Last Match</span>
              </div>
              {!lm ? (
                <div className="empty-line">
                  Play your first match to see rewards here.
                </div>
              ) : (
                <div
                  className={`lastmatch ${lastMatchOutcome === "win" ? "win" : ""}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "var(--panel2)",
                    border: "1px solid var(--hair)",
                    clipPath: "var(--notch-sm)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 12,
                      textTransform: "uppercase",
                    }}
                  >
                    {lastMatchOutcome === "win"
                      ? "Victory"
                      : lastMatchOutcome === "loss"
                        ? "Defeat"
                        : lastMatchOutcome === "fled"
                          ? "Fled"
                          : "Draw"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    vs{" "}
                    <b style={{ color: "var(--ink)" }}>
                      {lm.opponent ?? "Unknown"}
                    </b>
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontSize: 10,
                      color: "var(--muted)",
                    }}
                  >
                    +{lm.rewards?.credits ?? 0} Bits · +{lm.rewards?.xp ?? 0} XP
                  </span>
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
              aria-selected={socialTab === "chat"}
              onClick={() => setSocialTab("chat")}
            >
              Chat
              {unreadDmCount > 0 && (
                <span className="rt-badge">{unreadDmCount}</span>
              )}
            </button>
            <button
              className="stab"
              role="tab"
              aria-selected={socialTab === "quests"}
              onClick={() => setSocialTab("quests")}
            >
              Quests
              {availableCount > 0 && (
                <span className="rt-badge">{availableCount}</span>
              )}
            </button>
            <button
              className="stab"
              role="tab"
              aria-selected={socialTab === "friends"}
              onClick={() => setSocialTab("friends")}
            >
              Friends
              <span className="rt-badge">{allFriends.length}</span>
            </button>
          </div>

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
              {/* period tabs */}
              <div className="qp-tabs" role="tablist" aria-label="Quest period">
                {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((period) => {
                  const window = periods.find((w) => w.period === period);
                  const completedCount = window?.quests.filter(
                    (q) => q.state === "completed",
                  ).length ?? 0;
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

              {/* quest list for selected period */}
              {quests.length === 0 ? (
                <div className="empty-line">
                  No {selectedPeriod.toLowerCase()} quests right now — check back soon.
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
                        <div className="q-desc">{q.title}</div>
                        <div className="q-prog">
                          <span
                            className="fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className={`q-count${done ? " done" : ""}`}>
                        {q.progress}/{q.target}
                      </span>
                      {done && !claimed && (
                        <button
                          className="q-claim"
                          disabled={claiming === q.instanceId}
                          onClick={() => handleClaim(selectedPeriod, selectedWindow!.windowId, q.instanceId)}
                        >
                          {claiming === q.instanceId ? "Claiming…" : "Claim"}
                        </button>
                      )}
                      {claimed && (
                        <span className="q-claim done">Claimed</span>
                      )}
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

              {/* friend requests */}
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
                        <div className="friend-sub">
                          Wants to be your friend
                        </div>
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

              {/* online friends */}
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

              {/* offline friends */}
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

              {/* empty state */}
              {filteredFriends.length === 0 && friendSearch && (
                <div className="empty-line">
                  No friends match "{friendSearch}"
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
                    <div className="afm-empty">Enter a username to send a friend request</div>
                  ) : sentRequests.has(addFriendSearch.trim()) ? (
                    <div className="afm-empty">Request already sent</div>
                  ) : (
                    <div className="afm-result">
                      <span className="nm">{addFriendSearch.trim()}</span>
                      <button
                        className="afm-send"
                        onClick={() => handleSendRequest(addFriendSearch.trim())}
                      >
                        Send Request
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* toast */}
      <div
        className="toast"
        id="lobby-toast"
        role="status"
        aria-live="polite"
      />
    </div>
  );
}
