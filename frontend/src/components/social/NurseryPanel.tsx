import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import { ApiError } from '../../lib/api';
import {
  collectPendingHatch,
  getNursery,
  getPendingHatches,
  getSpeciesData,
  startDirectHatch,
  startMixHatch,
  type PendingHatchEntry,
  type SpeciesDataEntry,
} from '../../lib/api-nursery';
import { railNurseryStore } from '../../lib/rail-nursery-store';
import { NurseryDigitamaSidebar } from '../nursery/NurseryDigitamaSidebar';
import { NurseryYard } from '../nursery/NurseryYard';

const NURSERY_QUERY_KEY = ['nursery'] as const;
const SPECIES_DATA_QUERY_KEY = ['nursery', 'data'] as const;
const PENDING_HATCHES_QUERY_KEY = ['nursery', 'pending'] as const;
const PENDING_POLL_MS = 5_000;

/**
 * Painel "Nursery" do Social Rail — hatchery (species data → hatch/mix) e
 * incubação (collect). Mesmo padrão do ExpeditionsPanel: o rail segue montado
 * no AppShell e a aba é aberta pelo gatilho da rota /nursery via
 * railNurseryStore. Reutiliza os MESMOS query keys da rota Nursery.tsx para o
 * react-query deduplicar (uma única fetch por key, cache compartilhado) e a
 * invalidação da rota refrescar o painel automaticamente.
 */
export function NurseryPanel(): JSX.Element {
  const queryClient = useQueryClient();

  // Gatilho vindo da rota (botão "Hatchery" no pill): a aba já foi aberta pelo
  // SocialRail; este painel é quem consome e reseta o openRequest. Reactivo via
  // useSyncExternalStore.
  const openRequest = useRailNurseryOpen();
  useEffect(() => {
    if (openRequest === null) return;
    railNurseryStore.set({ openRequest: null });
  }, [openRequest]);

  const quarry = useQuery({ queryKey: NURSERY_QUERY_KEY, queryFn: getNursery });
  const dataQuery = useQuery({ queryKey: SPECIES_DATA_QUERY_KEY, queryFn: getSpeciesData });
  const pendingQuery = useQuery({ queryKey: PENDING_HATCHES_QUERY_KEY, queryFn: getPendingHatches, refetchInterval: PENDING_POLL_MS });

  const dataEntries: readonly SpeciesDataEntry[] = dataQuery.data?.entries ?? [];
  const pending: readonly PendingHatchEntry[] = pendingQuery.data?.pending ?? [];
  const totalWeight = dataQuery.data?.totalWeight ?? 0;
  const meat = quarry.data?.meat ?? 0;
  const inCare = quarry.data?.penMons.length ?? 0;

  const hatchMutation = useMutation({
    mutationFn: async (entry: SpeciesDataEntry) => {
      const result = await startDirectHatch(entry.catalogId);
      if (!result.ok) throw new ApiError(hatchErrorMessage(result.error), 409);
      return { pending: result.pending, targetName: entry.name };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SPECIES_DATA_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PENDING_HATCHES_QUERY_KEY }),
      ]);
    },
  });

  const mixMutation = useMutation({
    mutationFn: async () => {
      const result = await startMixHatch();
      if (!result.ok) throw new ApiError(mixErrorMessage(result.error), 409);
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SPECIES_DATA_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PENDING_HATCHES_QUERY_KEY }),
      ]);
    },
  });

  const collectMutation = useMutation({
    mutationFn: async (entry: PendingHatchEntry) => {
      const result = await collectPendingHatch(entry.id);
      if (!result.ok) throw new ApiError(collectErrorMessage(result.error), 409);
      return { nickname: result.nickname };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PENDING_HATCHES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: NURSERY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['roster'] }),
      ]);
    },
  });

  return (
    <div className="nursery-panel">
      <div className="nursery-panel__hd">
        <span className="nursery-panel__title">Nursery</span>
        <span className="nursery-panel__count">
          {inCare} in care · {meat} meat
        </span>
      </div>

      <div className="nursery-panel__hatch">
        <div className="nursery-panel__sect-hd">
          <span className="nursery-panel__ht">Hatchery</span>
          <span className="nursery-panel__sub">{dataEntries.length} species tracked</span>
        </div>
        <NurseryDigitamaSidebar
          entries={dataEntries}
          pending={pending}
          loading={dataQuery.isPending}
          totalWeight={totalWeight}
          busyCatalogId={hatchMutation.isPending ? hatchMutation.variables?.catalogId ?? null : null}
          mixBusy={mixMutation.isPending}
          onHatch={(entry) => hatchMutation.mutate(entry)}
          onMix={() => mixMutation.mutate()}
        />
      </div>

      <div className="nursery-panel__incub">
        <div className="nursery-panel__sect-hd">
          <span className="nursery-panel__ht">Incubating</span>
          <span className="nursery-panel__sub">{pending.length} egg{pending.length === 1 ? '' : 's'}</span>
        </div>
        <NurseryYard
          pending={pending}
          busyHatchId={collectMutation.isPending ? collectMutation.variables?.id ?? null : null}
          onCollect={(entry) => collectMutation.mutate(entry)}
        />
      </div>
    </div>
  );
}

function useRailNurseryOpen(): { readonly nonce: number } | null {
  const get = (): { readonly nonce: number } | null => railNurseryStore.get().openRequest;
  return useSyncExternalStore(railNurseryStore.subscribe, get, get);
}

function hatchErrorMessage(code: 'not-enough-data' | 'template-missing' | 'no-path' | 'unknown'): string {
  switch (code) {
    case 'not-enough-data': return 'Species data must be 100% to hatch.';
    case 'no-path': return 'No Rookie predecessor found for this species.';
    case 'template-missing': return 'That Digimon is not in the catalog.';
    case 'unknown': return 'Hatch failed. Try again.';
  }
}

function mixErrorMessage(code: 'no-data' | 'no-path'): string {
  return code === 'no-data' ? 'No species data collected yet.' : 'No Rookie predecessor found for the rolled species.';
}

function collectErrorMessage(code: 'not-found' | 'not-ready' | 'template-missing'): string {
  switch (code) {
    case 'not-found': return 'That egg is gone.';
    case 'not-ready': return 'Egg is still incubating.';
    case 'template-missing': return 'Rookie template is missing from the catalog.';
  }
}