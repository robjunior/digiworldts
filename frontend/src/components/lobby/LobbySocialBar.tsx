import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  getFriends,
  requestFriend,
  acceptFriend,
  removeFriend,
  type FriendView,
  type FriendRequestView,
} from "../../lib/api";
import { useWsStore } from "../../state/wsStore";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocket } from "../../hooks/useWebSocket";
import { CornerBar } from "../common/CornerBar";
import "../../styles/social-bar.css";

const FRIENDS_QUERY_KEY = ["friends"] as const;

const SOCIAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

type DmSession = { readonly userId: string; readonly name: string };
export type LobbySocialTab = "online" | "chat" | "friends";

export type LobbySocialBarProps = {
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /**
   * Rótulo do gatilho colapsado. Cada página dá o seu (lobby "Social", world
   * "Social", nursery "Social") para o canto não repetir texto genérico.
   */
  readonly title?: string;
  /** Linha secundária do gatilho; default = contagem de online. */
  readonly subtitle?: string;
  /** Ícone do gatilho; default = duas pessoas. */
  readonly icon?: ReactNode;
  /** Injeta a navegação ao clicar no gatilho, mantendo o painel aberto. */
  readonly onTriggerClick?: () => void;
};

/**
 * Barra social (canto inferior direito) — funde presença + chat + amigos num
 * painel único com três abas: Online | Chat | Amigos. Colapsada é um trigger
 * único; clicar expande PARA CIMA revelando o painel. Mantém a exclusividade
 * de menus via open/onOpenChange (um overlay aberto fecha os demais).
 *
 * Compartilhada: mora no lobby, no world e no nursery. O rótulo/ícone do
 * gatilho é props (cada canto dá o seu), e o painel em si é idêntico.
 */
