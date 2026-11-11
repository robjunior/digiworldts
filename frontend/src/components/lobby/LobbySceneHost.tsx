/**
 * LobbySceneHost — mantém a cena 3D do lobby VIVA a sessão toda.
 *
 * Montado UMA vez no AppShell (fora das rotas), trocar de página nunca
 * desmonta a cena: o GLB, os sprites da party e o renderer são criados uma
 * única vez. A cena só reconstrói quando a configuração dela MUDOU de fato
 * (fingerprint de conteúdo — não identidade de objeto: os refetches de 5s do
 * editor devolvem objetos novos com o mesmo conteúdo e já não derrubam nada).
 * Fora do lobby a cena fica escondida (visibility) e para de renderizar
 * frames, mas permanece montada — voltar pro lobby é instantâneo.
 *
 * A party (roster), o scene settings e a entidade do lobby são consultas
 * compartilhadas com as MESMAS keys que o Lobby.tsx usa: o react-query
 * deduplica num único fetch e a página lê o mesmo cache para a UI do overlay.
 *
 * Model fallback: enquanto a entidade ainda não resolveu (primeira carga
 * fria), reutiliza o último modelo já resolvido — NUNCA pisca o fallback
 * genérico (forest_biome) no meio do caminho. O DEFAULT_ARENA_MODEL só é
 * usado quando a cena do lobby de fato existe sem modelFile.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { DEFAULT_LOBBY_SCENE, type LobbySceneSettings, type SceneSettings } from '@digiworld/scene3d/scene';
import { DEFAULT_ARENA_MODEL, resolveSceneModelUrl } from '@digiworld/scene3d/arena-urls';

import { getRoster, type RosterView } from '../../lib/api';
import { getLobbyScene, getLobbySceneEntity } from '../../lib/api-scenes';
import { LobbyScene3D, type LobbyFigure } from './LobbyScene3D';

const ROSTER_QUERY_KEY = ['roster'] as const;
const SCENE_QUERY_KEY = ['lobby-scene'] as const;
const SCENE_ENTITY_QUERY_KEY = ['lobby-scene-entity'] as const;

function elementOf(mon: RosterView): string {
  return mon.template?.element ?? mon.template?.attribute ?? 'water';
}

/** Último modelUrl do lobby já resolvido (módulo, sobrevive a remounts e ao
 *  gc do cache): nunca re-exibir o fallback floresta enquanto a entidade da
 *  cena re-resolve depois de um hard reload. */
let lastResolvedLobbyModelUrl: string | null = null;

const LOBBY_SETTINGS_CACHE_TTL = 5_000;
const ROSTER_POLL_MS = 15_000;

export function LobbySceneHost(): JSX.Element {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isLobby = pathname === '/' || pathname === '/lobby';

  const rosterQuery = useQuery({
    queryKey: ROSTER_QUERY_KEY,
    queryFn: getRoster,
    staleTime: ROSTER_POLL_MS,
    refetchInterval: ROSTER_POLL_MS,
    refetchOnWindowFocus: true,
  });
  const sceneQuery = useQuery({
    queryKey: SCENE_QUERY_KEY,
    queryFn: getLobbyScene,
    staleTime: LOBBY_SETTINGS_CACHE_TTL,
    refetchInterval: LOBBY_SETTINGS_CACHE_TTL,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  const sceneEntityQuery = useQuery({
    queryKey: SCENE_ENTITY_QUERY_KEY,
    queryFn: getLobbySceneEntity,
    staleTime: LOBBY_SETTINGS_CACHE_TTL,
    refetchInterval: LOBBY_SETTINGS_CACHE_TTL,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  const figures = useMemo<readonly (LobbyFigure | null)[]>(() => {
    const roster = rosterQuery.data?.roster ?? [];
    return [0, 1, 2].map((slot) => {
      const mon = roster.find((m) => m.status === 'party' && m.slot === slot) ?? null;
      if (mon === null) return null;
      return {
        id: mon.id,
        catalogId: mon.catalogId,
        nickname: mon.nickname,
        level: mon.level,
        element: elementOf(mon),
      };
    });
  }, [rosterQuery.data]);

  const sceneSettings: LobbySceneSettings = sceneQuery.data ?? DEFAULT_LOBBY_SCENE;
  const lobbyEntity = sceneEntityQuery.data;

  // modelUrl estável: entidade ainda não resolveu (primeira carga) → usa o
  // último modelo conhecido; entidade SEM modelFile → fallback genérico só aí.
  let modelUrl: string | null = null;
  if (lobbyEntity !== undefined && lobbyEntity !== null) {
    const entitySettings = lobbyEntity.settings as Readonly<Record<string, unknown>> | undefined;
    const modelFile = typeof entitySettings?.modelFile === 'string' ? entitySettings.modelFile : undefined;
    modelUrl = resolveSceneModelUrl(modelFile, DEFAULT_ARENA_MODEL) ?? null;
    if (modelUrl !== null) lastResolvedLobbyModelUrl = modelUrl;
  } else {
    modelUrl = lastResolvedLobbyModelUrl;
  }

  return (
    <div
      className={`lobby-scene3d-host${isLobby ? ' is-visible' : ''}`}
      aria-hidden={!isLobby}
      data-od-id="lobby-scene-host"
    >
      <LobbyScene3D
        settings={sceneSettings}
        party={figures}
        modelUrl={modelUrl}
        useGlbSettings={lobbyEntity?.useGlbSettings === true}
        {...(lobbyEntity?.settings !== undefined ? { lighting: lobbyEntity.settings as Partial<SceneSettings> } : {})}
        visible={isLobby}
        onOpenCreature={(id) => navigate(`/creature/${id}`)}
      />
    </div>
  );
}