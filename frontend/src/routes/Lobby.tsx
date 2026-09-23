import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";

import { DEFAULT_LOBBY_SCENE, type LobbySceneSettings, type SceneSettings } from "@digiworld/scene3d/scene";
import { getArenaUrl, DEFAULT_ARENA_MODEL } from "@digiworld/scene3d/arena-urls";

import { useWebSocket } from "../hooks/useWebSocket";
import {
  authLogout,
  claimDaily,
  getDaily,
  getLastMatch,
  getLiveMatches,
  getRoster,
  type DailyResponse,
  type LastMatchSummary,
  type LiveMatchSummary,
  type RosterView,
} from "../lib/api";
import { getDigdex } from "../lib/api-digdex";
import { getPvpQuests } from "../lib/api-pvp-quests";
import { getLobbyScene, getLobbySceneEntity } from "../lib/api-scenes";
import { getShop } from "../lib/api-shop";
import { useWsStore } from "../state/wsStore";
import { DigimonSprite } from "../components/common/DigimonSprite";
import { TopBar } from "../components/topbar/TopBar";
import { SocialRail } from "../components/social/SocialRail";
import { LobbyScene3D, type LobbyFigure } from "../components/lobby/LobbyScene3D";
import "../styles/topbar.css";
import "../styles/extensions-lobby.css";
import "../styles/social-rail.css";

const ROSTER_QUERY_KEY = ["roster"] as const;
const LAST_MATCH_QUERY_KEY = ["last-match"] as const;
const LIVE_MATCHES_QUERY_KEY = ["live-matches"] as const;
const DAILY_QUERY_KEY = ["daily"] as const;
const SCENE_QUERY_KEY = ["lobby-scene"] as const;

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
    "Single-elimination bracket. Win to advance, lose and you're out.",
  training:
    "Battle against AI opponents to test strategies and practice rotations.",
};

const MODE_ICON_PATHS: Record<GameMode, string> = {
  ranked: "M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z",
  casual:
    "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  tournament: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z",
  training:
    "M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83",
};

/* ── lobby scene plumbing ───────────────────────────────────────────── */
const elementOf = (mon: RosterView): string =>
  mon.template?.element ?? mon.template?.attribute ?? "water";

/* ── panels ─────────────────────────────────────────────────────────── */
type PanelSect = "play" | "party" | "store" | "social" | "news" | "dex";
type PanelState = { side: "l" | "r"; sect: PanelSect } | null;

const PANEL_TITLE: Record<PanelSect, string> = {
  play: "Play",
  party: "Party",
  store: "Loja",
  social: "Social",
  news: "Missões & Notícias",
  dex: "Digidez",
};

