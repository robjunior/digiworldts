/**
 * WorldSceneHost — mantém a cena 3D do MUNDO VIVA a sessão toda.
 *
 * Mesmo padrão do LobbySceneHost: montado UMA vez no AppShell, fora das
 * rotas. Trocar de página nunca desmonta o globo — GLB, sprites dos digimons e
 * renderer são criados uma única vez; fora de /world a cena fica escondida
 * (visibility) e o WorldGlobe pausa os frames, mas permanece montada — voltar
 * pro mundo é instantâneo, sem recarregar nem piscar o fallback/floresta.
 *
 * O globo precisa de interação (clicar num nó de localidade → popup da rota),
 * então o estado de seleção/foco/hover/auto-spin/fallback vive no
 * worldGlobeStore (external store) e é lido pelos DOIS lados: o host passa pro
 * WorldGlobe, e a rota /world usa pra UI do overlay. As consultas usam as MESMAS
 * keys que a rota (['pve-world'], ['roster'], ['teams'], ['world-scene-entity'])
 * — o react-query deduplica num único fetch e cada lado lê o mesmo cache.
 */
import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import type { WorldRegion } from '@digiworld/shared/world';
import { resolveSceneModelUrl, DEFAULT_ARENA_MODEL } from '@digiworld/scene3d/arena-urls';
import type { SceneSettings } from '@digiworld/scene3d/scene';

import { getRoster } from '../../lib/api';
import { getTeams } from '../../lib/api-teams';
import { getPveWorld, getWorldObjects, type WorldObject } from '../../lib/api-world';
import { getWorldSceneEntity } from '../../lib/api-scenes';
import { worldGlobeStore, useWorldGlobeUI } from '../../lib/world-globe-store';
import { WorldGlobe } from './WorldGlobe';
import type { WorldHoverTipData } from './WorldHoverTip';
import '../../styles/extensions-world.css';

const worldPosition = (x: number, y: number): { lat: number; lon: number } => ({
  lat: 54 - y * 0.72,
  lon: x * 3.6 - 180,
});

/** Último modelUrl do mundo já resolvido (módulo, sobrevive a remounts e ao gc
 *  do cache): nunca re-exibir o fallback floresta quando a rota re-resolve. */
let lastResolvedWorldModelUrl: string | null = null;

