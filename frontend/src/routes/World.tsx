import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoster } from '../lib/api';
import { getFarm } from '../lib/api-farm';
import { getTeams, type TeamView } from '../lib/api-teams';
import { getPveWorld, savePveParty, startPveEncounter } from '../lib/api-world';
import type { WorldRegion } from '@digiworld/shared/world';
import { WorldStrip } from '../components/world/WorldStrip';
import { WorldHoverTip } from '../components/world/WorldHoverTip';
import { useWorldGlobeUI, worldGlobeStore } from '../lib/world-globe-store';
import '../styles/extensions-world.css';
import '../styles/world-party-drawer.css';

const PARTY_SIZE = 3;
// A cena 3D (globo + digimons) vive no WorldSceneHost (AppShell), persistente —
// esta página só desenha a UI do overlay por cima dela e lê o worldGlobeStore
// pro estado interativo (seleção, hover, auto-spin, fallback de WebGL).

export function World(): JSX.Element {
  const client = useQueryClient();
  const world = useQuery({ queryKey: ['pve-world'], queryFn: getPveWorld });
  // same keys do host → react-query deduplica num único fetch.
  const roster = useQuery({ queryKey: ['roster'], queryFn: getRoster });
  const teams = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const farm = useQuery({ queryKey: ['farm'], queryFn: getFarm });

  const ui = useWorldGlobeUI();
  const [mode, setMode] = useState<'explore' | 'expedition'>('explore');
  const [partyPanelOpen, setPartyPanelOpen] = useState(false);
  const [hours, setHours] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const places = world.data?.places ?? [];
  const regions = useMemo<readonly WorldRegion[]>(
    () =>
      places.map((place) => ({
        id: place.id,
        label: place.name,
        description: place.description,
        element: 'null',
        biome: 'forest',
        lat: 0,
        lon: 0,
        dungeonId: place.id,
        levelCap: place.maxWildLevel ?? 99,
        danger: place.maxWildLevel ?? 1,
        scouted: true,
      })),
    [places],
  );
  const selectedPlace = ui.selectedIdx === null ? null : (places[ui.selectedIdx] ?? null);
  const preferences = world.data?.preferences;
  const saved = mode === 'explore' ? preferences?.exploreParty ?? [] : preferences?.expeditionParty ?? [];
  const available = (roster.data?.roster ?? []).filter((mon) => (mon.status === 'resting' || mon.status === 'party') && !mon.listedAt && (!mon.reviveAt || mon.reviveAt <= Date.now()));
  const teamList = teams.data?.teams ?? [];
  const selectedTeam = teamList.find((team) => team.monIds.filter((id): id is string => id !== null).join(',') === saved.join(',')) ?? null;
  const selectedParty = available.filter((mon) => saved.includes(mon.id));
  const stageFactor = (stage: string): number => ({ Fresh: 0.5, 'In-Training': 0.75, Rookie: 1, Champion: 1.5, Ultimate: 2, Mega: 2.75, Ultra: 3.5 }[stage] ?? 1);
  const meatNeeded = Math.max(1, Math.ceil(selectedParty.reduce((total, mon) => total + mon.level * stageFactor(mon.template?.stage ?? 'Rookie'), 0) / 10) * (mode === 'expedition' ? hours : 1));
  const saveParty = useMutation({
    mutationFn: (party: readonly string[]) => savePveParty(mode, party),
    onSuccess: ({ preferences: next }) => { client.setQueryData(['pve-world'], (old: typeof world.data) => old ? { ...old, preferences: next } : old); setNotice('Party salva.'); },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Não foi possível salvar a party.'),
  });
  const selectTeam = (team: TeamView): void => { const ids = team.monIds.filter((id): id is string => id !== null); if (ids.length !== PARTY_SIZE) { setNotice('A party must contain 3 Digimons.'); return; } saveParty.mutate(ids); };
  const start = useMutation({
    mutationFn: () => startPveEncounter(selectedPlace?.id ?? '', mode, hours),
    onError: (error) => { setNotice(error instanceof Error ? error.message : 'Não foi possível iniciar.'); setPartyPanelOpen(true); },
  });
  const toggleSpin = useCallback(() => worldGlobeStore.set({ autoSpin: !worldGlobeStore.get().autoSpin }), []);
  const toast = useRef<number | null>(null);
  useEffect(() => () => { if (toast.current !== null) window.clearTimeout(toast.current); }, []);

  return <main className="world-page-layout world-legacy">
    <div className="stage" data-od-id="globe-stage">
      {ui.webglFailed ? <div className="stage-fallback show" role="status"><div className="box"><b>Mapa 3D indisponível</b><br />Selecione uma localidade na lista.</div></div> : null}
      <div className="overlay"><WorldStrip selectedRegion={ui.selectedIdx === null ? null : regions[ui.selectedIdx] ?? null} autoSpin={ui.autoSpin} onToggleAutoSpin={toggleSpin} /><WorldHoverTip tip={ui.hoverTip} /></div>
    </div>
    {selectedPlace ? <section className="world-place-popup" aria-label={`Localidade ${selectedPlace.name}`}>
      <div className="world-place-popup__route" aria-hidden="true" /><span className="world-place-popup__eyebrow">LOCALIDADE SELECIONADA</span><h2>{selectedPlace.name}</h2><p>{selectedPlace.description || 'Uma localidade do mundo.'}</p>
      <div className="world-mode-tabs"><button type="button" className={mode === 'explore' ? 'is-active' : ''} onClick={() => { setMode('explore'); setPartyPanelOpen(true); }}>Explorar</button><button type="button" className={mode === 'expedition' ? 'is-active' : ''} onClick={() => { setMode('expedition'); setPartyPanelOpen(true); }}>Expedição</button></div>
      <button type="button" className="world-action" onClick={() => setPartyPanelOpen(true)}>Configurar party</button>
      <span className="world-place-popup__party">{selectedTeam?.name ?? 'Nenhuma party'} · Meat necessário: {meatNeeded}</span>{notice ? <span className="world-notice" role="status">{notice}</span> : null}
    </section> : null}
    {partyPanelOpen && selectedPlace ? <aside className="world-party-drawer" aria-label="Configuração da party"><button type="button" className="world-party-drawer__close" onClick={() => setPartyPanelOpen(false)}>×</button><span className="world-place-popup__eyebrow">{mode === 'explore' ? 'EXPLORAÇÃO' : 'EXPEDIÇÃO'}</span><h2>Escolha uma party criada</h2><p>Digimons individuais não podem ser selecionados aqui. Escolha uma party já criada.</p><div className="world-team-list">{teamList.map((team) => { const complete = team.monIds.every((id) => id !== null); const active = selectedTeam?.id === team.id; return <button type="button" key={team.id} className={`world-team-card${active ? ' is-selected' : ''}`} disabled={!complete || saveParty.isPending} onClick={() => selectTeam(team)}><strong>{team.name}</strong><small>{team.monIds.filter((id): id is string => id !== null).length}/{PARTY_SIZE} Digimons {complete ? '· ready' : '· incomplete'}</small></button>; })}</div>{mode === 'expedition' ? <label className="world-hours">Expedition time: <input type="range" min="1" max="8" value={hours} onChange={(event) => setHours(Number(event.target.value))} /><b>{hours}h</b></label> : null}<div className="world-meat-card"><span>Required meat</span><strong>{meatNeeded}</strong><small>Available: {farm.data?.balances.Meat ?? 0}</small></div><button type="button" className="world-action" disabled={!selectedTeam || selectedParty.length !== PARTY_SIZE || (farm.data?.balances.Meat ?? 0) < meatNeeded || saveParty.isPending || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : mode === 'explore' ? 'Start exploring' : 'Start expedition'}</button>{notice ? <span className="world-notice" role="status">{notice}</span> : null}</aside> : null}
  </main>;
}