export function Lobby(): JSX.Element {
  const { send } = useWebSocket();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* ── data ─────────────────────────────────────────────────────── */
  const rosterQuery = useQuery({
    queryKey: ROSTER_QUERY_KEY,
    queryFn: getRoster,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const lastMatchQuery = useQuery({
    queryKey: LAST_MATCH_QUERY_KEY,
    queryFn: getLastMatch,
    retry: false,
  });
  const pvpQuery = useQuery({
    queryKey: ["pvp-quests"] as const,
    queryFn: getPvpQuests,
    staleTime: 30_000,
  });
  const dailyQuery = useQuery({ queryKey: DAILY_QUERY_KEY, queryFn: getDaily });
  const sceneQuery = useQuery({
    queryKey: SCENE_QUERY_KEY,
    queryFn: getLobbyScene,
    staleTime: 60_000,
  });
  const sceneEntityQuery = useQuery({
    queryKey: ["lobby-scene-entity"] as const,
    queryFn: getLobbySceneEntity,
    staleTime: 60_000,
  });
  const shopQuery = useQuery({
    queryKey: ["shop"] as const,
    queryFn: getShop,
    staleTime: 60_000,
  });
  const digdexQuery = useQuery({
    queryKey: ["digdex"] as const,
    queryFn: getDigdex,
    staleTime: 60_000,
  });
  const liveMatchesQuery = useQuery({
    queryKey: LIVE_MATCHES_QUERY_KEY,
    queryFn: getLiveMatches,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const invalidatePvpQuests = useWsStore((state) => state.invalidatePvpQuests);
  const activeBattle = useWsStore((state) => state.activeBattle);
  useEffect(() => {
    if (activeBattle?.status === "ended") {
      invalidatePvpQuests();
      void pvpQuery.refetch();
    }
  }, [activeBattle?.status, invalidatePvpQuests, pvpQuery]);

  const claimDailyMutation = useMutation({
    mutationFn: claimDaily,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DAILY_QUERY_KEY });
      showToast("Recompensa diária resgatada!");
    },
  });
  const logoutMutation = useMutation({
    mutationFn: authLogout,
    onSuccess: () => navigate("/login"),
  });

  /* ── derived state ─────────────────────────────────────────────── */
  const roster = rosterQuery.data?.roster ?? [];
  const partySlots = [0, 1, 2].map(
    (slot) => roster.find((mon) => mon.status === "party" && mon.slot === slot) ?? null,
  );
  const filledParty = partySlots.filter(Boolean).length;
  const partyReady = filledParty >= 3;

  const sceneSettings = sceneQuery.data ?? DEFAULT_LOBBY_SCENE;
  const figures: (LobbyFigure | null)[] = partySlots.map((m) =>
    m
      ? {
          id: m.id,
          catalogId: m.catalogId,
          nickname: m.nickname,
          level: m.level,
          element: elementOf(m),
        }
      : null,
  );
  const lobbyEntity = sceneEntityQuery.data;
  const modelFile = (lobbyEntity?.settings as Readonly<Record<string, unknown>> | undefined)?.modelFile;
  // O ambiente do lobby é SEMPRE um GLB — sem fallback procedural. Se a cena
  // não escolher modelFile, usa o modelo default da lista de arenas.
  const resolvedUrl =
    typeof modelFile === "string" && modelFile.length > 0 ? getArenaUrl(modelFile) : undefined;
  const modelUrl = resolvedUrl ?? getArenaUrl(DEFAULT_ARENA_MODEL ?? "") ?? null;

  const [activeMode, setActiveMode] = useState<GameMode>("ranked");
  const [panel, setPanel] = useState<PanelState>(null);
  const [setOpen, setSetOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const liveMatches: readonly LiveMatchSummary[] = liveMatchesQuery.data ?? [];
  const queue = useWsStore((state) => state.queue);
  const isQueued = queue.status === "waiting" || queue.status === "matched";
  const presence = useWsStore((state) => state.presence);
  const daily: DailyResponse | undefined = dailyQuery.data;
  const today = daily
    ? (daily.cycle[daily.streakDay] ?? daily.cycle[daily.cycle.length - 1])
    : null;

  /* ── feel (toast / panels / scene effects) ─────────────────────── */
  const showToast = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const openPanel = (side: "l" | "r", sect: PanelSect): void => {
    setPanel((prev) => {
      if (prev?.side === side && prev.sect === sect) return null;
      return { side, sect };
    });
  };
  const closePanel = (): void => setPanel(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setPanel(null);
        setSetOpen(false);
        setExitOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!setOpen) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      const pop = document.getElementById("lob-set-pop");
      const btn = document.getElementById("lob-set-btn");
      if (pop && btn && !pop.contains(target) && !btn.contains(target)) setSetOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [setOpen]);

  /* dark theme for this screen only */
  useEffect(() => {
    document.documentElement.classList.add("is-lobby");
    document.body.classList.add("is-lobby");
    return () => {
      document.documentElement.classList.remove("is-lobby");
      document.body.classList.remove("is-lobby");
    };
  }, []);

  const lm = lastMatchQuery.data;
  const lastMatchOutcome: "win" | "loss" | "draw" | "fled" = lm
    ? normalizeOutcome(lm.outcome)
    : "draw";

  const queueChip = isQueued
    ? queue.status === "matched"
      ? "Match found"
      : "Searching"
    : null;

  const setToggle = (key: "sfx" | "music", val: boolean): void => {
    showToast(`${key === "sfx" ? "SFX" : "Música"} ${val ? "ativado" : "desativado"}`);
  };

  /* ── shared small bits ─────────────────────────────────────────── */
  const plaqueNames =
    filledParty > 0
      ? partySlots.filter(Boolean).map((m) => m!.nickname.toUpperCase()).join(" · ")
      : "party vazia";

  const quickActions = [
    { key: "adventure", label: "Adventure", href: "/adventure" },
    { key: "farm", label: "Farm", href: "/farm" },
    { key: "training", label: "Training", href: "/training" },
    { key: "nursery", label: "Nursery", href: "/nursery" },
    { key: "roster", label: "Roster", href: "/roster" },
  ] as const;

  const shopFeatured = shopQuery.data?.featured ?? null;
  const shopQuick = shopQuery.data?.quick.slice(0, 2) ?? [];

  const digdex = digdexQuery.data;
  const elementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of digdex?.entries ?? []) {
      counts.set(entry.element, (counts.get(entry.element) ?? 0) + 1);
    }
    return counts;
  }, [digdex]);

  const outcomeLabel =
    lastMatchOutcome === "win"
      ? "Victory"
      : lastMatchOutcome === "loss"
        ? "Defeat"
        : lastMatchOutcome === "fled"
          ? "Fled"
          : "Draw";
  return (
    <div className="lobby-shell" data-od-id="lobby-shell">
      <TopBar />

      {/* 3D cena do lobby — background cinematic */}
      <LobbyScene3D
        settings={sceneSettings}
        party={figures}
        modelUrl={modelUrl ?? null}
        useGlbSettings={lobbyEntity?.useGlbSettings === true}
        {...(lobbyEntity?.settings !== undefined ? { lighting: lobbyEntity.settings as Partial<SceneSettings> } : {})}
        onOpenCreature={(id) => navigate(`/creature/${id}`)}
      />

      {/* UI overlay — bordas e cantos são as zonas nobres; sem dock, sem config/sair */}
      <div className="lob-stage" data-od-id="lobby-stage">
        <div className="hud-row">
          <div className="hud-l" aria-hidden="true" />
          <div className="plaque" data-od-id="party-plaque">
            <span className="pl-k">Party</span>
            <span className="pl-names">{plaqueNames}</span>
            <span className="pl-st">
              &nbsp;·&nbsp;<b>{filledParty}/3</b> pronto
            </span>
            {queueChip && <span className="pl-q">{queueChip}…</span>}
          </div>
          <div className="hud-r" aria-hidden="true" />
        </div>

        {/* canto inferior esquerdo: missões diárias + atalhos */}
        <div className="ui-bl" data-od-id="lobby-corner-left">
          <div className="daily-mini" data-od-id="daily-mini">
            <div className="dm-ico">
              <span className={`rico ${today ? "cred" : ""}`} />
            </div>
            <div className="dm-tx">
              <div className="dm-day">
                {daily ? `Dia ${daily.streakDay + 1} de ${daily.cycle.length}` : "Missões diárias"}
              </div>
              <div className="dm-rew">
                {today
                  ? Object.entries(today)
                      .filter(([k]) => k !== "day")
                      .map(([k, v]) => `${v} ${k}`)
                      .join(" · ")
                  : "—"}
              </div>
              <div className="dm-sub">Resgate diário · renova em 00:00</div>
            </div>
            <div className="dm-pips">
              {(daily?.cycle ?? []).map((_, i) => (
                <span
                  key={i}
                  className={`dm-pip${i === daily?.streakDay ? " today" : i < (daily?.streakDay ?? 0) ? " claimed" : ""}`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="dm-claim"
              disabled={!daily?.canClaim}
              onClick={() => claimDailyMutation.mutate()}
            >
              {daily?.canClaim ? "Resgatar" : "Resgatado"}
            </button>
          </div>

          <div className="qa-mini" data-od-id="quick-actions">
            <div className="qgrid">
              {quickActions.map((qa) => (
                <a key={qa.key} className="qa" href={qa.href} aria-label={qa.label}>
                  <span className="qa-tile">
                    <svg className="qa-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4l3 3" />
                    </svg>
                  </span>
                  <span className="qa-nm">{qa.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* rail lateral — social + quests + amigos + party */}
      <SocialRail
        party={partySlots.map((m) =>
          m
            ? {
                id: m.id,
                catalogId: m.catalogId,
                nickname: m.nickname,
                level: m.level,
                element: elementOf(m),
                stage: m.template?.stage ?? "",
              }
            : null,
        )}
        onOpenCreature={(id) => navigate(`/creature/${id}`)}
      />

      {/* toast */}
      {toast && (
        <div className="toast show" id="lobby-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}