export function WorldSceneHost(): JSX.Element {
  const { pathname } = useLocation();
  const isWorld = pathname === '/world';

  const world = useQuery({ queryKey: ['pve-world'] as const, queryFn: getPveWorld });
  const worldObjectsQuery = useQuery({
    queryKey: ['world-objects'] as const,
    queryFn: getWorldObjects,
    staleTime: 30_000,
  });
  const roster = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster });
  const teams = useQuery({ queryKey: ['teams'] as const, queryFn: getTeams });
  const worldScene = useQuery({
    queryKey: ['world-scene-entity'] as const,
    queryFn: getWorldSceneEntity,
    staleTime: 30_000,
  });

  const worldEntity = worldScene.data;
  const worldLighting: Partial<SceneSettings> | null =
    worldEntity?.settings ? (worldEntity.settings as Partial<SceneSettings>) : null;
  const worldSettings = worldLighting?.world ?? null;
  const worldGlbSettings = worldEntity?.useGlbSettings === true;
  const hasWorldModelFile =
    typeof worldEntity?.settings?.modelFile === 'string' && !!worldEntity.settings.modelFile;
  const envUrl =
    worldEntity && hasWorldModelFile
      ? resolveSceneModelUrl(worldEntity.settings.modelFile as string, DEFAULT_ARENA_MODEL) ?? null
      : (lastResolvedWorldModelUrl ?? resolveSceneModelUrl(undefined, DEFAULT_ARENA_MODEL) ?? null);
  if (envUrl !== null && hasWorldModelFile) lastResolvedWorldModelUrl = envUrl;

  const places = world.data?.places ?? [];
  const positions = useMemo(() => places.map((place) => worldPosition(place.x, place.y)), [places]);
  const regions = useMemo<readonly WorldRegion[]>(
    () =>
      places.map((place, index) => ({
        id: place.id,
        label: place.name,
        description: place.description,
        element: 'null',
        biome: 'forest',
        lat: positions[index]?.lat ?? 0,
        lon: positions[index]?.lon ?? 0,
        dungeonId: place.id,
        levelCap: place.maxWildLevel ?? 99,
        danger: place.maxWildLevel ?? 1,
        scouted: true,
      })),
    [places, positions],
  );
  // Nodes do mundo (world_objects): o globo as posiciona por lat/lon, então
  // re-mapeia x/y com o MESMO worldPosition dos regions — os marcadores caem
  // exatamente nas localidades. Identidade estável (useMemo) para não derrubar
  // a cena 3D a cada render.
  const worldObjects = useMemo<readonly WorldObject[]>(
    () =>
      (worldObjectsQuery.data?.objects ?? []).map((o) => {
        const pos = worldPosition(o.x, o.y);
        return { ...o, lat: pos.lat, lon: pos.lon };
      }),
    [worldObjectsQuery.data?.objects],
  );

  // Digimons de TODOS os times ATIVOS andando em volta do globo (>=3 garantidos).
  const teamWanderers = useMemo(() => {
    const byId = new Map((roster.data?.roster ?? []).map((m) => [m.id, m]));
    const allTeams = teams.data?.teams ?? [];
    const activeTeams = allTeams.filter((t) => t.active === true);
    const source = activeTeams.length > 0 ? activeTeams : allTeams;
    const seen = new Set<string>();
    const out: { id: string; catalogId: string; element?: string }[] = [];
    for (const team of source) {
      for (const mid of team.monIds) {
        if (!mid || seen.has(mid)) continue;
        const mon = byId.get(mid);
        if (!mon) continue;
        seen.add(mid);
        const el = mon.template?.element;
        out.push(
          el ? { id: mon.id, catalogId: mon.catalogId, element: el } : { id: mon.id, catalogId: mon.catalogId },
        );
      }
    }
    const PLACEHOLDER_CATALOG = ['skb-1', 'skb-2', 'skb-3'];
    for (let i = 0; out.length < 3; i++) {
      out.push({ id: `wander:ph:${i}`, catalogId: PLACEHOLDER_CATALOG[i % PLACEHOLDER_CATALOG.length] ?? 'skb-1' });
    }
    return out;
  }, [teams.data, roster.data]);

  // callbacks estáveis — gravam no store pra rota e globo lerem o mesmo estado.
  const onFailWebGL = useCallback(() => worldGlobeStore.set({ webglFailed: true }), []);
  const onHoverChange = useCallback((index: number) => worldGlobeStore.set({ hoveredIdx: index }), []);
  const onHoverTip = useCallback(
    (tip: WorldHoverTipData | null) => worldGlobeStore.set({ hoverTip: tip }),
    [],
  );
  const onSelect = useCallback(
    (index: number) => {
      const pos = positions[index] ?? null;
      worldGlobeStore.set({
        selectedIdx: pos ? index : null,
        focus: pos,
        // Parar o giro automático: o node focando precisa permanecer centralizado.
        autoSpin: false,
      });
    },
    [positions],
  );

  // Estado do globo: assinamos REATIVAMENTE (hook, não snapshot) pra o host
  // re-renderizar quando o store mudar de fora (clique no globo, seleção no
  // rail) — sem isso o WorldGlobe só veria o foco/seleção no próximo render
  // por outro motivo e nada acontecia ao clicar num node.
  const ui = useWorldGlobeUI();

  return (
    <div
      className={`world-scene3d-host${isWorld ? ' is-visible' : ''}`}
      aria-hidden={!isWorld}
      data-od-id="world-scene-host"
    >
      <WorldGlobe
        regions={regions}
        worldObjects={worldObjects}
        focusLatLon={ui.focus}
        autoSpin={ui.autoSpin}
        selectedIdx={ui.selectedIdx}
        hoveredIdx={ui.hoveredIdx}
        onHoverChange={onHoverChange}
        onSelect={onSelect}
        onHoverTip={onHoverTip}
        onFailWebGL={onFailWebGL}
        world={worldSettings}
        lighting={worldLighting}
        envModelUrl={envUrl}
        useGlbSettings={worldGlbSettings}
        wanderers={teamWanderers}
        visible={isWorld}
      />
    </div>
  );
}