export function LobbySocialBar({
  open,
  onOpenChange,
  title = "Social",
  subtitle,
  icon,
  onTriggerClick,
}: LobbySocialBarProps = {}): JSX.Element {
  const { user } = useAuth();
  const { send } = useWebSocket();

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  const presence = useWsStore((s) => s.presence);
  const chat = useWsStore((s) => s.chat);
  const dmsByPeer = useWsStore((s) => s.dmsByPeer);
  const dmOpened = useWsStore((s) => s.dmOpened);
  const consumeDmOpened = useWsStore((s) => s.consumeDmOpened);

  const [tab, setTab] = useState<LobbySocialTab>("online");
  const [activeChannel, setActiveChannel] = useState("general");
  const [openDms, setOpenDms] = useState<readonly DmSession[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatLogRef = useRef<HTMLDivElement>(null);

  const [friendSearch, setFriendSearch] = useState("");
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addFriendSearch, setAddFriendSearch] = useState("");
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [duelNotice, setDuelNotice] = useState<string | null>(null);
  const duelTimer = useRef<number | null>(null);

  const friendsQuery = useQuery({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: getFriends,
    staleTime: 15_000,
  });
  const allFriends: readonly FriendView[] = friendsQuery.data?.friends ?? [];
  const incomingRequests: readonly FriendRequestView[] =
    friendsQuery.data?.incoming ?? [];

  const activeDmUserId = activeChannel.startsWith("dm:")
    ? activeChannel.slice(3)
    : null;
  const activeDmName = openDms.find((d) => d.userId === activeDmUserId)?.name;
  const visibleLog = activeDmUserId
    ? (dmsByPeer[activeDmUserId] ?? [])
    : chat;

  const onlineCount = presence.length;
  const subLine =
    subtitle ?? (onlineCount === 0 ? "Ninguém online" : `${onlineCount} online`);

  // O gatilho é do CornerBar; só o gancho de navegação fica aqui.
  const handleTrigger = useCallback(() => {
    onTriggerClick?.();
  }, [onTriggerClick]);

  const setOpen = useCallback(
    (next: boolean): void => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );
  const close = useCallback((): void => setOpen(false), [setOpen]);

  // auto-scroll chat
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [visibleLog]);

  const openTab = (t: LobbySocialTab): void => {
    if (isOpen && tab === t) {
      close();
    } else {
      setOpen(true);
      setTab(t);
    }
  };

  const handleOpenDm = useCallback(
    (userId: string, name: string) => {
      setOpenDms((prev) =>
        prev.some((d) => d.userId === userId)
          ? prev
          : [...prev, { userId, name }],
      );
      setActiveChannel(`dm:${userId}`);
      setTab("chat");
      setOpen(true);
      send({ type: "dm:opened", toUserId: userId });
    },
    [send, setOpen],
  );

  useEffect(() => {
    if (dmOpened.length === 0) return;
    const newly = dmOpened.filter(
      (d) => !openDms.some((op) => op.userId === d.fromUserId),
    );
    if (newly.length > 0) {
      const names = new Map(newly.map((d) => [d.fromUserId, d.fromName]));
      const first = newly[0];
      setOpenDms((prev) => [
        ...prev,
        ...Array.from(names.entries()).map(([userId, name]) => ({
          userId,
          name,
        })),
      ]);
      if (first !== undefined) {
        setActiveChannel(`dm:${first.fromUserId}`);
        setTab("chat");
        setOpen(true);
      }
    }
    consumeDmOpened();
  }, [dmOpened, openDms, consumeDmOpened, setOpen]);

  const closeDm = useCallback((userId: string) => {
    setOpenDms((prev) => prev.filter((d) => d.userId !== userId));
    setActiveChannel((cur) => (cur === `dm:${userId}` ? "general" : cur));
  }, []);

  const onChatSubmit = (e: FormEvent): void => {
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

  const filteredFriends = allFriends.filter(
    (f) =>
      !friendSearch ||
      f.displayName.toLowerCase().includes(friendSearch.toLowerCase()),
  );
  const onlineFriends = filteredFriends.filter((f) => f.online);
  const offlineFriends = filteredFriends.filter((f) => !f.online);

  const handleRemoveFriend = async (userId: string): Promise<void> => {
    await removeFriend(userId);
    friendsQuery.refetch();
  };
  const handleAcceptRequest = async (userId: string): Promise<void> => {
    await acceptFriend(userId);
    friendsQuery.refetch();
  };
  const handleDeclineRequest = async (userId: string): Promise<void> => {
    await removeFriend(userId);
    friendsQuery.refetch();
  };
  const handleSendRequest = async (displayName: string): Promise<void> => {
    await requestFriend(displayName);
    setSentRequests((prev) => new Set(prev).add(displayName));
    friendsQuery.refetch();
  };
  const handleChallengeDuel = useCallback(
    (userId: string, name: string) => {
      send({ type: "pvp:invite", targetUserId: userId });
      setDuelNotice(`Duelo proposto para ${name}.`);
      if (duelTimer.current !== null) window.clearTimeout(duelTimer.current);
      duelTimer.current = window.setTimeout(() => setDuelNotice(null), 3000);
    },
    [send],
  );

  return (
    <CornerBar
      className="lsoc"
      dataOdId="lobby-social"
      icon={icon ?? SOCIAL_ICON}
      title={title}
      subtitle={subLine}
      badge={onlineCount}
      badgeTone="signal"
      open={isOpen}
      onOpenChange={setOpen}
      onTriggerClick={handleTrigger}
    >
      <div className="lsoc-tabs" role="tablist" aria-label="Social seções">
        {(
          [
            ["online", `Online · ${onlineCount}`],
            ["chat", "Chat"],
            ["friends", "Amigos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`lsoc-tab${tab === id ? " active" : ""}`}
            onClick={() => openTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* presença (Online) */}
      {tab === "online" && (
        <div className="lsoc-pane" key="online" data-od-id="lsoc-pane-online">
          <div className="lsoc-online">
            {presence.length === 0 ? (
              <div className="lsoc-empty">
                Nenhum jogador online agora — chame um amigo ou comece uma partida.
              </div>
            ) : (
              presence.map((u) => (
                <div key={u.userId} className="lsoc-row" data-od-id={`soc-row-${u.userId}`}>
                  <span className="lsoc-dot" aria-hidden="true" />
                  <span className="lsoc-name">{u.displayName}</span>
                  <span className="lsoc-tag">Online</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}


        {/* chat */}
        {tab === "chat" && (
        <div className="lsoc-pane" key="chat" data-od-id="lsoc-pane-chat">
          <div className="lsoc-chat">
            <div className="lsoc-channels" role="tablist" aria-label="Canais">
              <button
                className="lsoc-ch-btn"
                role="tab"
                aria-current={activeChannel === "general"}
                onClick={() => setActiveChannel("general")}
              >
                General
              </button>
              {openDms.map((dm) => (
                <span key={dm.userId} className="lsoc-ch-tab">
                  <button
                    className="lsoc-ch-btn"
                    role="tab"
                    aria-current={activeChannel === `dm:${dm.userId}`}
                    onClick={() => setActiveChannel(`dm:${dm.userId}`)}
                  >
                    {dm.name}
                  </button>
                  <button
                    className="lsoc-ch-close"
                    aria-label={`Fechar DM com ${dm.name}`}
                    onClick={() => closeDm(dm.userId)}
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>

            <div
              className="lsoc-log"
              role="log"
              aria-live="polite"
              aria-label="Chat"
              ref={chatLogRef}
            >
              {visibleLog.length === 0 ? (
                <div className="lsoc-empty">
                  {activeDmUserId
                    ? `Nenhuma mensagem ainda — diga oi para ${activeDmName ?? "eles"}.`
                    : "Nenhuma mensagem ainda — comece o papo."}
                </div>
              ) : (
                visibleLog.map((m) => {
                  const isMe = m.from === user?.id;
                  return (
                    <div key={m.from + m.at + m.text.slice(0, 10)} className="lsoc-msg">
                      <span className="ts">
                        {new Date(m.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className={`who${isMe ? " me" : ""}`}>
                        {m.displayName}
                        {isMe ? " (você)" : ""}
                      </span>
                      <span className="tx">{m.text}</span>
                    </div>
                  );
                })
              )}
            </div>

            <form className="lsoc-form" onSubmit={onChatSubmit}>
              <input
                type="text"
                placeholder={`Mensagem ${activeDmName ?? "General"}…`}
                autoComplete="off"
                maxLength={240}
                aria-label="Mensagem de chat"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button type="submit" disabled={!chatInput.trim()}>
                Enviar
              </button>
            </form>
          </div>
        </div>
        )}

        {/* amigos */}
        {tab === "friends" && (
        <div className="lsoc-pane" key="friends" data-od-id="lsoc-pane-friends">
          <div className="lsoc-friends">
            <div className="lsoc-friends-toolbar">
              <input
                type="text"
                placeholder="Buscar amigos…"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                aria-label="Buscar amigos"
              />
              <button className="lsoc-add" onClick={() => setAddFriendOpen(true)}>
                <svg viewBox="0 0 24 24">
                  <path d="M12 5v14m-7-7h14" strokeLinecap="round" />
                </svg>
                Adicionar
              </button>
            </div>

            {duelNotice !== null && (
              <div className="lsoc-note" role="status" aria-live="polite">
                {duelNotice}
              </div>
            )}

            {incomingRequests.length > 0 && (
              <div className="lsoc-fsection">
                <div className="lsoc-fsection-hd">
                  <span className="k">
                    Solicitações <span className="n">({incomingRequests.length})</span>
                  </span>
                </div>
                {incomingRequests.map((r) => (
                  <div key={r.userId} className="lsoc-request">
                    <span className="lsoc-av">{r.displayName[0]}</span>
                    <div className="lsoc-finfo">
                      <div className="lsoc-fnm">{r.displayName}</div>
                      <div className="lsoc-fsub">Quer ser seu amigo</div>
                    </div>
                    <div className="lsoc-ract">
                      <button
                        className="lsoc-accept"
                        onClick={() => handleAcceptRequest(r.userId)}
                        aria-label={`Aceitar ${r.displayName}`}
                      >
                        ✓
                      </button>
                      <button
                        className="lsoc-decline"
                        onClick={() => handleDeclineRequest(r.userId)}
                        aria-label={`Recusar ${r.displayName}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="lsoc-fsection">
              <div className="lsoc-fsection-hd">
                <span className="k">
                  Online <span className="n">({onlineFriends.length})</span>
                </span>
              </div>
              {onlineFriends.map((f) => (
                <div key={f.userId} className="lsoc-frow">
                  <span className="lsoc-av">
                    {f.displayName[0]}
                    <span className="online-dot" aria-hidden="true" />
                  </span>
                  <div className="lsoc-finfo">
                    <div className="lsoc-fnm">{f.displayName}</div>
                    <div className="lsoc-fsub">Online</div>
                  </div>
                  <div className="lsoc-facts">
                    <button
                      className="lsoc-fact dm"
                      onClick={() => handleOpenDm(f.userId, f.displayName)}
                      aria-label={`Mensagem para ${f.displayName}`}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <button
                      className="lsoc-fact duel"
                      onClick={() => handleChallengeDuel(f.userId, f.displayName)}
                      title={`Desafiar ${f.displayName} para um duelo`}
                      aria-label={`Desafiar ${f.displayName} para um duelo`}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
                        <path d="M13 19l6-6" />
                        <path d="M16 16l4 4" transform="rotate(180 18 18)" />
                        <path d="M19 21l2-2-2-2-2 2z" />
                      </svg>
                    </button>
                    <button
                      className="lsoc-fact remove"
                      onClick={() => handleRemoveFriend(f.userId)}
                      aria-label={`Remover ${f.displayName}`}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {offlineFriends.length > 0 && (
              <div className="lsoc-fsection">
                <div className="lsoc-fsection-hd">
                  <span className="k">
                    Offline <span className="n">({offlineFriends.length})</span>
                  </span>
                </div>
                {offlineFriends.map((f) => (
                  <div key={f.userId} className="lsoc-frow offline">
                    <span className="lsoc-av">
                      {f.displayName[0]}
                      <span className="online-dot off" aria-hidden="true" />
                    </span>
                    <div className="lsoc-finfo">
                      <div className="lsoc-fnm">{f.displayName}</div>
                      <div className="lsoc-fsub">Offline</div>
                    </div>
                    <div className="lsoc-facts">
                      <button className="lsoc-fact dm" disabled aria-label={`Mensagem ${f.displayName} (offline)`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                      <button className="lsoc-fact remove" onClick={() => handleRemoveFriend(f.userId)} aria-label={`Remover ${f.displayName}`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {filteredFriends.length === 0 && friendSearch && (
              <div className="lsoc-empty">
                Nenhum amigo corresponde a &quot;{friendSearch}&quot;
              </div>
            )}

            {/* add friend modal */}
            <div
              className={`lsoc-afm${addFriendOpen ? " open" : ""}`}
              onClick={() => setAddFriendOpen(false)}
            >
              <div className="lsoc-afm-box" onClick={(e) => e.stopPropagation()}>
                <div className="lsoc-afm-hd">
                  <h3>Adicionar amigo</h3>
                  <button className="lsoc-afm-close" onClick={() => setAddFriendOpen(false)} aria-label="Fechar">
                    ×
                  </button>
                </div>
                <input
                  className="lsoc-afm-input"
                  type="text"
                  placeholder="Digite o nome de usuário…"
                  value={addFriendSearch}
                  onChange={(e) => setAddFriendSearch(e.target.value)}
                  autoFocus
                />
                <div className="lsoc-afm-results">
                  {addFriendSearch.trim().length < 3 ? (
                    <div className="lsoc-afm-empty">
                      Digite um nome para enviar uma solicitação
                    </div>
                  ) : sentRequests.has(addFriendSearch.trim()) ? (
                    <div className="lsoc-afm-empty">Solicitação já enviada</div>
                  ) : (
                    <div className="lsoc-afm-result">
                      <span className="nm">{addFriendSearch.trim()}</span>
                      <button
                        className="lsoc-afm-send"
                        onClick={() => handleSendRequest(addFriendSearch.trim())}
                      >
                        Enviar solicitação
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        )}
    </CornerBar>
  );
}