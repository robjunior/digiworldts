import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

import { BalBar, ResourceBal } from '../components/common/BalBar';
import { SectionHead } from '../components/common/SectionHead';
import { NurseryChrome } from '../components/nursery/NurseryChrome';
import { NurseryDigitamaSidebar } from '../components/nursery/NurseryDigitamaSidebar';
import { NurseryPen3D } from '../components/nursery/NurseryPen3D';
import { NurseryYard } from '../components/nursery/NurseryYard';
import { ApiError } from '../lib/api';
import {
  collectPendingHatch,
  getNursery,
  getPendingHatches,
  getSpeciesData,
  petNurseryMon,
  feedNurseryMon,
  graduatePenMon,
  startDirectHatch,
  startMixHatch,
  type NurseryPenMon,
  type NurseryView,
  type PendingHatchEntry,
  type SpeciesDataEntry,
} from '../lib/api-nursery';
import '../styles/extensions-nursery.css';

const NURSERY_QUERY_KEY = ['nursery'] as const;
const SPECIES_DATA_QUERY_KEY = ['nursery', 'data'] as const;
const PENDING_HATCHES_QUERY_KEY = ['nursery', 'pending'] as const;
const PENDING_POLL_MS = 5_000;

export function Nursery(): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const nurseryQuery = useQuery({ queryKey: NURSERY_QUERY_KEY, queryFn: getNursery });
  const dataQuery = useQuery({ queryKey: SPECIES_DATA_QUERY_KEY, queryFn: getSpeciesData });
  const pendingQuery = useQuery({ queryKey: PENDING_HATCHES_QUERY_KEY, queryFn: getPendingHatches, refetchInterval: PENDING_POLL_MS });

  const careMutation = useMutation({
    mutationFn: runCareAction,
    onSuccess: async (result) => {
      setNotice(result.message);
      await queryClient.invalidateQueries({ queryKey: NURSERY_QUERY_KEY });
    },
  });

  const graduateMutation = useMutation({
    mutationFn: async (monId: string) => {
      const result = await graduatePenMon(monId);
      if (!result.ok) throw new ApiError("Failed to graduate", 400);
      return result;
    },
    onSuccess: async (result) => {
      setNotice(`Graduated ${result.nickname} to roster!`);
      await queryClient.invalidateQueries({ queryKey: NURSERY_QUERY_KEY });
    },
  });

  const hatchMutation = useMutation({
    mutationFn: async (entry: SpeciesDataEntry) => {
      const result = await startDirectHatch(entry.catalogId);
      if (!result.ok) throw new ApiError(hatchErrorMessage(result.error), 409);
      return { pending: result.pending, targetName: entry.name };
    },
    onSuccess: async (result) => {
      setNotice(`Egg placed — ${result.targetName} lineage. Ready in 3:00.`);
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
      return { pending: result.pending, rolledCatalogId: result.rolledCatalogId, totalWeight: result.totalWeight };
    },
    onSuccess: async (result) => {
      const entries = dataQuery.data?.entries ?? [];
      const rolled = entries.find((e) => e.catalogId === result.rolledCatalogId)?.name ?? result.rolledCatalogId;
      setNotice(`Mix hatched → ${rolled} (weight ${result.totalWeight}). Ready in 3:00.`);
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
    onSuccess: async (result) => {
      setNotice(`${result.nickname} hatched into your roster!`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PENDING_HATCHES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: NURSERY_QUERY_KEY }),
      ]);
    },
  });

  const view = nurseryQuery.data ?? null;
  const dataEntries = dataQuery.data?.entries ?? [];
  const pending = pendingQuery.data?.pending ?? [];
  const totalWeight = dataQuery.data?.totalWeight ?? 0;
  const error = queryError(nurseryQuery.error, careMutation.error, hatchMutation.error, mixMutation.error, collectMutation.error, dataQuery.error, pendingQuery.error);

  const rookiesCount = view ? view.penMons.filter((m) => m.stage === 'Rookie').length : 0;
  const needyCount = view ? view.penMons.filter((m) => m.mood < 35).length : 0;

  let nurserySubtitle = '—';
  if (view) {
    if (rookiesCount > 0) nurserySubtitle = `${rookiesCount} ready to graduate`;
    else if (needyCount > 0) nurserySubtitle = `${needyCount} need attention`;
    else nurserySubtitle = 'all content';
  }

  return (
    <NurseryChrome meat={view?.meat ?? 0}>
      <>
        <BalBar title="Nursery" subtitle={nurserySubtitle} odId="resource-balance">
          <ResourceBal resource="meat" label="Meat" value={view?.meat ?? '—'} />
          <ResourceBal resource="dataspecies" label="Data species" value={dataEntries.length} />
          <ResourceBal resource="mons" label="In care" value={view?.penMons.length ?? 0} />
        </BalBar>

        <div className="scroll">
          <div className="col left pen-col">
            <SectionHead title="Care" count={view?.penMons ? `${view.penMons.length} in care` : '—'} />
            <NurseryPen3D
              penMons={view?.penMons ?? []}
              stageDurations={{ babyMs: view?.babyStageMs ?? 60000, inTrainingMs: view?.inTrainingStageMs ?? 120000 }}
              busyMonId={careMutation.isPending ? careMutation.variables?.mon.id : (graduateMutation.isPending ? graduateMutation.variables : null)}
              canFeed={(view?.meat ?? 0) >= (view?.feedMeatCost ?? 0)}
              feedCost={view?.feedMeatCost ?? 0}
              onPet={(mon) => { if (view !== null) careMutation.mutate({ kind: 'pet', mon, view }); }}
              onFeed={(mon) => { if (view !== null) careMutation.mutate({ kind: 'feed', mon, view }); }}
              onGraduate={(mon) => { graduateMutation.mutate(mon.id); }}
            />
          </div>

          <div className="col right">
            <SectionHead title="Hatchery" />
            <div className="rstack">
              <div className="rbox hatchery" data-od-id="hatchery">
                <div className="rh">
                  <span className="rt">Species Data</span>
                  <span className="rc" id="data-count">{dataEntries.length} tracked</span>
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
              <div className="rbox pending" data-od-id="pending-hatches">
                <div className="rh">
                  <span className="rt">Incubating</span>
                  <span className="rc" id="pending-count">{pending.length} egg{pending.length === 1 ? '' : 's'}</span>
                </div>
                <NurseryYard
                  pending={pending}
                  busyHatchId={collectMutation.isPending ? collectMutation.variables?.id ?? null : null}
                  onCollect={(entry) => collectMutation.mutate(entry)}
                />
              </div>
            </div>
          </div>
        </div>
      </>
      <NurseryStatus message={error ?? notice} error={error !== null} onDismiss={() => setNotice(null)} />
    </NurseryChrome>
  );
}

