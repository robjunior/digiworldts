import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PvpQuestPeriod, PvpQuestWithProgress } from "@digiworld/shared/pvp-quest";

import { claimPvpQuest, formatPvpQuestReward, getPvpQuests } from "../../lib/api-pvp-quests";
import { useWsStore } from "../../state/wsStore";
import { CornerBar } from "../common/CornerBar";
import "../../styles/quest-bar.css";

/**
 * Barra de quests do lobby (canto inferior esquerdo, acima do daily streak).
 * Colapsada é uma barra única; clicar expande PARA CIMA revelando as quests e
 * as abas Diária / Semanal / Mensal.
 * Controlada de fora via `open`/`onOpenChange` para que o Lobby possa
 * garantir exclusividade (um menu aberto fecha os demais).
 * O chrome (trigger/caret/painel) vem do CornerBar compartilhado — aqui só o
 * conteúdo (abas de período + lista de quests).
 */
export type LobbyQuestBarProps = {
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
};

const STAR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
  </svg>
);

export function LobbyQuestBar({ open, onOpenChange }: LobbyQuestBarProps = {}): JSX.Element {
  const [selectedPeriod, setSelectedPeriod] = useState<PvpQuestPeriod>("DAILY");
  const [claiming, setClaiming] = useState<string | null>(null);

  const invalidatePvpQuests = useWsStore((state) => state.invalidatePvpQuests);
  const activeBattle = useWsStore((state) => state.activeBattle);

  const pvpQuery = useQuery({
    queryKey: ["pvp-quests"] as const,
    queryFn: getPvpQuests,
    staleTime: 30_000,
  });

  // invalida com base no estado do WS (batalha terminou), nunca no dado da query
  useEffect(() => {
    if (activeBattle?.status === "ended") {
      invalidatePvpQuests();
      void pvpQuery.refetch();
    }
  }, [activeBattle?.status, invalidatePvpQuests, pvpQuery]);

  const periods = pvpQuery.data?.periods ?? [];
  const selectedWindow = periods.find((w) => w.period === selectedPeriod);
  const quests = selectedWindow?.quests ?? [];

  const claimableCount = periods.reduce(
    (acc, w) =>
      acc +
      w.quests.filter((q) => q.state === "completed" && q.claimedAt === null).length,
    0,
  );

  const activeCount = periods.reduce(
    (acc, w) => acc + w.quests.filter((q) => q.state === "active" || q.state === "completed").length,
    0,
  );

  const handleClaim = async (
    period: PvpQuestPeriod,
    windowId: string,
    q: PvpQuestWithProgress,
  ): Promise<void> => {
    setClaiming(q.instanceId);
    try {
      const result = await claimPvpQuest(period, windowId, q.instanceId);
      if (result.ok) void pvpQuery.refetch();
    } catch {
      // mantém o estado atual
    } finally {
      setClaiming(null);
    }
  };

  return (
    <CornerBar
      className="quest-bar"
      dataOdId="quest-bar"
      icon={STAR_ICON}
      title="Quests"
      subtitle={
        claimableCount > 0
          ? `${claimableCount} pronta${claimableCount > 1 ? "s" : ""} para resgatar`
          : `${activeCount} em andamento`
      }
      badge={claimableCount}
      badgeTone="gold"
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="qb-periods" role="tablist" aria-label="Período de quests">
        {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((period) => {
          const win = periods.find((w) => w.period === period);
          const completed = win?.quests.filter((q) => q.state === "completed").length ?? 0;
          const total = win?.quests.length ?? 0;
          return (
            <button
              key={period}
              type="button"
              className={`qb-period${selectedPeriod === period ? " active" : ""}`}
              role="tab"
              aria-selected={selectedPeriod === period}
              onClick={() => setSelectedPeriod(period)}
            >
              {period.charAt(0) + period.slice(1).toLowerCase()}
              {total > 0 && <span className="qb-pcount">{completed}/{total}</span>}
            </button>
          );
        })}
      </div>

      <div className="qb-list">
        {quests.length === 0 ? (
          <div className="qb-empty">
            Nenhuma quest de {selectedPeriod.toLowerCase()} agora — volta mais tarde.
          </div>
        ) : (
          quests.map((q) => {
            const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
            const done = q.state === "completed";
            const claimed = q.state === "claimed";
            return (
              <div key={q.instanceId} className="qb-quest" data-od-id={`qb-quest-${q.instanceId}`}>
                <span className={`qb-star${done ? " done" : ""}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" />
                  </svg>
                </span>
                <div className="qb-qt">
                  <div className="qb-qn">{q.title}</div>
                  <div className="qb-qd">{formatPvpQuestReward(q.reward)}</div>
                  <div className="qb-prog">
                    <span className="fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className={`qb-count${done ? " done" : ""}`}>
                  {q.progress}/{q.target}
                </span>
                {done && !claimed && (
                  <button
                    type="button"
                    className="qb-claim"
                    disabled={claiming === q.instanceId}
                    onClick={() => handleClaim(selectedPeriod, selectedWindow!.windowId, q)}
                  >
                    {claiming === q.instanceId ? "Registrando…" : "Resgatar"}
                  </button>
                )}
                {claimed && <span className="qb-claim done">Resgatado</span>}
              </div>
            );
          })
        )}
      </div>
    </CornerBar>
  );
}
