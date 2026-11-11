import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { getRoster, type RosterView } from '../../lib/api';
import { getFarm, type FarmView } from '../../lib/api-farm';
import { getTeams } from '../../lib/api-teams';
import {
  collectAdventure,
  getAdventure,
  startAdventure,
  type AdventureConfigView,
  type AdventurePageView,
} from '../../lib/api-adventure';
import { getPveWorld, savePveParty, startPveEncounter } from '../../lib/api-world';
import { useT } from '../../hooks/useLocale';
import {
  railExpeditionsStore,
  useRailExpeditions,
} from '../../lib/rail-expeditions-store';
import { worldGlobeStore } from '../../lib/world-globe-store';
import { DigimonSprite } from '../common/DigimonSprite';
import { CheckIcon } from '../common/icons';
import { ActiveExpCard } from '../adventure/ActiveExpCard';
import { ReportPanel } from '../adventure/ReportPanel';
import '../../styles/extensions-adventure.css';

const ADVENTURE_KEY = ['adventure'] as const;
const ROSTER_KEY = ['roster'] as const;
const FARM_KEY = ['farm'] as const;
const TEAMS_KEY = ['teams'] as const;
const WORLD_KEY = ['pve-world'] as const;

type ExpSubTab = 'config' | 'andamento' | 'historico';

const STAGE_RANK: Readonly<Record<string, number>> = {
  Fresh: 0,
  'In-Training': 1,
  Rookie: 2,
  Champion: 3,
  Ultimate: 4,
  Mega: 5,
  Ultra: 6,
};

// Mesmo fator de estágio que o backend usa em startPveEncounter p/ debitar meat.
const STAGE_MEAT_FACTOR: Readonly<Record<string, number>> = {
  Fresh: 0.5,
  'In-Training': 0.75,
  Rookie: 1,
  Champion: 1.5,
  Ultimate: 2,
  Mega: 2.75,
  Ultra: 3.5,
};

// Mesma conversão grid→lat/lon do WorldSceneHost: selecionar um lugar no rail
// aponta o globo pra ele (worldGlobeStore.set focus), então precisa das MESMAS
// coordenadas que o host usa pros nodes.
const worldPosition = (x: number, y: number): { lat: number; lon: number } => ({
  lat: 54 - y * 0.72,
  lon: x * 3.6 - 180,
});

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  netcore: 0,
  premium: false,
  premiumBonus: 0,
  buildings: [],
};

const fallbackConfig: AdventureConfigView = {
  minHours: 1,
  maxHours: 8,
  meatPerHour: 10,
  meatEscalationPerHour: 5,
  encountersPerHour: 3,
  partySize: 3,
  maxActive: 3,
};

/**
 * Painel "Expedições" do Social Rail — 3 sub-tabs (Config / Andamento /
 * Histórico). Reutiliza os endpoints já existentes (adventure p/ expedições
 * assíncronas, world p/ a lista de nodes, teams+roster p/ os times).
 *
 * Comportamento por página:
 *  - /world: Config + Andamento + Histórico.
 *  - qualquer outra página: Andamento + Histórico + botão "Ir para o Mundo"
 *    (não faz sentido configurar expedição sem ver o globo).
 * O contexto (sub-tab ativa, time/horas/destino escolhidos) persiste entre
 * páginas porque o rail vive no AppShell.
 */
