import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

import { ResourceIcon, type ResourceKind } from '../components/common/ResourceIcon';
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
  const [hatchOpen, setHatchOpen] = useState(false);
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

  return (
    <NurseryChrome meat={view?.meat ?? 0}>
      <>
        <div className="nure-scene" data-od-id="nursery-scene">
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

          {/* Pill over the 3D scene — meat / data / in care */}
          <div className="nure-overlay">
            <div className="nure-pill" data-od-id="resource-balance">
              <PillStat resource="meat" label="Meat" value={view?.meat ?? '—'} />
              <PillStat resource="dataspecies" label="Data" value={dataEntries.length} />
              <PillStat resource="mons" label="In care" value={view?.penMons.length ?? 0} />
              <button type="button" className="nure-pill__hatch" onClick={() => setHatchOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M12 3c4 0 7 3 7 7 0 4.5-3.5 8-7 11-3.5-3-7-6.5-7-11 0-4 3-7 7-7z" />
                  <path d="M9.5 13a2.5 2.5 0 0 0 5 0" />
                </svg>
                <span>Hatchery{pending.length > 0 ? ` · ${pending.length}` : ''}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Hatchery + incubating live in a popup — not on the main screen */}
        {hatchOpen && (
          <div className="nure-pop" role="dialog" aria-modal="true" aria-label="Hatchery">
            <button type="button" className="nure-pop__close" onClick={() => setHatchOpen(false)} aria-label="Close hatchery">
              ×
            </button>
            <div className="nure-pop__hd">
              <span className="nure-pop__title">Hatchery</span>
              <span className="nure-pop__count">Species Data · {dataEntries.length} tracked</span>
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
            <div className="nure-pop__incub">
              <div className="nure-pop__incub-hd">
                <span className="nure-pop__title">Incubating</span>
                <span className="nure-pop__count">{pending.length} egg{pending.length === 1 ? '' : 's'}</span>
              </div>
              <NurseryYard
                pending={pending}
                busyHatchId={collectMutation.isPending ? collectMutation.variables?.id ?? null : null}
                onCollect={(entry) => collectMutation.mutate(entry)}
              />
            </div>
          </div>
        )}
      </>
      <NurseryStatus message={error ?? notice} error={error !== null} onDismiss={() => setNotice(null)} />
    </NurseryChrome>
  );
}

function PillStat({ resource, label, value, format = defaultFormat }: {
  readonly resource: ResourceKind;
  readonly label: string;
  readonly value: number | string;
  readonly format?: (v: number) => string;
}): JSX.Element {
  const displayed = typeof value === 'number' ? format(value) : value;
  return (
    <div className="nure-pill__stat" data-res={resource === 'dataspecies' ? 'data' : resource === 'mons' ? 'mons' : resource}>
      <span className="nure-pill__ic" aria-hidden="true">
        <ResourceIcon kind={resource} />
      </span>
      <span className="nure-pill__col">
        <span className="nure-pill__k">{label}</span>
        <span className="nure-pill__v">{displayed}</span>
      </span>
    </div>
  );
}

function defaultFormat(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
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
