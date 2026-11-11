import { useSyncExternalStore } from 'react';

/**
 * railExpeditionsStore — ponte entre a página /world (que dispara o gatilho
 * "Enviar Expedição" num node do globo) e o painel Expedições (canto inferior
 * esquerdo da /world), que abre o sub-tab Config com esse node pré-selecionado.
 *
 * O painel Expedições é montado na rota /world a partir do clique no node, por
 * isso o "abrir com o node X" não pode ser estado local perdido a cada remonta.
 * Usa o mesmo padrão do worldGlobeStore (useSyncExternalStore + singleton).
 */
export type RailExpeditionsState = {
  /** Pedido para o rail abrir na aba Expedições (nonce ≠ repetição). */
  readonly openRequest: { readonly nonce: number } | null;
  /** id do lugar (node) a pré-selecionar no sub-tab Config. */
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

/** Hook reativo para ler o estado (usado pelo painel de Expedições). */
export function useRailExpeditions(): RailExpeditionsState {
  return useSyncExternalStore(
    railExpeditionsStore.subscribe,
    railExpeditionsStore.get,
    railExpeditionsStore.get,
  );
}

/**
 * Gatilho chamado pelo card/node do globo: abre o painel Expedições (canto de
 * /world) no sub-tab Config com `placeId` pré-selecionado (null = sem destino
 * fixo). O sub-tab Config controla tanto expedição quanto batalha (modo).
 */
export function requestExpeditionConfig(placeId: string | null): void {
  railExpeditionsStore.set({
    openRequest: { nonce: Date.now() },
    targetPlaceId: placeId,
  });
}