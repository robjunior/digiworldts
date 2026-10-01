import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

import { ResourceIcon, type ResourceKind } from '../components/common/ResourceIcon';
import { NurseryChrome } from '../components/nursery/NurseryChrome';
import { NurseryPen3D } from '../components/nursery/NurseryPen3D';
import { ApiError } from '../lib/api';
import { getNursery, getSpeciesData, getPendingHatches, petNurseryMon, feedNurseryMon, graduatePenMon, type NurseryPenMon, type NurseryView } from '../lib/api-nursery';
import { getNurserySceneEntity } from '../lib/api-scenes';
import { resolveSceneModelUrl } from '@digiworld/scene3d/arena-urls';
import type { SceneSettings } from '@digiworld/scene3d/scene';
import { requestNursery } from '../lib/rail-nursery-store';
import { NurseryPanel } from '../components/social/NurseryPanel';
import '../styles/extensions-nursery.css';
import '../styles/social-rail.css';

const NURSERY_QUERY_KEY = ['nursery'] as const;
const SPECIES_DATA_QUERY_KEY = ['nursery', 'data'] as const;
const PENDING_HATCHES_QUERY_KEY = ['nursery', 'pending'] as const;
const NURSERY_SCENE_QUERY_KEY = ['nursery-scene-entity'] as const;
const PENDING_POLL_MS = 5_000;

export function Nursery(): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const nurseryQuery = useQuery({ queryKey: NURSERY_QUERY_KEY, queryFn: getNursery });
  const dataQuery = useQuery({ queryKey: SPECIES_DATA_QUERY_KEY, queryFn: getSpeciesData });
  const pendingQuery = useQuery({ queryKey: PENDING_HATCHES_QUERY_KEY, queryFn: getPendingHatches, refetchInterval: PENDING_POLL_MS });
  // The nursery pen's backdrop comes from the scene editor (kind 'nursery').
  const sceneEntityQuery = useQuery({ queryKey: NURSERY_SCENE_QUERY_KEY, queryFn: getNurserySceneEntity });

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

  const view = nurseryQuery.data ?? null;
  const dataEntries = dataQuery.data?.entries ?? [];
  const pending = pendingQuery.data?.pending ?? [];
  const error = queryError(nurseryQuery.error, careMutation.error, graduateMutation.error, dataQuery.error, pendingQuery.error);

  // Backdrop environment driven by the scene editor's kind:'nursery' scene
  // (or named "Nursery"). Falls back to the default arena model.
  const sceneEntity = sceneEntityQuery.data ?? null;
  const sceneSettings = sceneEntity?.settings as Partial<SceneSettings> | undefined;
  const sceneModelFile = typeof sceneSettings?.modelFile === 'string' && sceneSettings.modelFile !== ''
    ? sceneSettings.modelFile
    : undefined;
  const envModelUrl = resolveSceneModelUrl(sceneModelFile);
  const useGlbSettings = sceneEntity?.useGlbSettings === true;

  return (
    <NurseryChrome meat={view?.meat ?? 0}>
      <>
        <div className="nure-scene" data-od-id="nursery-scene">
          <NurseryPen3D
            penMons={view?.penMons ?? []}
            pending={pending}
            envModelUrl={envModelUrl ?? undefined}
            settings={sceneSettings ?? undefined}
            useGlbSettings={useGlbSettings}
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
              <button type="button" className="nure-pill__hatch" onClick={requestNursery}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M12 3c4 0 7 3 7 7 0 4.5-3.5 8-7 11-3.5-3-7-6.5-7-11 0-4 3-7 7-7z" />
                  <path d="M9.5 13a2.5 2.5 0 0 0 5 0" />
                </svg>
                <span>Hatchery{pending.length > 0 ? ` · ${pending.length}` : ''}</span>
              </button>
            </div>
          </div>
        </div>
      </>
      <NurseryStatus message={error ?? notice} error={error !== null} onDismiss={() => setNotice(null)} />
      {/* Painel Hatchery/Incubação no canto inferior esquerdo — o rail não existe mais */}
      <div className="nursery-corner" data-od-id="nursery-panel-corner">
        <NurseryPanel />
      </div>
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
