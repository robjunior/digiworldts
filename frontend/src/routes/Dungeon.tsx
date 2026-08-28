import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  activateDungeonTrigger,
  getDungeon,
  getDungeonNeighbors,
  moveInDungeon,
  startEncounter,
  startRandomEncounter,
  unlockDungeonDoor,
} from "../lib/api-dungeon";
import { ApiError, getBattleView, getRoster, requestFriend } from "../lib/api";
import { getCatalog } from "../lib/api-catalog";
import { getDialogue } from "../lib/api-dialogues";
import { getQuests } from "../lib/api-quests";
import { applyShopItem, getShop } from "../lib/api-shop";
import type {
  DungeonDoor,
  DungeonEncounter,
  DungeonItem,
  DungeonMoveResponse,
  DungeonRunView,
  DungeonTile,
  EncounterDigimon,
  TilesetGrant,
  UserDungeonRun,
} from "@digiworld/shared";
import type { TemplateDigimon } from "@digiworld/shared/digimon";
import { useWsStore, registerDungeonMoveResolver } from "../state/wsStore";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../hooks/useLocale";
import { useWebSocket } from "../hooks/useWebSocket";

import { DungeonPhaserView } from "../phaser-dungeon/DungeonPhaserView";
import { AutoToast } from "../components/common/Toast";
import { DungeonChatOverlay } from "../components/dungeon/DungeonChatOverlay";
import { DungeonFunctionShortcuts } from "../components/dungeon/DungeonFunctionShortcuts";
import { DungeonInventoryPanel } from "../components/dungeon/DungeonInventoryPanel";
import { DungeonQuestPanel } from "../components/dungeon/DungeonQuestPanel";
import { FnPanel } from "../components/dungeon/FnPanel";
import { DungeonDoorPrompt } from "../components/dungeon/DungeonDoorPrompt";
import { DialogueOverlay } from "../components/dungeon/DialogueOverlay";
import { DungeonStrip } from "../components/dungeon/DungeonStrip";
import type { PendingUnlock } from "../components/dungeon/types";
import "../styles/extensions-dungeon.css";

