import { useSyncExternalStore } from 'react';

import type { WorldHoverTipData } from '../components/world/WorldHoverTip';

/**
 * worldGlobeStore — estado interativo compartilhado entre o WorldSceneHost
 * (persistente no AppShell, dono da cena 3D do globo) e a página /world
 * (UI do overlay, montada/desmontada a cada navegação).
 *
 * Como o LobbySceneHost, o globo vive fora das rotas — trocar de página nunca
 * remonta a cena 3D. A seleção de região, hover, foco, auto-spin e o fallback
 * de WebGL precisam sobreviver à montagem/desmontagem da rota, então moram
 * aqui (módulo, vive a sessão toda) em vez de useState da rota. Leitura via
 * useSyncExternalStore (snapshot imutável), escrita via store.set(patch).
 */
export type WorldGlobeUI = {
  readonly selectedIdx: number | null;
  readonly focus: { lat: number; lon: number } | null;
  readonly hoveredIdx: number;
  readonly hoverTip: WorldHoverTipData | null;
  readonly webglFailed: boolean;
  readonly autoSpin: boolean;
};

const initialState = (): WorldGlobeUI => ({
  selectedIdx: null,
  focus: null,
  hoveredIdx: -1,
  hoverTip: null,
  webglFailed: false,
  autoSpin:
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true,
});

let state: WorldGlobeUI = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const worldGlobeStore = {
  /** Snapshot atual (imutável). Passado direto pro getSnapshot do hook. */
  get(): WorldGlobeUI {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(patch: Partial<WorldGlobeUI>): void {
    const next = { ...state, ...patch };
    state = next;
    emit();
  },
  reset(): void {
    state = initialState();
    emit();
  },
};

/** Hook reativo para ler o estado do globo (rota e host usam o mesmo). */
export function useWorldGlobeUI(): WorldGlobeUI {
  return useSyncExternalStore(
    worldGlobeStore.subscribe,
    worldGlobeStore.get,
    worldGlobeStore.get,
  );
}