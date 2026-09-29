import { useSyncExternalStore } from 'react';

/**
 * railNurseryStore — ponte entre a página /nursery (que dispara o gatilho
 * "Hatchery" no pill) e o SocialRail (que abre a aba Nursery com o painel de
 * hatchery/incubando). Mesmo padrão do railExpeditionsStore / worldGlobeStore
 * (useSyncExternalStore + módulo singleton): o rail vive no AppShell e a rota
 * é montada/desmontada a cada navegação, então "abrir a aba" não pode ser
 * estado local da rota.
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

/** Hook reativo pro SocialRail ler o pedido de abrir a aba Nursery. */
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