import { useSyncExternalStore } from 'react';

/**
 * railNurseryStore — ponte entre a página /nursery (que dispara o gatilho
 * "Hatchery" no pill) e o painel Nursery (canto inferior esquerdo da /nursery,
 * abas hatchery/incubando). Mesmo padrão do railExpeditionsStore /
 * worldGlobeStore (useSyncExternalStore + módulo singleton): o painel é
 * montado na rota a partir de um clique e precisa receber o "abrir".
 */
export type RailNurseryState = {
  /** Pedido pro rail abrir na aba Nursery (nonce ≠ repetição). */
  readonly openRequest: { readonly nonce: number } | null;
};

const initialState = (): RailNurseryState => ({ openRequest: null });

let state: RailNurseryState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const railNurseryStore = {
  get(): RailNurseryState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(patch: Partial<RailNurseryState>): void {
    state = { ...state, ...patch };
    emit();
  },
};

/** Hook reativo pra ler o pedido de abrir o painel Nursery. */
export function useRailNursery(): RailNurseryState {
  return useSyncExternalStore(
    railNurseryStore.subscribe,
    railNurseryStore.get,
    railNurseryStore.get,
  );
}

/**
 * Gatilho chamado pelo botão "Hatchery" do pill da página /nursery: abre o
 * rail na aba Nursery. O painel NurseryPanel (que é quem precisa do preselect)
 * consome o openRequest e é o ÚNICO a resetá-lo.
 */
export function requestNursery(): void {
  railNurseryStore.set({ openRequest: { nonce: Date.now() } });
}