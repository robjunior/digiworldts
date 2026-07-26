import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

import { NurseryChrome } from '../components/nursery/NurseryChrome';
import { NurseryDigitamaSidebar } from '../components/nursery/NurseryDigitamaSidebar';
import { NurserySidebar } from '../components/nursery/NurserySidebar';
import { NurseryYard, type NurseryFeedback } from '../components/nursery/NurseryYard';
import { ApiError } from '../lib/api';
import {
  collectPendingHatch,
  feedNurseryMon,
  getNursery,
  getPendingHatches,
  getSpeciesData,
  petNurseryMon,
  startDirectHatch,
  startMixHatch,
  type NurseryMon,
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
  const [feedback, setFeedback] = useState<NurseryFeedback | null>(null);
  const nurseryQuery = useQuery({ queryKey: NURSERY_QUERY_KEY, queryFn: getNursery });
  const dataQuery = useQuery({ queryKey: SPECIES_DATA_QUERY_KEY, queryFn: getSpeciesData });
  const pendingQuery = useQuery({ queryKey: PENDING_HATCHES_QUERY_KEY, queryFn: getPendingHatches, refetchInterval: PENDING_POLL_MS });

  const careMutation = useMutation({
    mutationFn: runCareAction,
    onSuccess: async (result) => {
      setNotice(result.message);
      setFeedback({ monId: result.monId, kind: result.kind, nonce: Date.now() });
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
      <main className="main" data-od-id="nursery-main" tabIndex={-1}>
        <div className="balbar" data-od-id="resource-balance" id="balbar">
          <div className="bal" data-res="meat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3c4 0 7 3 7 7 0 5-4 9-7 11-3-2-7-6-7-11 0-4 3-7 7-7z"/>
              </svg>
            </div>
            <div className="col">
              <div className="k">Meat</div>
              <div className="v" id="hud-meat">{view?.meat ?? '—'}</div>
            </div>
          </div>
          <div className="strip-title">
            <div className="k">Nursery</div>
            <div className="s">Tamer Terminal</div>
          </div>
        </div>

        <div className="scroll">
          <div className="col left">
            <h3 className="stitle">
              Care <span className="cnt" id="care-count">{view?.mons.length ?? '—'}</span>
            </h3>
            <NurserySidebar
              view={view}
              loading={nurseryQuery.isPending}
              busyMonId={careMutation.variables?.mon.id ?? null}
              onPet={(mon) => { if (view !== null) careMutation.mutate({ kind: 'pet', mon, view }); }}
              onFeed={(mon) => { if (view !== null) careMutation.mutate({ kind: 'feed', mon, view }); }}
            />
          </div>

          <div className="col right">
            <h3 className="stitle">Hatchery</h3>
            <div className="rstack">
              <div className="rbox hatchery" data-od-id="hatchery">
                <div className="rh">
                  <span className="rt">Species Data</span>
                  <span className="rc" id="data-count">{dataEntries.length}</span>
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
                  <span className="rc" id="pending-count">{pending.length}</span>
                </div>
                <NurseryYard
                  mons={view?.mons ?? []}
                  feedback={feedback}
                  pending={pending}
                  busyHatchId={collectMutation.isPending ? collectMutation.variables?.id ?? null : null}
                  onCollect={(entry) => collectMutation.mutate(entry)}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
      <NurseryStatus message={error ?? notice} error={error !== null} onDismiss={() => setNotice(null)} />
    </NurseryChrome>
  );
}

type CareAction =
  | { readonly kind: 'pet'; readonly mon: NurseryMon; readonly view: NurseryView }
  | { readonly kind: 'feed'; readonly mon: NurseryMon; readonly view: NurseryView };

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
