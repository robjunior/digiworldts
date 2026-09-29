import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getPveWorld, savePveParty, startPveEncounter } from '../../lib/api-world';
import { getTeams, type TeamView } from '../../lib/api-teams';
import { getRoster } from '../../lib/api';
import { getFarm } from '../../lib/api-farm';
import {
  railExpeditionsStore,
  useRailExpeditions,
} from '../../lib/rail-expeditions-store';
import '../../styles/extensions-adventure.css';

const PARTY_SIZE = 3;
const WORLD_KEY = ['pve-world'] as const;
const TEAMS_KEY = ['teams'] as const;
const ROSTER_KEY = ['roster'] as const;
const FARM_KEY = ['farm'] as const;

const STAGE_FACTOR: Readonly<Record<string, number>> = {
  Fresh: 0.5,
  'In-Training': 0.75,
  Rookie: 1,
  Champion: 1.5,
  Ultimate: 2,
  Mega: 2.75,
  Ultra: 3.5,
};

type BattlePanelProps = {
  /** true quando a aba Battle é a ativa no rail (só assim o painel consome o
   *  targetPlaceId vindo do globo — evita corrida com a aba Expedições). */
  readonly active: boolean;
};

export function BattlePanel({ active }: BattlePanelProps): JSX.Element {
  const world = useQuery({ queryKey: WORLD_KEY, queryFn: getPveWorld });
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: getTeams });
  const roster = useQuery({ queryKey: ROSTER_KEY, queryFn: getRoster });
  const farm = useQuery({ queryKey: FARM_KEY, queryFn: getFarm });

  const rail = useRailExpeditions();

  const [mode, setMode] = useState<'explore' | 'expedition'>('explore');
  const [hours, setHours] = useState(1);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Só a aba ativa consome o pedido de pré-seleção vindo do globo (Battle).
  useEffect(() => {
    if (!active || rail.targetPlaceId === null) return;
    setSelectedPlaceId(rail.targetPlaceId);
    railExpeditionsStore.set({ targetPlaceId: null });
  }, [rail.targetPlaceId, active]);

  const places = world.data?.places ?? [];
  const selectedPlace =
    places.find((place) => place.id === selectedPlaceId) ?? places[0] ?? null;
  const teamList = teams.data?.teams ?? [];
  const selectedTeam =
    teamList.find((team) => team.id === selectedTeamId) ?? null;
  const meatAvailable = farm.data?.balances.Meat ?? 0;

  const selectedParty = (roster.data?.roster ?? []).filter(
    (mon) => selectedTeam?.monIds.includes(mon.id) === true,
  );
  const meatNeeded = Math.max(
    1,
    Math.ceil(
      selectedParty.reduce(
        (total, mon) =>
          total + mon.level * (STAGE_FACTOR[mon.template?.stage ?? 'Rookie'] ?? 1),
        0,
      ) / 10,
    ) * (mode === 'expedition' ? hours : 1),
  );

  const saveParty = useMutation({
    mutationFn: (party: readonly string[]) => savePveParty(mode, party),
    onSuccess: () => setNotice('Party salva.'),
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Não foi possível salvar a party.'),
  });
  const start = useMutation({
    mutationFn: () =>
      startPveEncounter(selectedPlace?.id ?? '', mode, hours),
    onSuccess: (res) => setNotice('Batalha iniciada!'),
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Não foi possível iniciar.'),
  });

  const selectTeam = (team: TeamView): void => {
    const ids = team.monIds.filter((id): id is string => id !== null);
    if (ids.length !== PARTY_SIZE) {
      setNotice('A party must contain 3 Digimons.');
      return;
    }
    setSelectedTeamId(team.id);
    saveParty.mutate(ids);
  };

  return (
    <div className="battle-panel">
      {notice ? (
        <div className="battle-notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <div className="battle-section">
        <div className="battle-section-hd">Localidade</div>
        <div className="battle-place-list">
          {places.map((place) => {
            const isSel = selectedPlace?.id === place.id;
            return (
              <button
                type="button"
                key={place.id}
                className={`battle-place${isSel ? ' is-selected' : ''}`}
                onClick={() => setSelectedPlaceId(place.id)}
              >
                <span className="battle-place-check">✓</span>
                <span className="battle-place-name">{place.name}</span>
                <span className="battle-place-sub">Lv {place.maxWildLevel}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="battle-section">
        <div className="battle-section-hd">Party</div>
        <p className="battle-hint">Escolha uma party criada com 3 Digimons.</p>
        <div className="battle-team-list">
          {teamList.length === 0 ? (
            <div className="battle-empty">Nenhuma party criada.</div>
          ) : (
            teamList.map((team) => {
              const complete = team.monIds.every((id) => id !== null);
              const active = selectedTeam?.id === team.id;
              return (
                <button
                  type="button"
                  key={team.id}
                  className={`battle-team${active ? ' is-selected' : ''}`}
                  disabled={!complete || saveParty.isPending}
                  onClick={() => selectTeam(team)}
                >
                  <strong>{team.name}</strong>
                  <small>
                    {team.monIds.filter((id): id is string => id !== null).length}/
                    {PARTY_SIZE} {complete ? '· ready' : '· incomplete'}
                  </small>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="battle-section">
        <div className="battle-mode-tabs">
          <button
            type="button"
            className={mode === 'explore' ? 'is-active' : ''}
            onClick={() => setMode('explore')}
          >
            Explore
          </button>
          <button
            type="button"
            className={mode === 'expedition' ? 'is-active' : ''}
            onClick={() => setMode('expedition')}
          >
            Expedition
          </button>
        </div>
        {mode === 'expedition' ? (
          <label className="battle-hours">
            Duration: {hours}h
            <input
              type="range"
              min="1"
              max="8"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
        ) : null}
      </div>

      <div className="battle-meat-card">
        <span>Required meat</span>
        <strong>{meatNeeded}</strong>
        <small>Available: {meatAvailable}</small>
      </div>

      <button
        type="button"
        className="battle-action"
        disabled={
          !selectedTeam ||
          selectedParty.length !== PARTY_SIZE ||
          meatAvailable < meatNeeded ||
          saveParty.isPending ||
          start.isPending
        }
        onClick={() => start.mutate()}
      >
        {start.isPending ? 'Starting…' : `Start ${mode === 'explore' ? 'battle' : 'expedition'}`}
      </button>
    </div>
  );
}