type CareAction =
  | { readonly kind: 'pet'; readonly mon: NurseryPenMon; readonly view: NurseryView }
  | { readonly kind: 'feed'; readonly mon: NurseryPenMon; readonly view: NurseryView };

type CareResult = {
  readonly monId: string;
  readonly kind: 'pet' | 'feed';
  readonly message: string;
};

async function runCareAction(action: CareAction): Promise<CareResult> {
  switch (action.kind) {
    case 'pet': {
      const result = await petNurseryMon(action.mon.id);
      return { monId: action.mon.id, kind: 'pet', message: `Pet! +${action.view.petMoodDelta} mood · ${result.petsToday}/${result.maxPetsPerDay}` };
    }
    case 'feed': {
      const result = await feedNurseryMon(action.mon.id);
      return { monId: action.mon.id, kind: 'feed', message: `Fed! +${action.view.feedMoodDelta} mood · Meat ${result.meat}` };
    }
  }
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

function NurseryStatus({ message, error, onDismiss }: { readonly message: string | null; readonly error: boolean; readonly onDismiss: () => void }): JSX.Element | null {
  useEffect(() => {
    if (message !== null) {
      const timer = window.setTimeout(onDismiss, 5000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [message, onDismiss]);

  const cls = `nursery-toast ${message !== null ? 'show' : ''} ${error ? 'is-error' : ''}`.trim();
  return (
    <div id="toast-slot" className={cls} role="status" aria-live="polite">
      {message}
    </div>
  );
}

function queryError(...errors: readonly (Error | null)[]): string | null {
  const found = errors.find((item) => item !== null);
  if (found instanceof ApiError || found instanceof Error) {
    return found.message;
  }
  return null;
}
