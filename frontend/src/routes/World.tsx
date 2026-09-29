import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoster } from '../lib/api';
import { getFarm } from '../lib/api-farm';
import { getTeams, type TeamView } from '../lib/api-teams';
import { getPveWorld, savePveParty, startPveEncounter, type WorldObject } from '../lib/api-world';
import type { WorldRegion } from '@digiworld/shared/world';
import { getWorldSceneEntity } from '../lib/api-scenes';
import { resolveSceneModelUrl, DEFAULT_ARENA_MODEL } from '@digiworld/scene3d/arena-urls';
import type { SceneSettings } from '@digiworld/scene3d/scene';
import { WorldGlobe } from '../components/world/WorldGlobe';
import { WorldStrip } from '../components/world/WorldStrip';
import { WorldHoverTip, type WorldHoverTipData } from '../components/world/WorldHoverTip';
import '../styles/extensions-world.css';
import '../styles/world-party-drawer.css';

const PARTY_SIZE = 3;
const worldPosition = (x: number, y: number): { lat: number; lon: number } => ({ lat: 54 - y * 0.72, lon: x * 3.6 - 180 });
// Keeps the resolved world-scene model URL referentially stable across renders
// (mirrors the LobbySceneHost cache) so the globe doesn't rebuild per render.
let lastResolvedWorldModelUrl: string | null = null;

export function World(): JSX.Element {
  const client = useQueryClient();
  const world = useQuery({ queryKey: ['pve-world'], queryFn: getPveWorld });
  const roster = useQuery({ queryKey: ['roster'], queryFn: getRoster });
  const teams = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const farm = useQuery({ queryKey: ['farm'], queryFn: getFarm });
  const worldScene = useQuery({ queryKey: ['world-scene-entity'], queryFn: getWorldSceneEntity, staleTime: 30_000 });
  // The world scene is the 3D backdrop for the centered globe. `world` and
  // `lighting` come straight off the entity (react-query structural sharing
  // keeps the references stable across identical refetches) — identical to how
  // LobbySceneHost feeds LobbyScene3D, so WorldGlobe mounts once per content.
  const worldEntity = worldScene.data;
  const worldLighting: Partial<SceneSettings> | null =
    worldEntity && worldEntity.settings ? (worldEntity.settings as Partial<SceneSettings>) : null;
  const worldSettings = worldLighting?.world ?? null;
  const worldGlbSettings = worldEntity?.useGlbSettings === true;
  const hasWorldModelFile = typeof worldEntity?.settings?.modelFile === 'string' && !!worldEntity.settings.modelFile;
  const envUrl =
    worldEntity && hasWorldModelFile
      ? (resolveSceneModelUrl(worldEntity.settings.modelFile as string, DEFAULT_ARENA_MODEL) ?? null)
      : (lastResolvedWorldModelUrl ?? resolveSceneModelUrl(undefined, DEFAULT_ARENA_MODEL) ?? null);
  if (envUrl !== null && hasWorldModelFile) lastResolvedWorldModelUrl = envUrl;
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<'explore' | 'expedition'>('explore');
  const [partyPanelOpen, setPartyPanelOpen] = useState(false);
  const [hours, setHours] = useState(1);
  const [autoSpin, setAutoSpin] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [focus, setFocus] = useState<{ lat: number; lon: number } | null>(null);
  const [hoverTip, setHoverTip] = useState<WorldHoverTipData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  // Stable identities so WorldGlobe's mount effect doesn't rebuild the 3D
  // scene on every World re-render (hover/select/toggle). Inline arrays and
  // arrows are new each render, which flips the [worldObjects, onFailWebGL]
  // deps and blanks+re-inits the whole globe on every pointer move — the
  // opposite of the persistent lobby scene.
  const worldObjects = useMemo<readonly WorldObject[]>(() => [], []);
  const onFailWebGL = useCallback(() => setWebglFailed(true), []);
  const places = world.data?.places ?? [];
  const positions = useMemo(() => places.map((place) => worldPosition(place.x, place.y)), [places]);
  const regions = useMemo<readonly WorldRegion[]>(() => places.map((place, index) => ({
    id: place.id, label: place.name, description: place.description, element: 'null', biome: 'forest',
    lat: positions[index]?.lat ?? 0, lon: positions[index]?.lon ?? 0, dungeonId: place.id, levelCap: place.maxWildLevel ?? 99, danger: place.maxWildLevel ?? 1, scouted: true,
  })), [places, positions]);
  const selectedPlace = selectedIdx === null ? null : (places[selectedIdx] ?? null);
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
  const selectRegion = useCallback((index: number): void => { setSelectedIdx(index); const pos = positions[index]; if (pos) setFocus(pos); }, [positions]);
  const showTip = useCallback((tip: WorldHoverTipData | null) => setHoverTip(tip), []);
  const toggleSpin = useCallback(() => setAutoSpin((value) => !value), []);
  const toast = useRef<number | null>(null);
  useEffect(() => () => { if (toast.current !== null) window.clearTimeout(toast.current); }, []);

  return <main className="world-page-layout world-legacy">
    <div className="stage" data-od-id="globe-stage">
      <WorldGlobe regions={regions} worldObjects={worldObjects} focusLatLon={focus} autoSpin={autoSpin} selectedIdx={selectedIdx} hoveredIdx={hoveredIdx} onHoverChange={setHoveredIdx} onSelect={selectRegion} onHoverTip={showTip} onFailWebGL={onFailWebGL} world={worldSettings} lighting={worldLighting} envModelUrl={envUrl} useGlbSettings={worldGlbSettings} />
      {webglFailed ? <div className="stage-fallback show" role="status"><div className="box"><b>Mapa 3D indisponível</b><br />Selecione uma localidade na lista.</div></div> : null}
      <div className="overlay"><WorldStrip selectedRegion={selectedIdx === null ? null : regions[selectedIdx] ?? null} autoSpin={autoSpin} onToggleAutoSpin={toggleSpin} /><WorldHoverTip tip={hoverTip} /></div>
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
