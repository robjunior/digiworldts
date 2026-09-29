import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ApiError } from '../../lib/api';
import {
  collectPendingHatch,
  getPendingHatches,
  getSpeciesData,
  startDirectHatch,
  startMixHatch,
  type PendingHatchEntry,
  type SpeciesDataEntry,
} from '../../lib/api-nursery';
import { railNurseryStore } from '../../lib/rail-nursery-store';
import { DigitamaPool } from '../nursery/DigitamaPool';
import { NurseryYard } from '../nursery/NurseryYard';

// Reused pela rota /nursery (pill in-care/meat) — coletar refresca os dois.
const NURSERY_QUERY_KEY = ['nursery'] as const;
const SPECIES_DATA_QUERY_KEY = ['nursery', 'data'] as const;
const PENDING_HATCHES_QUERY_KEY = ['nursery', 'pending'] as const;
const PENDING_POLL_MS = 5_000;

type NurserySubTab = 'hatchery' | 'incubating';

/**
 * Painel "Nursery" do Social Rail — duas abas:
 *  - Hatchery: seleciona species data de qualquer digimon com dado > 0. Se um
 *    selecionado tiver 100% → choca direto (revela); senão seleciona até 100%
 *    no total → gera um MYSTERY egg (ponderado pela % dos selecionados) que
 *    não revela qual digimon vem até ser chocado.
 *  - Incubating: os ovos incubando (coletar quando prontos).
 */
export function NurseryPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<NurserySubTab>('hatchery');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Gatilho vindo da rota (botão "Hatchery" no pill): a aba já foi aberta pelo
  // SocialRail; este painel é quem consome e reseta o openRequest.
  const openRequest = useRailNurseryOpen();
  useEffect(() => {
    if (openRequest === null) return;
    railNurseryStore.set({ openRequest: null });
  }, [openRequest]);

  const dataQuery = useQuery({ queryKey: SPECIES_DATA_QUERY_KEY, queryFn: getSpeciesData });
  const pendingQuery = useQuery({ queryKey: PENDING_HATCHES_QUERY_KEY, queryFn: getPendingHatches, refetchInterval: PENDING_POLL_MS });

  const dataEntries: readonly SpeciesDataEntry[] = dataQuery.data?.entries ?? [];
  const pending: readonly PendingHatchEntry[] = pendingQuery.data?.pending ?? [];

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
      setSelectedIds(new Set());
    },
  });

  const mixMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const result = await startMixHatch(ids);
      if (!result.ok) throw new ApiError(mixErrorMessage(result.error), 409);
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SPECIES_DATA_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PENDING_HATCHES_QUERY_KEY }),
      ]);
      setSelectedIds(new Set());
      // Mystery egg chocado → manda o jogador pra Incubating pra ver o misterio.
      setSubTab('incubating');
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

  // ── selection model ────────────────────────────────────────────────────
  const selected = useMemo(() => {
    return dataEntries.filter((e) => selectedIds.has(e.catalogId));
  }, [dataEntries, selectedIds]);
  const totalSelected = selected.reduce((s, e) => s + e.percent, 0);
  // "Generate egg" habilitado quando o total selecionado ≥ 100. Se um único
  // selecionado tem 100% → hatch direto (revela); senão → mystery egg.
  const canGenerate = totalSelected >= 100;
  const fullSingle = selected.length === 1 && selected[0]!.percent >= 100;

  const toggleSelect = (entry: SpeciesDataEntry): void => {
    if (entry.percent <= 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.catalogId)) next.delete(entry.catalogId);
      else next.add(entry.catalogId);
      return next;
    });
  };

  const generate = (): void => {
    if (!canGenerate) return;
    if (fullSingle && selected[0] !== undefined) {
      hatchMutation.mutate(selected[0]);
      return;
    }
    mixMutation.mutate(Array.from(selectedIds));
  };

  const busy = hatchMutation.isPending || mixMutation.isPending;

  return (
    <div className="nursery-panel">
      {/* sub-tabs */}
      <div className="nursery-panel__tabs" role="tablist" aria-label="Nursery sections">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'hatchery'}
          className={subTab === 'hatchery' ? 'is-active' : ''}
          onClick={() => setSubTab('hatchery')}
        >
          Hatchery
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'incubating'}
          className={subTab === 'incubating' ? 'is-active' : ''}
          onClick={() => setSubTab('incubating')}
        >
          Incubating{pending.length > 0 ? ` · ${pending.length}` : ''}
        </button>
      </div>

      {subTab === 'hatchery' && (
        <div className="nursery-panel__hatch">
          <DigitamaPool
            entries={dataEntries}
            loading={dataQuery.isPending}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
          />
          <div className="nursery-panel__gen">
            <div className="nursery-panel__gen-hint">
              <span>Selected <b>{Math.round(totalSelected)}%</b> / 100%</span>
              {selected.length > 0 && !canGenerate && (
                <span className="nursery-panel__gen-sub">
                  keep selecting to reach 100%
                </span>
              )}
              {canGenerate && fullSingle && (
                <span className="nursery-panel__gen-sub">{selected[0]!.name} · hatch direct</span>
              )}
              {canGenerate && !fullSingle && (
                <span className="nursery-panel__gen-sub mystery">weighted mystery egg</span>
              )}
            </div>
            <button type="button" className="btn primary" disabled={!canGenerate || busy} onClick={generate}>
              {busy ? '…' : canGenerate && !fullSingle ? 'Generate Mystery Egg' : 'Generate Egg'}
            </button>
          </div>
        </div>
      )}

      {subTab === 'incubating' && (
        <div className="nursery-panel__incub">
          <NurseryYard
            pending={pending}
            busyHatchId={collectMutation.isPending ? collectMutation.variables?.id ?? null : null}
            onCollect={(entry) => collectMutation.mutate(entry)}
          />
        </div>
      )}
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