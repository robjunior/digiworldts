import { useSyncExternalStore } from 'react';

/**
 * railExpeditionsStore — ponte entre a página /world (que dispara o gatilho
 * "Enviar Expedição" num node do globo) e o SocialRail (que abre a aba
 * Expedições → Config com esse node pré-selecionado).
 *
 * O rail vive no AppShell (persistente entre rotas), enquanto a página /world
 * é montada/desmontada a cada navegação — por isso o "abrir com o node X" não
 * pode ser estado local da rota. Usa o mesmo padrão do worldGlobeStore
 * (useSyncExternalStore + módulo singleton).
 */
export type RailIntentTab = 'expeditions' | 'battle';

export type RailExpeditionsState = {
  /** Pedido para o rail abrir na aba indicada (nonce ≠ repetição). */
  readonly openRequest: { readonly nonce: number; readonly tab: RailIntentTab } | null;
  /** id do lugar (node) a pré-selecionar na aba alvo. */
  readonly targetPlaceId: string | null;
};

const initialState = (): RailExpeditionsState => ({
  openRequest: null,
  targetPlaceId: null,
});

let state: RailExpeditionsState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const railExpeditionsStore = {
  get(): RailExpeditionsState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(patch: Partial<RailExpeditionsState>): void {
    state = { ...state, ...patch };
    emit();
  },
  reset(): void {
    state = initialState();
    emit();
  },
};

/** Hook reativo para ler o estado (usado pelo SocialRail e pelo painel de Expedições). */
export function useRailExpeditions(): RailExpeditionsState {
  return useSyncExternalStore(
    railExpeditionsStore.subscribe,
    railExpeditionsStore.get,
    railExpeditionsStore.get,
  );
}

/**
 * Gatilho chamado pelo card/node do globo: abre o rail na aba Expedições →
 * sub-tab Config com `placeId` pré-selecionado (null = sem destino fixo).
 */
export function requestExpeditionConfig(placeId: string | null): void {
  railExpeditionsStore.set({
    openRequest: { nonce: Date.now(), tab: 'expeditions' },
    targetPlaceId: placeId,
  });
}

/**
 * Gatilho para abrir o rail na aba Battle com `placeId` pré-selecionado.
 */
export function requestBattleConfig(placeId: string | null): void {
  railExpeditionsStore.set({
    openRequest: { nonce: Date.now(), tab: 'battle' },
    targetPlaceId: placeId,
  });
}