export function Dungeon(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const dungeonPlayers = useWsStore((state) => state.dungeonPlayers);
  const clearDungeonPlayers = useWsStore((state) => state.clearDungeonPlayers);
  const pvpInvite = useWsStore((state) => state.pvpInvite);
  const pvpNotice = useWsStore((state) => state.pvpNotice);
  const clearPvpInvite = useWsStore((state) => state.clearPvpInvite);
  const clearPvpNotice = useWsStore((state) => state.clearPvpNotice);
  const activeBattle = useWsStore((state) => state.activeBattle);
  const { send, readyState } = useWebSocket();

  useEffect(() => {
    if (!id) {
      navigate("/world", { replace: true });
    }
  }, [id, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dungeon", id],
    queryFn: () => {
      if (id === undefined) throw new Error("Dungeon id is required");
      return getDungeon(id);
    },
    enabled: !!id,
    staleTime: 0,
  });
  const neighborsQuery = useQuery({
    queryKey: ["dungeon-neighbors", id],
    queryFn: () => {
      if (id === undefined) throw new Error("Dungeon id is required");
      return getDungeonNeighbors(id);
    },
    enabled: !!id,
    // Fresh neighbors on every entry — a 30s stale window keeps a stale grid
    // (crossing a bridge/path onto another dungeon's boundary) visible after
    // returning to the same dungeon, making the walk appear stuck.
    staleTime: 0,
  });

  useEffect(() => {
    const neighbors = neighborsQuery.data?.neighbors ?? [];
    const activeIds = new Set([
      id,
      ...neighbors.map((neighbor) => neighbor.dungeonId),
    ]);
    for (const neighbor of neighbors) {
      queryClient.setQueryData(["dungeon", neighbor.dungeonId], neighbor.view);
    }
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey[0] === "dungeon" &&
        typeof query.queryKey[1] === "string" &&
        !activeIds.has(query.queryKey[1]),
    });
  }, [id, neighborsQuery.data, queryClient]);

  const rosterQuery = useQuery({
    queryKey: ["roster"] as const,
    queryFn: getRoster,
    staleTime: 30_000,
  });
  const shopQuery = useQuery({
    queryKey: ["shop"] as const,
    queryFn: getShop,
    staleTime: 15_000,
  });
  const catalogQuery = useQuery({
    queryKey: ["catalog"] as const,
    queryFn: getCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const templateById = useMemo<ReadonlyMap<string, TemplateDigimon>>(
    () =>
      new Map(
        (catalogQuery.data?.digimons ?? []).map(
          (entry) => [entry.id, entry] as const,
        ),
      ),
    [catalogQuery.data],
  );
  const party = useMemo(() => {
    const list = (rosterQuery.data?.roster ?? []).filter(
      (m) => m.status === "party",
    );
    return list.slice().sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  }, [rosterQuery.data]);
  const partyCatalogIds = useMemo(() => party.map((m) => m.catalogId), [party]);

  // Join the dungeon presence channel once the socket is open AND the
  // dungeon + roster queries have landed (an early join with an empty leader
  // catalogId is rejected by the server schema). Refs feed the latest
  // position so moves never retrigger the join; the joined ref dedupes and
  // resets on disconnect so a reconnect re-announces.
  const dataRef = useRef<DungeonRunView | undefined>(undefined);
  dataRef.current = data;
  const partyRef = useRef(party);
  partyRef.current = party;
  const trailRef = useRef<
    readonly { readonly x: number; readonly y: number }[]
  >([]);
  const joinedDungeonRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || readyState !== WebSocket.OPEN) {
      joinedDungeonRef.current = null;
      return;
    }
    const d = dataRef.current;
    const leaderCatalogId = partyRef.current[0]?.catalogId ?? "";
    if (d === undefined || leaderCatalogId === "") return;
    if (joinedDungeonRef.current === id) return;
    joinedDungeonRef.current = id;
    send({
      type: "dungeon:join",
      dungeonId: id,
      x: d.run.currentX,
      y: d.run.currentY,
      gridX: d.dungeon.gridX ?? 0,
      gridY: d.dungeon.gridY ?? 0,
      leaderCatalogId,
      party: partyRef.current.map((m) => m.catalogId),
      trail: trailRef.current.map((cell) => ({ x: cell.x, y: cell.y })),
    });
  }, [id, readyState, data, party, send]);

  useEffect(() => {
    return () => {
      if (joinedDungeonRef.current !== null) {
        joinedDungeonRef.current = null;
        send({ type: "dungeon:leave" });
        clearDungeonPlayers();
      }
    };
  }, [id, send, clearDungeonPlayers]);

  const partySpd = useMemo(() => {
    const leader = party[0];
    return (
      (leader?.template?.baseStats.spd ?? 50) + (leader?.statBonus.spd ?? 0)
    );
  }, [party]);
  const moveDurationMs = useMemo(
    () => Math.max(70, 260 - partySpd * 2),
    [partySpd],
  );

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // Not moveMutation.isPending: React state commits a render too late, so
  // several keydowns in one tick all read false and fire duplicate moves off
  // the same stale position. Refs flip synchronously.
  const movePendingRef = useRef(false);
  // Authoritative player position, mirrored synchronously from the last move
  // response. Reads in tryMove/handleCellClick must go through this ref —
  // `data` lags by one render, and a keydown firing between onSettled and the
  // re-render used to target a cell 2 tiles away → server rejects with
  // `not-adjacent` → swallowed steps + repeated warning toasts (feels laggy).
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Set when a move response warps into an adjacent dungeon (grid crossing).
  // The useEffect([id]) below must NOT reset facing/trail on that id change —
  // the crossing is a seam walk, not a fresh entry.
  const gridCrossingRef = useRef(false);
  const wildStartPendingRef = useRef(false);
  const continuousViewportRef = useRef<HTMLDivElement>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(
    null,
  );
  const [activeRandomEncounter, setActiveRandomEncounter] = useState<
    readonly EncounterDigimon[] | null
  >(null);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(
    null,
  );
  const [stepCount, setStepCount] = useState(0);
  const [selectedInvItemId, setSelectedInvItemId] = useState<string | null>(
    null,
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const [partyTrail, setPartyTrail] = useState<
    readonly { readonly x: number; readonly y: number }[]
  >([]);
  trailRef.current = partyTrail;
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [activeSheet, setActiveSheet] = useState<
    "log" | "items" | "quest" | null
  >(null);
  const [exitConfirm, setExitConfirm] = useState<{
    readonly x: number;
    readonly y: number;
    readonly to: string | null;
  } | null>(null);
  const [contextTarget, setContextTarget] = useState<{
    readonly userId: string;
    readonly displayName: string;
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [fnOpenId, setFnOpenId] = useState<string | null>(null);

  const handleOpenFunction = useCallback(
    (id: string) => {
      setFnOpenId((prev) => (prev === id ? null : id));
    },
    [],
  );

  useEffect(() => {
    if (gridCrossingRef.current) {
      gridCrossingRef.current = false;
      return;
    }
    setPartyTrail([]);
    setFacing("right");
  }, [id]);

  useEffect(() => {
    const x = data?.run.currentX;
    const y = data?.run.currentY;
    if (x === undefined || y === undefined) return;
    posRef.current = { x, y };
    setPartyTrail((prev) => {
      if (prev[0]?.x === x && prev[0]?.y === y) return prev;
      return [{ x, y }, ...prev].slice(0, 3);
    });
  }, [data?.run.currentX, data?.run.currentY]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const productById = useMemo(() => {
    const m = new Map<string, import("../lib/api-shop").ShopItemView>();
    for (const p of shopQuery.data?.catalog ?? []) m.set(p.id, p);
    return m;
  }, [shopQuery.data]);

  const flashToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimerRef.current !== null)
      window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  // Reconnect to a PvE battle the server still has active for this user but
  // the client lost track of (refresh mid-transition, failed navigation, etc).
  // GET /api/world/battle returns the same activeByUser battle dungeon
  // encounters live in; 404 means no battle to resume.
  const recoverActiveBattle = useCallback((): void => {
    if (!id) return;
    void getBattleView()
      .then((battle) => {
        handleServerMessage({
          type: "match",
          matchId: battle.id,
          view: battle,
        });
        navigate("/loading", {
          state: { mode: "combat", battle, returnTo: "/combat" },
        });
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.status === 400)
        )
          return;
        flashToast(
          error instanceof Error ? error.message : "Could not resume battle.",
        );
      });
  }, [id, handleServerMessage, navigate, flashToast]);

  useEffect(() => {
    recoverActiveBattle();
  }, [recoverActiveBattle]);

  // PvP/PvE match navigation: when the store transitions activeBattle
  // null→non-null and nothing else navigated first (the PvE encounter
  // callbacks navigate themselves and set 'dungeon-return' BEFORE this
  // effect can run — the sessionStorage guard preserves their
  // encounterId/kind payload), route into combat reusing the same
  // dungeon-return mechanism Combat's useDungeonReturn consumes.
  const hadActiveBattleRef = useRef(activeBattle !== null);
  useEffect(() => {
    const had = hadActiveBattleRef.current;
    hadActiveBattleRef.current = activeBattle !== null;
    if (had || activeBattle === null || id === undefined) return;
    if (sessionStorage.getItem("dungeon-return") === null) {
      sessionStorage.setItem(
        "dungeon-return",
        JSON.stringify({ dungeonId: id }),
      );
    }
    navigate("/loading", {
      state: { mode: "combat", battle: activeBattle, returnTo: "/combat" },
    });
  }, [activeBattle, id, navigate]);

  const handlePlayerClick = useCallback(
    (userId: string, displayName: string): void => {
      setContextTarget({ userId, displayName });
    },
    [],
  );

  const handleTextureFallback = useCallback(
    (failed: readonly TilesetGrant[]): void => {
      const names = failed.map((grant) => grant.id).join(", ");
      flashToast(
        `Tileset texture failed to load (${names}) — showing fallback map.`,
      );
    },
    [flashToast],
  );

  const pushDungeonSystem = useWsStore((state) => state.pushDungeonSystem);
  const pushLog = useCallback(
    (text: string, cls: "" | "hit" | "item"): void => {
      if (id !== undefined) pushDungeonSystem(id, text, cls);
    },
    [id, pushDungeonSystem],
  );

  const transitionToDungeon = useCallback(
    async (
      targetDungeonId: string,
      targetRun: UserDungeonRun,
    ): Promise<void> => {
      const neighbor = neighborsQuery.data?.neighbors.find(
        (entry) => entry.dungeonId === targetDungeonId,
      );
      try {
        if (neighbor) {
          queryClient.setQueryData(["dungeon", targetDungeonId], {
            ...neighbor.view,
            run: targetRun,
          });
        } else {
          await queryClient.fetchQuery({
            queryKey: ["dungeon", targetDungeonId],
            queryFn: () => getDungeon(targetDungeonId),
          });
        }
        gridCrossingRef.current = true;
        navigate(`/dungeon/${targetDungeonId}`, { replace: true });
      } catch (err) {
        flashToast(
          err instanceof Error
            ? err.message
            : "Could not load the next dungeon.",
        );
      }
    },
    [flashToast, navigate, neighborsQuery.data, queryClient],
  );

  const moveMutation = useMutation({
    mutationFn: async ({
      x,
      y,
    }: {
      x: number;
      y: number;
    }): Promise<DungeonMoveResponse> => {
      if (!id) throw new Error("No dungeon id");
      const dungeonId = id;
      const doHttp = (): Promise<DungeonMoveResponse> =>
        moveInDungeon(dungeonId, x, y, {
          party: partyCatalogIds,
          trail: partyTrail,
        });
      if (readyState !== WebSocket.OPEN) return doHttp();
      const correlationId = crypto.randomUUID();
      return await new Promise<DungeonMoveResponse>((resolve, reject) => {
        let settled = false;
        const guard = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          void doHttp().then(resolve, reject);
        }, 2500);
        registerDungeonMoveResolver(
          correlationId,
          (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            resolve(result);
          },
          (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            reject(error);
          },
        );
        send({
          type: "dungeon:move",
          dungeonId,
          x,
          y,
          party: partyCatalogIds,
          trail: [...partyTrail],
          correlationId,
        });
      });
    },
    onSuccess: (res, { x, y }) => {
      const dx = x - posRef.current.x;
      const dy = y - posRef.current.y;
      if (dx !== 0) setFacing(dx < 0 ? "left" : "right");
      posRef.current = { x: res.run.currentX, y: res.run.currentY };
      setStepCount((s) => s + 1);
      if (res.blockedByDoorId) {
        const door = data?.doors.find(
          (entry) => entry.id === res.blockedByDoorId,
        );
        setPendingUnlock({
          doorId: res.blockedByDoorId,
          keyItemId: door?.keyItemId ?? "",
        });
        pushLog(`Locked door at ${x}, ${y}.`, "hit");
        return;
      }
      setPendingUnlock(null);
      setActiveRandomEncounter(null);
      pushLog(`Moved to ${x}, ${y}.`, "");
      if (!Object.hasOwn(res, "warpToDungeonId")) {
        queryClient.setQueryData(
          ["dungeon", id],
          (old: DungeonRunView | undefined) => {
            if (!old) return old;
            return { ...old, run: res.run };
          },
        );
      }
      if (res.trapTriggered) {
        const t = res.trapTriggered;
        const detail = t.dodged
          ? `Trap avoided! (party avg SPD ${t.partyAvgSpd}, ${Math.round(t.avoidChance * 100)}% dodge)`
          : `Trap! ${t.effectSummary}.`;
        pushLog(detail, t.dodged ? "" : "hit");
      }
      if (res.pickedUpItemId) {
        const item = data?.items.find((i) => i.id === res.pickedUpItemId);
        if (item) {
          pushLog(`Picked up item.`, "item");
          flashToast(`Picked up item!`);
        }
        queryClient.invalidateQueries({ queryKey: ["shop"] });
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
        queryClient.invalidateQueries({ queryKey: ["roster"] });
      }
      if (res.triggeredEncounterId) {
        const enc = data?.encounters.find(
          (e) => e.id === res.triggeredEncounterId,
        );
        pushLog(`Ambushed by ${enc?.label ?? "enemies"}!`, "hit");
        setActiveEncounterId(res.triggeredEncounterId);
      }
      if (res.randomEncounter) {
        const mons = res.randomEncounter
          .map(
            (m) =>
              `${m.nickname || templateById.get(m.catalogId)?.name || m.catalogId} Lv ${m.level}`,
          )
          .join(", ");
        pushLog(`Wild encounter: ${mons}.`, "hit");
        if (!wildStartPendingRef.current) {
          wildStartPendingRef.current = true;
          startRandomEncounterMutation.mutate(res.randomEncounter);
        }
      }
      if (Object.hasOwn(res, "warpToDungeonId")) {
        const targetDungeonId = res.warpToDungeonId;
        if (targetDungeonId === null) navigate("/world");
        else if (targetDungeonId !== undefined) {
          // Re-anchor the party trail into the target map's coordinate space:
          // the old cells were in the source map, so followers would render
          // off-position (or vanish) for one frame. Place them trailing behind
          // the leader's entry cell along the walk direction instead. Clamp
          // into the target map — an entry at the map edge extrapolates cells
          // outside the schema bounds (e.g. x=-2) and the next move would 400.
          const entryX = res.run.currentX;
          const entryY = res.run.currentY;
          const dirX = Math.sign(dx);
          const dirY = Math.sign(dy);
          const targetView = neighborsQuery.data?.neighbors.find(
            (entry) => entry.dungeonId === targetDungeonId,
          )?.view;
          const maxX = Math.max(0, (targetView?.dungeon.width ?? 200) - 1);
          const maxY = Math.max(0, (targetView?.dungeon.height ?? 200) - 1);
          const clampCell = (x: number, y: number) => ({
            x: Math.max(0, Math.min(maxX, x)),
            y: Math.max(0, Math.min(maxY, y)),
          });
          setPartyTrail([
            clampCell(entryX, entryY),
            clampCell(entryX - dirX, entryY - dirY),
            clampCell(entryX - dirX * 2, entryY - dirY * 2),
          ]);
          void transitionToDungeon(targetDungeonId, res.run);
        }
      }
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.message === "battle-in-progress") {
        recoverActiveBattle();
        return;
      }
      flashToast(err.message || "Cannot move there.");
    },
    onSettled: () => {
      movePendingRef.current = false;
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (doorId: string) => {
      if (!id) throw new Error("No dungeon id");
      return unlockDungeonDoor(id, doorId);
    },
    onSuccess: ({ view }) => {
      queryClient.setQueryData(["dungeon", id], view);
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      setPendingUnlock(null);
      pushLog("Door unlocked.", "item");
      flashToast("Door unlocked.");
    },
    onError: (err: Error) => {
      flashToast(err.message || "Could not unlock door.");
    },
  });

  const activateLeverMutation = useMutation({
    mutationFn: async (triggerId: string) => {
      if (!id) throw new Error("No dungeon id");
      return activateDungeonTrigger(id, triggerId);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["dungeon", id], res.view);
      const trigger = res.view.triggers.find(
        (entry) => entry.id === res.triggeredTriggerId,
      );
      pushLog(`Pulled ${trigger?.label ?? "a lever"}!`, "item");
      flashToast(`${trigger?.label ?? "Lever"} activated!`);
      if (res.activatedDoorId) pushLog("A door swung open.", "item");
      if (res.activatedBridgeId) {
        const bridge = res.view.bridges.find(
          (entry) => entry.id === res.activatedBridgeId,
        );
        pushLog(`The ${bridge?.label ?? "bridge"} lowers!`, "item");
      }
    },
    onError: (err: Error) => {
      flashToast(err.message || "Could not activate lever.");
    },
  });

  const defeatMutation = {
    isPending: false,
    mutate: (_encId: string) => undefined,
  };

  const startEncounterMutation = useMutation({
    mutationFn: async (encId: string) => {
      if (!id) throw new Error("No dungeon id");
      return startEncounter(id, encId);
    },
    onSuccess: ({ battle }, encId) => {
      if (!id) return;
      handleServerMessage({ type: "match", matchId: battle.id, view: battle });
      sessionStorage.setItem(
        "dungeon-return",
        JSON.stringify({ dungeonId: id, encounterId: encId }),
      );
      navigate("/loading", {
        state: { mode: "combat", battle, returnTo: "/combat" },
      });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.message === "battle-in-progress") {
        setActiveEncounterId(null);
        recoverActiveBattle();
        return;
      }
      flashToast(err.message || "Could not start battle.");
    },
  });

  const startRandomEncounterMutation = useMutation({
    mutationFn: async (digimon: readonly EncounterDigimon[]) => {
      if (!id) throw new Error("No dungeon id");
      return startRandomEncounter(id, digimon);
    },
    onSuccess: ({ battle }) => {
      if (!id) return;
      handleServerMessage({ type: "match", matchId: battle.id, view: battle });
      sessionStorage.setItem(
        "dungeon-return",
        JSON.stringify({ dungeonId: id, encounterId: null, kind: "random" }),
      );
      setActiveRandomEncounter(null);
      navigate("/loading", {
        state: { mode: "combat", battle, returnTo: "/combat" },
      });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.message === "battle-in-progress") {
        setActiveRandomEncounter(null);
        recoverActiveBattle();
        return;
      }
      flashToast(err.message || "Could not start wild battle.");
    },
    onSettled: () => {
      wildStartPendingRef.current = false;
    },
  });

  const applyItemMutation = useMutation({
    mutationFn: ({
      itemId,
      monId,
    }: {
      readonly itemId: string;
      readonly monId?: string;
    }) => applyShopItem(itemId, monId),
    onSuccess: (result, variables) => {
      const item = shopQuery.data?.inventory.find(
        (entry) => entry.itemId === variables.itemId,
      );
      const label = item?.name ?? "Item";
      const target = variables.monId
        ? (party.find((m) => m.id === variables.monId)?.nickname ?? "party")
        : "party";
      pushLog(`${label} applied to ${target}.`, "item");
      flashToast(`${label} applied.`);
      setSelectedInvItemId(null);
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      void result;
    },
    onError: (err: Error) => {
      flashToast(err.message || "Could not apply item.");
      setSelectedInvItemId(null);
    },
  });

  const handleSelectItem = useCallback(
    (itemId: string, needsMon: boolean): void => {
      if (!needsMon) {
        applyItemMutation.mutate({ itemId });
        return;
      }
      setSelectedInvItemId((prev) => (prev === itemId ? null : itemId));
    },
    [applyItemMutation],
  );

  const handleTargetMon = useCallback(
    (monId: string): void => {
      if (!selectedInvItemId) return;
      applyItemMutation.mutate({ itemId: selectedInvItemId, monId });
    },
    [applyItemMutation, selectedInvItemId],
  );

  const { user } = useAuth();
  const [dialogueDismissed, setDialogueDismissed] = useState(false);

  // A dungeon that belongs to a quest opens that quest's intro on entry. This
  // is the only trigger for now; deliberate NPC interaction arrives with the
  // /interact endpoint.
  const questId = data?.dungeon.questId ?? null;
  const questsQuery = useQuery({
    queryKey: ["quests"],
    queryFn: getQuests,
    enabled: questId !== null,
  });
  const introDialogueId =
    questId === null
      ? null
      : (questsQuery.data?.find((q) => q.id === questId)?.introDialogueId ??
        null);

  const dialogueQuery = useQuery({
    queryKey: ["dialogue", introDialogueId],
    queryFn: () => getDialogue(introDialogueId as string),
    enabled: introDialogueId !== null && !dialogueDismissed,
  });

  useEffect(() => {
    if (!activeSheet) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveSheet(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSheet]);

  const handleToggleSheet = useCallback((sheet: "log" | "items" | "quest") => {
    setActiveSheet((prev) => (prev === sheet ? null : sheet));
  }, []);

  const quest = questsQuery.data?.find((q) => q.id === questId) ?? null;

  const activeDialogue = dialogueDismissed
    ? null
    : (dialogueQuery.data?.dialogue.definition ?? null);
  const dialogueOpen = activeDialogue !== null;

  const tryMove = useCallback(
    (dx: number, dy: number) => {
      if (dialogueOpen) return;
      if (activeEncounterId || activeRandomEncounter) {
        flashToast("Resolve the encounter first.");
        return;
      }
      if (movePendingRef.current) return;
      const run = queryClient.getQueryData<DungeonRunView>(["dungeon", id]);
      if (!run) return;
      const cx = run.run.currentX;
      const cy = run.run.currentY;
      const nx = cx + dx;
      const ny = cy + dy;
      const tileKey = `${nx},${ny}`;
      const walkable = run.tiles.some((t) => `${t.x},${t.y}` === tileKey);
      if (!walkable) {
        const bridgeDown = run.bridges.some(
          (bridge) =>
            bridge.enabled &&
            bridge.x === nx &&
            bridge.y === ny &&
            run.triggers.some(
              (trigger) =>
                trigger.enabled &&
                run.firedTriggerIds.includes(trigger.id) &&
                trigger.targets.some(
                  (target) =>
                    target.kind === "bridge" && target.bridgeId === bridge.id,
                ),
            ),
        );
        // Grid crossing: stepping off the map edge (or into a border wall) is a
        // legal move when a grid neighbor exists in that direction — the server
        // transitions automatically. Silent wall-block otherwise.
        const { dungeon } = run;
        const gridX = dungeon.gridX;
        const gridY = dungeon.gridY;
        const atBorder =
          nx < 0 ||
          nx >= dungeon.width ||
          ny < 0 ||
          ny >= dungeon.height ||
          (dx !== 0 && nx === (dx > 0 ? dungeon.width - 1 : 0)) ||
          (dy !== 0 && ny === (dy > 0 ? dungeon.height - 1 : 0));
        // Grid crossing: the server is authoritative (resolveGridEntry +
        // getAutomaticGridTransition) and rejects an invalid border step with a
        // 400 (toast) — never a crash. While the neighbors query is loading or
        // errored, defer to the server instead of silently swallowing the move,
        // so a legal crossing isn't blocked by an empty in-flight list.
        const crossable =
          atBorder &&
          dungeon.dungeonGroupId !== null &&
          gridX !== null &&
          gridY !== null &&
          ((neighborsQuery.data?.neighbors ?? []).some(
            (neighbor) =>
              neighbor.gridX === gridX + (dx !== 0 ? dx : 0) &&
              neighbor.gridY === gridY + (dy !== 0 ? dy : 0),
          ) ||
            neighborsQuery.isLoading ||
            neighborsQuery.isError);
        if (!bridgeDown && !crossable) {
          // Just silently do nothing if trying to move into a wall
          return;
        }
      }
      const exitWarp = run.warps.find(
        (warp) =>
          warp.x === nx && warp.y === ny && warp.targetDungeonId === null,
      );
      if (exitWarp && (run.groupInventory.length ?? 0) > 0) {
        setExitConfirm({ x: nx, y: ny, to: null });
        return;
      }
      movePendingRef.current = true;
      moveMutation.mutate({ x: nx, y: ny });
    },
    [
      id,
      dialogueOpen,
      activeEncounterId,
      activeRandomEncounter,
      moveMutation,
      flashToast,
      neighborsQuery,
    ],
  );

  const handleCellClick = useCallback(
    (x: number, y: number) => {
      const cx = posRef.current.x;
      const cy = posRef.current.y;
      const dist = Math.abs(cx - x) + Math.abs(cy - y);
      if (dist > 1) {
        flashToast("Can only move to adjacent tiles.");
        return;
      }
      if (dist <= 1) {
        const run = queryClient.getQueryData<DungeonRunView>(["dungeon", id]);
        const bossEnc = run?.encounters.find(
          (e) =>
            e.difficulty === "boss" &&
            e.x === x &&
            e.y === y &&
            !run.run.defeatedEncounters.includes(e.id),
        );
        if (bossEnc !== undefined) {
          setActiveEncounterId(bossEnc.id);
          return;
        }
        const lever = run?.triggers.find(
          (t) => t.enabled && t.x === x && t.y === y,
        );
        if (
          lever &&
          run !== undefined &&
          !run.firedTriggerIds.includes(lever.id)
        ) {
          activateLeverMutation.mutate(lever.id);
          return;
        }
      }
      if (dist === 0) return;
      tryMove(x - cx, y - cy);
    },
    [tryMove, flashToast, queryClient, id, activateLeverMutation],
  );

  useEffect(() => {
    if (!data) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;

      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "w":
        case "W":
        case "ArrowUp":
          dy = -1;
          break;
        case "s":
        case "S":
        case "ArrowDown":
          dy = 1;
          break;
        case "a":
        case "A":
        case "ArrowLeft":
          dx = -1;
          break;
        case "d":
        case "D":
        case "ArrowRight":
          dx = 1;
          break;
        default:
          return;
      }
      e.preventDefault();

      tryMove(dx, dy);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, tryMove]);

  if (error) {
    const code = error instanceof ApiError ? error.message : "";
    return (
      <div className="dungeon-gate-wrap">
        <div className="dungeon-gate" role="alert">
          <b>
            {code === "empty-party"
              ? t("dungeon.gate.empty_party.title")
              : t("dungeon.gate.error.title")}
          </b>
          <span>
            {code === "empty-party"
              ? t("dungeon.gate.empty_party.body")
              : String(error instanceof Error ? error.message : error)}
          </span>
          <div className="dungeon-gate-actions">
            <Link className="btn" to="/roster">
              {t("dungeon.gate.open_roster")}
            </Link>
            <Link className="btn btn--secondary" to="/world">
              {t("dungeon.gate.back_world")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="stage">
        <div style={{ padding: 20, color: "var(--el)" }}>Loading...</div>
      </div>
    );
  }

  const { dungeon, run, encounters, doors, groupInventory } = data;
  const isComplete = !!run.completedAt;

  // Determine active encounter object
  const activeEncounter = activeEncounterId
    ? (encounters.find((e) => e.id === activeEncounterId) ?? null)
    : null;
  const pendingDoor = pendingUnlock
    ? (doors.find((door) => door.id === pendingUnlock.doorId) ?? null)
    : null;
  const pendingKeyItemId =
    pendingDoor?.keyItemId ?? pendingUnlock?.keyItemId ?? "";
  const keyInventory =
    shopQuery.data?.inventory?.find(
      (entry) => entry.itemId === pendingKeyItemId,
    ) ?? null;
  const keyItem =
    shopQuery.data?.catalog?.find((entry) => entry.id === pendingKeyItemId) ??
    null;
  const keyName = keyInventory?.name ?? keyItem?.name ?? pendingKeyItemId;
  const canUnlock = pendingDoor?.dungeonKeyId
    ? groupInventory.some(
        (entry) =>
          entry.itemKind === "dungeon-key" &&
          entry.itemId === pendingDoor.dungeonKeyId &&
          entry.qty > 0,
      )
    : (keyInventory?.qty ?? 0) >= 1;

  return (
    <>
      <div
        className="stage"
        data-od-id="dungeon-stage"
        style={{ "--el": "var(--el-light)" } as CSSProperties}
      >
        <DungeonStrip
          dungeonName={dungeon.name}
          currentX={run.currentX}
          currentY={run.currentY}
        />

        <div className="view">
          {activeDialogue !== null ? (
            <DialogueOverlay
              definition={activeDialogue}
              variables={{ player_name: user?.displayName ?? "Tamer" }}
              onClose={() => setDialogueDismissed(true)}
            />
          ) : null}
          {pendingDoor ? (
            <DungeonDoorPrompt
              pendingDoor={pendingDoor}
              keyName={keyName}
              canUnlock={canUnlock}
              isUnlocking={unlockMutation.isPending}
              onUnlock={(doorId) => unlockMutation.mutate(doorId)}
            />
          ) : null}
          <DungeonPhaserView
            viewportRef={continuousViewportRef}
            active={data}
            neighbors={neighborsQuery.data?.neighbors ?? []}
            remotePlayers={dungeonPlayers}
            facing={facing}
            moveDurationMs={moveDurationMs}
            party={party}
            partyTrail={partyTrail}
            onCellClick={handleCellClick}
            onPlayerClick={handlePlayerClick}
            onTextureFallback={handleTextureFallback}
          />
        </div>

        <div className="controls">
          <div className="dhint">
            {isComplete ? (
              <b>
                Modo exploração livre — todos os caminhos abertos. Encontre o
                portal para voltar à cidade.
              </b>
            ) : (
              <b>
                Clique num tile adjacente ou use WASD/setas. O portal vermelho
                leva à cidade.
              </b>
            )}
            <span className="dhint-stats">
              Passos {stepCount} · Encontros {run.defeatedEncounters.length}/
              {encounters.length} · {dungeon.name}
            </span>
          </div>
        </div>
      </div>
      <DungeonFunctionShortcuts onOpen={handleOpenFunction} />

      {activeSheet !== null && (
        <div className="sheet-backdrop" onClick={() => setActiveSheet(null)} />
      )}

      {exitConfirm !== null ? (
        <div className="sheet-backdrop" role="presentation">
          <div
            className="door-unlock-prompt"
            role="dialog"
            aria-modal="true"
            aria-live="polite"
          >
            <div>
              <b>Usar o portal para a cidade?</b>
              <span>
                Você tem {groupInventory.length} item
                {groupInventory.length === 1 ? "" : "s"} exclusivo
                {groupInventory.length === 1 ? "" : "s"} da dungeon. Atravessar
                o portal descarta {groupInventory.length === 1 ? "ele" : "eles"}
                .
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const target = exitConfirm;
                setExitConfirm(null);
                movePendingRef.current = true;
                moveMutation.mutate({ x: target.x, y: target.y });
              }}
              disabled={moveMutation.isPending}
            >
              Atravessar
            </button>
            <button type="button" onClick={() => setExitConfirm(null)}>
              Ficar
            </button>
          </div>
        </div>
      ) : null}

      {contextTarget !== null ? (
        <div
          className="sheet-backdrop dialog-backdrop"
          onClick={() => setContextTarget(null)}
        >
          <div className="context-menu-panel" role="dialog" aria-modal="true">
            <b>{contextTarget.displayName}</b>
            <button
              type="button"
              onClick={() => {
                send({
                  type: "pvp:invite",
                  targetUserId: contextTarget.userId,
                  dungeonId: id!,
                });
                setContextTarget(null);
                flashToast("Battle invite sent.");
              }}
            >
              PvP (x1)
            </button>
            <button
              type="button"
              onClick={() => {
                void requestFriend(contextTarget.displayName)
                  .then(() => {
                    setContextTarget(null);
                    flashToast("Friend request sent.");
                  })
                  .catch((err: unknown) => {
                    setContextTarget(null);
                    flashToast(
                      err instanceof Error
                        ? err.message
                        : "Could not send friend request.",
                    );
                  });
              }}
            >
              Amigo
            </button>
            <button
              type="button"
              onClick={() => {
                setContextTarget(null);
                setChatOpen(true);
              }}
            >
              Chat
            </button>
            <button type="button" disabled>
              Seguir
            </button>
            <button type="button" disabled>
              Trocar
            </button>
          </div>
        </div>
      ) : null}

      {pvpInvite !== null ? (
        <div className="sheet-backdrop dialog-backdrop" role="presentation">
          <div
            className="context-menu-panel pvp-invite-panel"
            role="dialog"
            aria-modal="true"
            aria-live="polite"
          >
            <b>{pvpInvite.fromName} invites you to battle!</b>
            <div className="context-menu-row">
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  send({
                    type: "pvp:response",
                    inviteId: pvpInvite.inviteId,
                    accept: true,
                  });
                  clearPvpInvite();
                }}
              >
                Aceitar
              </button>
              <button
                type="button"
                onClick={() => {
                  send({
                    type: "pvp:response",
                    inviteId: pvpInvite.inviteId,
                    accept: false,
                  });
                  clearPvpInvite();
                }}
              >
                Recusar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {id !== undefined && (
        <DungeonChatOverlay
          dungeonId={id}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onReopen={() => setChatOpen(true)}
        />
      )}

      <DungeonFunctionShortcuts onOpen={handleOpenFunction} />
      {fnOpenId ? (
        <FnPanel
          title={
            fnOpenId === 'inventory'
              ? 'Inventário'
              : fnOpenId === 'quests'
                ? 'Quests'
                : fnOpenId === 'map'
                  ? 'Mapa Mundi'
                  : fnOpenId === 'roster'
                    ? 'Roster'
                    : fnOpenId === 'digidex'
                      ? 'DigiDex'
                      : fnOpenId === 'character'
                        ? 'Personagem'
                        : fnOpenId === 'friends'
                          ? 'Amigos'
                          : fnOpenId === 'guild'
                            ? 'Guilda'
                            : fnOpenId
          }
          sub={
            fnOpenId === 'inventory'
              ? 'Itens, consumíveis e equip.'
              : fnOpenId === 'quests'
                ? 'Missões ativas e recompensas.'
                : fnOpenId === 'map'
                  ? 'O mundo e regiões liberadas.'
                  : fnOpenId === 'roster'
                    ? 'Seus Digimon e a party ativa.'
                    : fnOpenId === 'digidex'
                      ? 'Códice de espécies capturadas.'
                      : fnOpenId === 'character'
                        ? 'Status do Tamer e atributos.'
                        : fnOpenId === 'friends'
                          ? 'Lista de amigos e presença.'
                          : fnOpenId === 'guild'
                            ? 'Sua guilda e membros.'
                            : undefined
          }
          soon={fnOpenId === 'friends' || fnOpenId === 'guild'}
          onClose={() => setFnOpenId(null)}
        >
          {fnOpenId === 'inventory' ? (
            <DungeonInventoryPanel
              inventory={shopQuery.data?.inventory ?? []}
              productById={productById}
              selectedItemId={selectedInvItemId}
              busy={applyItemMutation.isPending}
              onSelectItem={handleSelectItem}
            />
          ) : fnOpenId === 'quests' ? (
            <DungeonQuestPanel quest={quest} />
          ) : (
            <div className="fn-skeleton" />
          )}
        </FnPanel>
      ) : null}

      {toast !== null ? (
        <div className="toast show" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      <AutoToast
        message={pvpNotice}
        onDismiss={clearPvpNotice}
        durationMs={3000}
      />
    </>
  );
}