export function ExpeditionsPanel({
  isWorldPage,
  goWorld,
  isActive,
}: {
  readonly isWorldPage: boolean;
  readonly goWorld: () => void;
  readonly isActive: boolean;
}): JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();

  const [expSubTab, setExpSubTab] = useState<ExpSubTab>('andamento');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(1);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  // O Config controla expedição (startAdventure) e batalha (startPveEncounter).
  const [mode, setMode] = useState<'expedition' | 'battle'>('expedition');
  const [notice, setNotice] = useState<string | null>(null);

  const rail = useRailExpeditions();

  // Gatilho vindo do globo (node "Enviar Expedição"): sub-tab Config + node.
  useEffect(() => {
    if (rail.openRequest === null) return;
    setExpSubTab('config');
    railExpeditionsStore.set({ openRequest: null });
  }, [rail.openRequest]);

  useEffect(() => {
    if (!isActive || rail.targetPlaceId === null) return;
    setSelectedPlaceId(rail.targetPlaceId);
    railExpeditionsStore.set({ targetPlaceId: null });
  }, [rail.targetPlaceId, isActive]);

  // Relógio pra contagem regressiva.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // ── queries ───────────────────────────────────────────────────────────
  const adventure = useQuery({
    queryKey: ADVENTURE_KEY,
    queryFn: getAdventure,
    refetchInterval: 15_000,
  });
  const world = useQuery({ queryKey: WORLD_KEY, queryFn: getPveWorld });
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: getTeams });
  const roster = useQuery({ queryKey: ROSTER_KEY, queryFn: getRoster });
  const farm = useQuery({ queryKey: FARM_KEY, queryFn: getFarm });

  const page = adventure.data ?? null;
  const config = page?.config ?? fallbackConfig;
  const active = page?.active ?? [];
  const lastCollected = page?.lastCollected ?? null;
  const meatOwned = farm.data?.balances.Meat ?? page?.meatOwned ?? 0;

  const places = world.data?.places ?? [];
  const teamList = teams.data?.teams ?? [];
  const rosterById = useMemo(() => {
    const map = new Map<string, RosterView>();
    for (const mon of roster.data?.roster ?? []) map.set(mon.id, mon);
    return map;
  }, [roster.data]);

  const completeTeams = useMemo(
    () => teamList.filter((team) => team.monIds.every((id) => id !== null)),
    [teamList],
  );

  // ── time selecionado + métricas (poder / estágios) ────────────────────
  const selectedTeam =
    completeTeams.find((team) => team.id === selectedTeamId) ??
    (completeTeams[0] ?? null);

  const { teamPower, teamStages } = useMemo(() => {
    const monIds = selectedTeam?.monIds.filter((id): id is string => id !== null) ?? [];
    let power = 0;
    let stages = 0;
    for (const monId of monIds) {
      const mon = rosterById.get(monId);
      const level = mon?.level ?? 1;
      const stage = mon?.template?.stage ?? 'Rookie';
      power += level;
      stages += STAGE_RANK[stage] ?? 2;
    }
    return { teamPower: power, teamStages: stages };
  }, [selectedTeam, rosterById]);

  const selectedPlace =
    places.find((place) => place.id === selectedPlaceId) ?? places[0] ?? null;

  // ── fórmula de custo (tempo × poder × estágio × node) ────────────────
  const cost = useMemo(() => {
    const baseNode = Math.max(1, selectedPlace?.maxWildLevel ?? 1);
    const tempoMult = 1 + (hours / 24) * 0.5;
    const poderMult = 1 + (teamPower / 1000) * 0.3;
    const estagioMult = 1 + (teamStages / 10) * 0.2;
    return {
      baseNode,
      tempoMult,
      poderMult,
      estagioMult,
      total: Math.max(
        1,
        Math.round(baseNode * tempoMult * poderMult * estagioMult),
      ),
    };
  }, [selectedPlace, hours, teamPower, teamStages]);

  // Custo real da batalha PvE (mesma fórmula do backend startPveEncounter:
  // soma level×fatorDeEstágio / 10, arredondada pra cima). Independe de horas.
  const battleCost = useMemo(() => {
    const monIds = selectedTeam?.monIds.filter((id): id is string => id !== null) ?? [];
    const sum = monIds.reduce((acc, monId) => {
      const mon = rosterById.get(monId);
      const level = mon?.level ?? 1;
      const stage = mon?.template?.stage ?? 'Rookie';
      return acc + level * (STAGE_MEAT_FACTOR[stage] ?? 1);
    }, 0);
    return Math.max(1, Math.ceil(sum / 10));
  }, [selectedTeam, rosterById]);

  const ensufficientMeat = meatOwned >= (mode === 'battle' ? battleCost : cost.total);
  const canSend =
    selectedTeam !== null &&
    selectedPlace !== null &&
    (selectedTeam?.monIds.filter((id): id is string => id !== null).length === config.partySize) &&
    ensufficientMeat;

  // ── envio ─────────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: (monIds: readonly string[]) => startAdventure(monIds, hours),
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_KEY, (prev) => ({
        active: [...(prev?.active ?? []), result.adventure],
        lastCollected: prev?.lastCollected ?? null,
        meatOwned: result.meatOwned,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_KEY });
      // Config limpa; rail vai pra Andamento.
      setSelectedTeamId(null);
      setHours(1);
      setSelectedPlaceId(null);
      setExpSubTab('andamento');
      setNotice(
        t('expeditions.sent', { hours: String(hours), party: String(result.adventure.party.length) }),
      );
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'send failed'),
  });

  // Batalha PvE (combate 3D controlado pelo jogador): salva o time como
  // exploreParty, inicia o match — o backend entrega o match no socket e o
  // RealtimeBridge (App) roteia pra /combat sozinho.
  const battleMutation = useMutation({
    mutationFn: async ({
      placeId,
      monIds,
    }: {
      readonly placeId: string;
      readonly monIds: readonly string[];
    }) => {
      await savePveParty('explore', [...monIds]);
      return startPveEncounter(placeId, 'explore', 1);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORLD_KEY });
      queryClient.invalidateQueries({ queryKey: ADVENTURE_KEY });
      queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_KEY });
      setSelectedTeamId(null);
      setHours(1);
      setSelectedPlaceId(null);
      setMode('expedition');
      setNotice(t('expeditions.battle_started'));
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'battle failed'),
  });

  const collectMutation = useMutation({
    mutationFn: (adventureId: string) => collectAdventure(adventureId),
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_KEY, (prev) => ({
        active: (prev?.active ?? []).filter((a) => a.id !== result.adventure.id),
        lastCollected: result.adventure,
        meatOwned: prev?.meatOwned ?? 0,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ADVENTURE_KEY });
      queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_KEY });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'collect failed'),
  });

  // Em páginas fora do Mundo o sub-tab Config é ocultado → cai pra Andamento.
  const visibleTab: ExpSubTab = !isWorldPage && expSubTab === 'config' ? 'andamento' : expSubTab;

  const hint: { readonly node: ReactNode; readonly warn: boolean } = useMemo(() => {
    if (selectedTeam === null || selectedTeam.monIds.filter((id): id is string => id !== null).length !== config.partySize) {
      return { node: <>{t('expeditions.pick_team')}</>, warn: false };
    }
    if (selectedPlace === null) return { node: <>{t('expeditions.pick_place')}</>, warn: false };
    const need = mode === 'battle' ? battleCost : cost.total;
    if (!ensufficientMeat) {
      return {
        node: <>{t('expeditions.need_meat', { need: String(need), have: String(meatOwned) })}</>,
        warn: true,
      };
    }
    if (mode === 'battle') {
      return { node: <>{t('expeditions.battle_ready', { meat: String(battleCost) })}</>, warn: false };
    }
    return {
      node: <>{t('expeditions.ready', { meat: String(cost.total), hours: String(hours) })}</>,
      warn: false,
    };
  }, [selectedTeam, selectedPlace, config.partySize, ensufficientMeat, cost.total, battleCost, mode, meatOwned, hours, t]);

  const presetHours = useMemo(
    () => [1, 2, 4, 8].filter((h) => h <= config.maxHours),
    [config.maxHours],
  );

  return (
    <div className="expeditions-panel">
      {/* ── sub-tabs ─────────────────────────────────────────────────── */}
      <div className="exp-tabs" role="tablist" aria-label={t('expeditions.title')}>
        {isWorldPage && (
          <button
            type="button"
            role="tab"
            aria-current={visibleTab === 'config'}
            className={visibleTab === 'config' ? 'is-active' : ''}
            onClick={() => setExpSubTab('config')}
          >
            {t('expeditions.config')}
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-current={visibleTab === 'andamento'}
          className={visibleTab === 'andamento' ? 'is-active' : ''}
          onClick={() => setExpSubTab('andamento')}
        >
          {t('expeditions.active')}
          {active.length > 0 && <span className="exp-tab-count">{active.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-current={visibleTab === 'historico'}
          className={visibleTab === 'historico' ? 'is-active' : ''}
          onClick={() => setExpSubTab('historico')}
        >
          {t('expeditions.history')}
        </button>
      </div>

      {notice !== null && (
        <div className="exp-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {/* ── CONFIG (só no Mundo) ─────────────────────────────────────── */}
      {isWorldPage && visibleTab === 'config' && (
        <div className="exp-config">
          <div className="exp-section">
            <div className="exp-section-hd">{t('expeditions.team')}</div>
            {completeTeams.length === 0 ? (
              <div className="exp-empty">{t('expeditions.no_teams')}</div>
            ) : (
              <div className="exp-team-list">
                {completeTeams.map((team) => {
                  const activeTeam = selectedTeam?.id === team.id;
                  const ready = team.monIds.filter((id): id is string => id !== null).length;
                  return (
                    <button
                      type="button"
                      key={team.id}
                      className={`exp-team${activeTeam ? ' is-selected' : ''}`}
                      onClick={() => setSelectedTeamId(team.id)}
                    >
                      <span className="exp-team-pick">
                        <CheckIcon />
                      </span>
                      <span className="exp-team-info">
                        <span className="exp-team-name">{team.name}</span>
                        <span className="exp-team-sub">
                          {ready}/{config.partySize} ·{' '}
                          {ready === config.partySize
                            ? t('expeditions.team_ready')
                            : t('expeditions.team_incomplete')}
                        </span>
                      </span>
                      <span className="exp-team-mons">
                        {team.monIds
                          .filter((id): id is string => id !== null)
                          .map((monId) => (
                            <span className="exp-team-mon" key={monId}>
                              <span className="exp-team-spr">
                                <DigimonSprite catalogId={rosterById.get(monId)?.catalogId ?? monId} />
                              </span>
                            </span>
                          ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* O seletor de modo (o "botão") aparece após escolher um time completo.
              Clicar num modo revela o restante do menu, de acordo com a função:
              expedição = idle (ficam horas, voltam com loot); batalha = PvE de
              combate 3D jogado pelo jogador (entra, luta em sequência, pode sair). */}
          {selectedTeam !== null && (
            <>
              <div className="exp-mode-tabs" role="tablist" aria-label={t('expeditions.mode_label')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'expedition'}
                  className={mode === 'expedition' ? 'is-active' : ''}
                  onClick={() => setMode('expedition')}
                >
                  {t('expeditions.mode_expedition')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'battle'}
                  className={mode === 'battle' ? 'is-active' : ''}
                  onClick={() => setMode('battle')}
                >
                  {t('expeditions.mode_battle')}
                </button>
              </div>

              <div className="exp-section">
                <div className="exp-section-hd">{t('expeditions.places')}</div>
                <div className="exp-place-list">
                  {places.map((place) => {
                    const isSel = selectedPlace?.id === place.id;
                    return (
                      <button
                        type="button"
                        key={place.id}
                        className={`exp-place${isSel ? ' is-selected' : ''}`}
                        onClick={() => {
                          setSelectedPlaceId(place.id);
                          // Rotaciona o globo pro node ficar no centro da câmera
                          // (e para o giro). O host é reativo ao store agora.
                          const idx = places.findIndex((p) => p.id === place.id);
                          worldGlobeStore.set({
                            selectedIdx: idx >= 0 ? idx : null,
                            focus: worldPosition(place.x, place.y),
                            autoSpin: false,
                          });
                        }}
                      >
                        <span className="exp-place-check">
                          <CheckIcon />
                        </span>
                        <span className="exp-place-name">{place.name}</span>
                        <span className="exp-place-sub">
                          {t('expeditions.danger', { danger: String(place.maxWildLevel) })}
                        </span>
                      </button>
                    );
                  })}
                  {places.length === 0 && (
                    <div className="exp-empty">{t('expeditions.no_places')}</div>
                  )}
                </div>
              </div>

              {mode === 'expedition' ? (
                <div className="exp-section">
                  <div className="exp-section-hd">{t('expeditions.time')}</div>
                  <div className="exp-hours">
                    <div className="exp-hours-row">
                      <span className="exp-hours-val">
                        {t('expeditions.hours', { hours: String(hours) })}
                      </span>
                      <div className="exp-presets">
                        {presetHours.map((h) => (
                          <button
                            type="button"
                            key={h}
                            className={h === hours ? 'is-active' : ''}
                            onClick={() => setHours(h)}
                          >
                            {h}h
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={config.minHours}
                      max={config.maxHours}
                      step="1"
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      aria-label="Expedition length in hours"
                    />
                  </div>
                  <div className="exp-cost">
                    <div className="exp-cost-row">
                      <span>{t('expeditions.cost')}</span>
                      <b className={ensufficientMeat ? '' : 'short'}>{cost.total}</b>
                      <span className="exp-cost-unit">{t('adventure.meat')}</span>
                    </div>
                    <div className="exp-cost-break">
                      <span>
                        node × {cost.baseNode} · tempo ×{cost.tempoMult.toFixed(2)} · poder ×
                        {cost.poderMult.toFixed(2)} · estágio ×{cost.estagioMult.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="exp-section">
                  <div className="exp-section-hd">{t('expeditions.battle_cost')}</div>
                  <div className="exp-cost">
                    <div className="exp-cost-row">
                      <span>{t('expeditions.cost')}</span>
                      <b className={ensufficientMeat ? '' : 'short'}>{battleCost}</b>
                      <span className="exp-cost-unit">{t('adventure.meat')}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="exp-actions">
                <span className={`exp-hint${hint.warn ? ' warn' : ''}`}>{hint.node}</span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canSend || (mode === 'battle' ? battleMutation.isPending : startMutation.isPending)}
                  onClick={() => {
                    const monIds = (selectedTeam?.monIds ?? []).filter(
                      (id): id is string => id !== null,
                    );
                    if (mode === 'battle') {
                      if (selectedPlace) battleMutation.mutate({ placeId: selectedPlace.id, monIds });
                      return;
                    }
                    startMutation.mutate(monIds);
                  }}
                >
                  {mode === 'battle'
                    ? battleMutation.isPending ? t('common.loading') : t('expeditions.enter_battle')
                    : startMutation.isPending ? t('common.loading') : t('expeditions.send')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ANDAMENTO ────────────────────────────────────────────────── */}
      {visibleTab === 'andamento' && (
        <div className="exp-active">
          {active.length > 0 ? (
            active.map((a) => (
              <ActiveExpCard
                key={a.id}
                active={a}
                now={now}
                config={config}
                onCollect={() => collectMutation.mutate(a.id)}
                isCollecting={collectMutation.isPending}
              />
            ))
          ) : (
            <div className="exp-empty">
              {isWorldPage
                ? t('expeditions.no_active_world')
                : t('expeditions.no_active')}
            </div>
          )}
          {!isWorldPage && <IrWorldButton goWorld={goWorld} />}
        </div>
      )}

      {/* ── HISTÓRICO ────────────────────────────────────────────────── */}
      {visibleTab === 'historico' && (
        <div className="exp-history">
          <ReportPanel report={lastCollected?.report ?? null} adventure={lastCollected} />
          {!isWorldPage && <IrWorldButton goWorld={goWorld} />}
        </div>
      )}
    </div>
  );
}

function IrWorldButton({ goWorld }: { readonly goWorld: () => void }): JSX.Element {
  const t = useT();
  return (
    <button type="button" className="btn primary exp-go-world" onClick={goWorld}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {t('expeditions.go_world')}
    </button>
  );
}