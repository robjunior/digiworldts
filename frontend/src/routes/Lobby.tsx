import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../hooks/useAuth";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  getLastMatch,
  getRoster,
  getLiveMatches,
  type LastMatchSummary,
  type LiveMatchSummary,
} from "../lib/api";
import { getPvpQuests } from "../lib/api-pvp-quests";
import { useWsStore } from "../state/wsStore";
import { DigimonSprite } from "../components/common/DigimonSprite";
import { TopBar } from "../components/topbar/TopBar";
import { SocialRail } from "../components/social/SocialRail";
import "../styles/topbar.css";
import "../styles/extensions-lobby.css";
import "../styles/social-rail.css";

const ROSTER_QUERY_KEY = ["roster"] as const;
const LAST_MATCH_QUERY_KEY = ["last-match"] as const;
const LIVE_MATCHES_QUERY_KEY = ["live-matches"] as const;

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
    "Single-elimination bracket. Win to advance, lose and you\'re out.",
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

  // live matches (from API)
  const liveMatchesQuery = useQuery({
    queryKey: LIVE_MATCHES_QUERY_KEY,
    queryFn: getLiveMatches,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const liveMatches: readonly LiveMatchSummary[] = liveMatchesQuery.data ?? [];

  const queue = useWsStore((state) => state.queue);
  const isQueued = queue.status === "waiting" || queue.status === "matched";

  const lm = lastMatchQuery.data;
  let lastMatchOutcome: "win" | "loss" | "draw" | "fled" = "draw";
  if (lm) {
    lastMatchOutcome = normalizeOutcome(lm.outcome);
  }

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

        {/* RIGHT SOCIAL RAIL (shared component) */}
        <SocialRail />
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
