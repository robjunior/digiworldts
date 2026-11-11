/**
 * Render smoke test for LobbySceneHost — a cena 3D do lobby persistente.
 *
 * O host vive no AppShell e NUNCA desmonta ao trocar de página. A party + a
 * cena só são carregadas uma vez; o LobbyScene3D (mocado aqui — o WebGL não
 * roda em happy-dom) recebe props estáveis. Asserts:
 *
 *   - entidade da cena AINDA pendente → modelUrl = null (NUNCA o fallback
 *     floresta: o DEFAULT_ARENA_MODEL só vale quando a cena existe sem
 *     modelFile — senão piscava a floresta a cada carga fria);
 *   - entidade resolveu com modelFile → modelUrl = modelo real (dark_lodge);
 *   - entidade nula DEPOIS de uma resolução → reusa o último modelo conhecido
 *     (memória de módulo) em vez de piscar a floresta;
 *   - fora do lobby (outra rota) → visible=false + classe escondida; no
 *     lobby → visible=true.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DEFAULT_LOBBY_SCENE } from '@digiworld/scene3d/scene';

const mocks = vi.hoisted(() => ({
  getRoster: vi.fn(),
  getLobbyScene: vi.fn(),
  getLobbySceneEntity: vi.fn(),
  lastProps: {} as Record<string, unknown>,
}));

vi.mock('../../lib/api', () => ({ getRoster: mocks.getRoster }));
vi.mock('../../lib/api-scenes', () => ({
  getLobbyScene: mocks.getLobbyScene,
  getLobbySceneEntity: mocks.getLobbySceneEntity,
}));
vi.mock('./LobbyScene3D', () => ({
  LobbyScene3D: (props: Record<string, unknown>) => {
    mocks.lastProps = props;
    return null;
  },
}));

import { LobbySceneHost } from './LobbySceneHost';

function mount(initialPath: string): { host: HTMLElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness(): JSX.Element {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, createElement(LobbySceneHost)),
    );
  }
  const root = createRoot(host);
  act(() => {
    flushSync(() => root.render(createElement(Harness)));
  });
  return { host, root };
}

async function settle(): Promise<void> {
  // alguns ticks: a resolução da query v5 passa por microtask + macrotask
  // antes do re-render do observer; um único setTimeout(0) às vezes lê o
  // estado pendente (modelUrl ainda null).
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const lobbyEntity = {
  id: 'scn_lobby',
  name: 'Lobby',
  kind: 'lobby' as const,
  elements: [],
  settings: { modelFile: 'dark_lodge_biome.glb' },
  useGlbSettings: false,
  weather: null,
  timeOfDay: null,
  createdAt: 1,
  updatedAt: 1,
};

describe('LobbySceneHost (cena persistente do lobby)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoster.mockResolvedValue({ roster: [] });
    mocks.getLobbyScene.mockResolvedValue(DEFAULT_LOBBY_SCENE);
  });

  it('entidade ainda pendente: modelUrl fica null — NUNCA o fallback floresta', async () => {
    mocks.getLobbySceneEntity.mockReturnValue(new Promise(() => undefined));
    const { host, root } = mount('/');
    await settle();
    try {
      const sceneHost = host.querySelector('[data-od-id="lobby-scene-host"]');
      expect(sceneHost).toBeTruthy();
      expect(mocks.lastProps.modelUrl).toBeNull();
      expect(mocks.lastProps.visible).toBe(true);
      // sem GLB de fallback: a cena espera o modelo REAL em vez de piscar a floresta
      expect(String(mocks.lastProps.modelUrl)).not.toContain('forest');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('entidade com modelFile: resolve o modelo real (dark_lodge) e monta a party', async () => {
    mocks.getLobbySceneEntity.mockResolvedValue(lobbyEntity);
    const { host, root } = mount('/');
    await settle();
    try {
      expect(host.querySelector('[data-od-id="lobby-scene-host"]')).toBeTruthy();
      expect(String(mocks.lastProps.modelUrl)).toContain('dark_lodge');
      expect(mocks.lastProps.useGlbSettings).toBe(false);
      expect(mocks.lastProps.settings).toEqual(DEFAULT_LOBBY_SCENE);
      expect(mocks.lastProps.visible).toBe(true);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('fora do lobby: cena continua montada porém oculta (visible=false + classe)', async () => {
    mocks.getLobbySceneEntity.mockResolvedValue(lobbyEntity);
    const { host, root } = mount('/roster');
    await settle();
    try {
      // host RENDERIZADO (não desmontado) em qualquer página...
      const sceneHost = host.querySelector('[data-od-id="lobby-scene-host"]') as HTMLElement | null;
      expect(sceneHost).toBeTruthy();
      // ...porém escondido fora do lobby
      expect(sceneHost?.className).not.toContain('is-visible');
      expect(mocks.lastProps.visible).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('sem entidade de lobby DEPOIS de uma resolução: reusa o último modelo (sem floresta)', async () => {
    mocks.getLobbySceneEntity.mockResolvedValue(lobbyEntity);
    const first = mount('/');
    await settle();
    act(() => first.root.unmount());
    first.host.remove();

    // agora a entidade some (backend sem lobby) — mas a memória do módulo
    // mantém o último modelo; o fallback floresta NÃO reaparece
    mocks.getLobbySceneEntity.mockResolvedValue(null);
    const { host, root } = mount('/');
    await settle();
    try {
      expect(host.querySelector('[data-od-id="lobby-scene-host"]')).toBeTruthy();
      expect(String(mocks.lastProps.modelUrl)).toContain('dark_lodge');
      expect(String(mocks.lastProps.modelUrl)).not.toContain('forest');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});