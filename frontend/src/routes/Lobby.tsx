import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";

import type { LobbySceneSettings } from "@digiworld/scene3d/scene";
import { DEFAULT_LOBBY_SCENE } from "@digiworld/scene3d/scene";
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

      {/* 3D cena do lobby — SceneEntity kind:'lobby', party em tempo real */}
      <LobbyScene3D
        settings={sceneSettings}
        party={figures}
        modelUrl={modelUrl ?? null}
        useGlbSettings={lobbyEntity?.useGlbSettings === true}
        onOpenCreature={(id) => navigate(`/creature/${id}`)}
      />

      {/* UI overlay — bordas e cantos são as zonas nobres */}
      <div className="lob-stage" data-od-id="lobby-stage">
        {/* topo: plaque da party (centro) + config/sair (direita) */}
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
          <div className="hud-r">
            <button
              type="button"
              className="hud-ic"
              id="lob-set-btn"
              aria-label="Configurações"
              aria-expanded={setOpen}
              onClick={() => setSetOpen((v) => !v)}
              title="Configurações"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              type="button"
              className="hud-ic"
              aria-label="Sair da sessão"
              title="Sair da sessão"
              onClick={() => setExitOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </div>

        {/* canto inferior esquerdo: missões + atalhos */}
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

        {/* canto inferior direito: ações sociais */}
        <div className="ui-br" data-od-id="lobby-corner-right">
          <button
            type="button"
            className="br-ic"
            aria-label="Abrir chat"
            title="Chat"
            onClick={() => openPanel("r", "social")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 12a8 8 0 0 1-8 8H4l2.4-2.4A8 8 0 1 1 21 12z" />
              <path d="M9 12h.01M13 12h.01M17 12h.01" />
            </svg>
          </button>
          <button
            type="button"
            className="br-ic"
            aria-label="Missões e notícias"
            title="Missões & notícias"
            onClick={() => openPanel("l", "news")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4h16v16H4z" />
              <path d="M8 9h8M8 13h8M8 17h5" />
            </svg>
          </button>
          <button
            type="button"
            className="br-ic"
            aria-label="Convidar para a party"
            title="Convidar"
            onClick={() => openPanel("r", "party")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {/* dock — única navegação principal */}
        <nav className="dock" data-od-id="lobby-dock" aria-label="Navegação principal">
          <button type="button" className="dock-btn primary" onClick={() => openPanel("r", "play")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M6 4l13 8-13 8z" />
            </svg>
            Jogar
          </button>
          <button type="button" className="dock-btn" onClick={() => openPanel("r", "party")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
              <circle cx="17.5" cy="9.5" r="2.5" />
              <path d="M16 14.5a5 5 0 0 1 5.5 5" />
            </svg>
            Party
          </button>
          <button type="button" className="dock-btn" onClick={() => openPanel("r", "store")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M5 8h14l-1.5 12h-11z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            Loja
          </button>
          <button type="button" className="dock-btn" onClick={() => openPanel("l", "dex")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4h16v16H4z" />
              <path d="M8 8h8v8H8z" />
              <path d="M8 8l8 8M16 8l-8 8" />
            </svg>
            Digidez
          </button>
        </nav>
      </div>

      {/* painéis laterais deslizantes — cena fica visível atrás */}
      <div
        className={`lob-veil${panel ? " show" : ""}`}
        aria-hidden={!panel}
        onClick={closePanel}
      />

      <aside
        className={`lob-panel lob-panel-l${panel?.side === "l" ? " open" : ""}`}
        data-od-id="panel-left"
        aria-hidden={panel?.side !== "l"}
      >
        <header className="lob-p-hd">
          <span className="lob-p-title">{panel?.side === "l" ? PANEL_TITLE[panel.sect] : ""}</span>
          <button type="button" className="lob-p-close" aria-label="Fechar painel" onClick={closePanel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="lob-psect" hidden={!(panel?.side === "l" && panel.sect === "news")}>
          <div className="card">
            <div className="card-hd">
              <span className="k">Live Matches</span>
              <span className="v">{liveMatches.length} ao vivo</span>
            </div>
            <div className="list">
              {liveMatches.length === 0 ? (
                <div className="empty-line">Nenhuma partida ao vivo agora — entre na fila para começar.</div>
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
                      type="button"
                      className="watch"
                      aria-label={`Assistir ${m.playerA.displayName} vs ${m.playerB.displayName}`}
                      onClick={() => navigate(`/spectate?matchId=${m.matchId}`)}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Ver
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <span className="k">Última partida</span>
            </div>
            {!lm ? (
              <div className="empty-line">Jogue sua primeira partida para ver as recompensas aqui.</div>
            ) : (
              <div className="lastmatch">
                <span className="lm-out">{outcomeLabel}</span>
                <span className="lm-opp">
                  vs <b>{lm.opponent ?? "Desconhecido"}</b>
                </span>
                <span className="lm-rewards">
                  +{lm.rewards?.credits ?? 0} Bits · +{lm.rewards?.xp ?? 0} XP
                </span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-hd">
              <span className="k">Online agora</span>
              <span className="v">{useWsStore.getState().presenceCount} online</span>
            </div>
            <div className="list">
              {presence.length === 0 ? (
                <div className="empty-line">Você está sozinho na praça — convide um amigo ou entre na fila.</div>
              ) : (
                presence.map((p) => (
                  <div key={p.userId ?? p.displayName} className="row">
                    <span className="dot" />
                    <span className="nm">{p.displayName}</span>
                    <span className="tag">Online</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lob-psect" hidden={!(panel?.side === "l" && panel.sect === "dex")}>
          <div className="dex-hero" data-od-id="dex-progress">
            <span className="dx-n">
              DigiDex · {digdex?.metCount ?? 0} / {digdex?.totalCount ?? 0} espécies
            </span>
            <span className="dx-s">
              {digdex && digdex.totalCount > 0
                ? `${Math.round((digdex.metCount / digdex.totalCount) * 100)}% do arquivo digital descoberto — evolua e explore para revelar o resto.`
                : "Arquivo digital bloqueado aguardando o DigiDex."}
            </span>
            <span className="dx-bar">
              <span
                className="dx-fill"
                role="progressbar"
                aria-valuenow={digdex?.metCount ?? 0}
                aria-valuemin={0}
                aria-valuemax={digdex?.totalCount ?? 100}
                style={{
                  width: digdex && digdex.totalCount > 0
                    ? `${(digdex.metCount / digdex.totalCount) * 100}%`
                    : "0%",
                }}
              />
            </span>
            <span className="dx-chips">
              {[...elementCounts.entries()].map(([el, n]) => (
                <span key={el} className="dx-chip">
                  {el} {n}
                </span>
              ))}
            </span>
          </div>
          <a className="lob-p-link" href="/digdex">
            Abrir DigiDex
          </a>
        </div>
      </aside>

      <aside
        className={`lob-panel lob-panel-r${panel?.side === "r" ? " open" : ""}`}
        data-od-id="panel-right"
        aria-hidden={panel?.side !== "r"}
      >
        <header className="lob-p-hd">
          <span className="lob-p-title">{panel?.side === "r" ? PANEL_TITLE[panel.sect] : ""}</span>
          <button type="button" className="lob-p-close" aria-label="Fechar painel" onClick={closePanel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* PLAY — mode strip + find match */}
        <div className="lob-psect" hidden={!(panel?.side === "r" && panel.sect === "play")}>
          <div className="mode-strip" role="tablist" aria-label="Modo de jogo">
            {GAME_MODES.map((mode) => (
              <button
                key={mode.id}
                className={`mode-card${activeMode === mode.id ? " active" : ""}`}
                onClick={() => setActiveMode(mode.id)}
                role="tab"
                aria-selected={activeMode === mode.id}
              >
                {mode.live && <span className="mc-tag live">LIVE</span>}
                <span className={`mc-ico ${mode.id === "ranked" ? "gold" : mode.id === "casual" ? "blue" : mode.id === "tournament" ? "red" : "green"}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d={MODE_ICON_PATHS[mode.id]} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="mc-nm">{mode.label}</span>
                <span className="mc-meta">{mode.meta}</span>
              </button>
            ))}
          </div>

          <div className="s-caption">
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
                type="button"
                className={`findbtn ${isQueued ? "searching" : ""}`}
                disabled={!partyReady && !isQueued}
                onClick={() => {
                  if (partyReady) showToast(`Buscando ${MODE_LABELS[activeMode]} — entrando na fila…`);
                  if (partyReady) send({ type: "queue", join: !isQueued });
                }}
              >
                {isQueued ? "Leave queue" : "Find Match"}
              </button>
            </div>
            <div className="s-hint">Clique num Digimon no palco para abrir o perfil.</div>
          </div>
        </div>

        {/* PARTY — slots espelhando a cena */}
        <div className="lob-psect" hidden={!(panel?.side === "r" && panel.sect === "party")}>
          <div className="party-slots">
            {partySlots.map((mon, i) =>
              mon ? (
                <button
                  key={i}
                  type="button"
                  className="dm-row"
                  data-pos={i}
                  onClick={() => navigate(`/creature/${mon.id}`)}
                >
                  <span className="dm-av">
                    <DigimonSprite catalogId={mon.catalogId} className="dm-img" alt="" />
                  </span>
                  <span className="dm-tx">
                    <span className="dm-nm">{mon.nickname}</span>
                    <span className="dm-sub">{elementOf(mon)} · {mon.template?.stage ?? ""}</span>
                  </span>
                  <span className="dm-lv">Lv {mon.level}</span>
                </button>
              ) : (
                <button
                  key={i}
                  type="button"
                  className="dm-row empty"
                  data-pos={i}
                  onClick={() => navigate("/roster")}
                >
                  <span className="dm-av"><span className="mono">?</span></span>
                  <span className="dm-tx">
                    <span className="dm-nm">Vazio</span>
                    <span className="dm-sub">slot {i + 1} — aguardando convite</span>
                  </span>
                  <span className="dm-lv">—</span>
                </button>
              ),
            )}
          </div>
          <p className="lob-p-hint">Clique num Digimon para abrir o perfil — slots vazios esperam um convite.</p>
          <div className="lob-p-actions">
            <a className="lob-p-link" href="/roster">Gerenciar party</a>
            <a className="lob-p-link" href="/roster">Coleção completa</a>
          </div>
        </div>

        {/* STORE — destaque da loja */}
        <div className="lob-psect" hidden={!(panel?.side === "r" && panel.sect === "store")}>
          <p className="lob-p-hint">Destaques da semana na loja do tamer.</p>
          {shopFeatured && (
            <a className="sf-item" href="/shop">
              <span className="sf-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
                  <path d="M9.5 12l1.8 1.8L15 10" />
                </svg>
              </span>
              <span className="sf-tx">
                <span className="sf-nm">{shopFeatured.name}</span>
                <span className="sf-tg">Em destaque · {shopFeatured.price} {shopFeatured.currency}</span>
              </span>
            </a>
          )}
          {shopQuick.map((item) => (
            <a key={item.id} className="sf-item" href="/shop">
              <span className="sf-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M12 21s-7-4.5-7-10a5 5 0 0 1 10-3 5 5 0 0 1 10 3c0 5.5-7 10-7 10z" />
                  <path d="M9 12h6M12 9v6" />
                </svg>
              </span>
              <span className="sf-tx">
                <span className="sf-nm">{item.name}</span>
                <span className="sf-tg">{item.description ?? "Item da loja"} · {item.price} {item.currency}</span>
              </span>
            </a>
          ))}
          {!shopFeatured && shopQuick.length === 0 && (
            <div className="empty-line">Loja vazia no momento — volte mais tarde.</div>
          )}
          <a className="lob-p-link" href="/shop">Abrir loja completa</a>
        </div>

        {/* SOCIAL — rail completo (chat/quests/amigos) */}
        <div className="lob-psect lob-social-psect" hidden={!(panel?.side === "r" && panel.sect === "social")}>
          <SocialRail />
        </div>
      </aside>

      {/* settings popover */}
      <div
        className="lob-pop"
        id="lob-set-pop"
        role="dialog"
        aria-label="Configurações"
        hidden={!setOpen}
      >
        <div className="pop-t">Configurações</div>
        {(
          [
            ["sfx", "SFX"],
            ["music", "Música"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="set-row">
            <span className="s-l">{label}</span>
            <button
              type="button"
              className="sw on"
              role="switch"
              aria-checked={true}
              onClick={() => setToggle(key, false)}
            >
              <span className="sw-knob" />
            </button>
          </div>
        ))}
        <div className="set-row">
          <span className="s-l">Qualidade gráfica</span>
          <span className="s-v">Alta</span>
        </div>
      </div>

      {/* exit modal */}
      <div
        className={`lob-xmodal${exitOpen ? " open" : ""}`}
        aria-hidden={!exitOpen}
        onClick={(e) => {
          if (e.target === e.currentTarget) setExitOpen(false);
        }}
      >
        <div className="xm-card" role="dialog" aria-modal="true" aria-label="Sair da sessão">
          <div className="xm-t">Sair da sessão?</div>
          <div className="xm-s">Seu progresso fica salvo — você volta de onde parou.</div>
          <div className="xm-btns">
            <button type="button" className="xm-cancel" onClick={() => setExitOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="xm-go" onClick={() => logoutMutation.mutate()}>
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div className="toast show" id="lobby-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}