import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { NurseryChrome } from '../components/nursery/NurseryChrome';
import { NurserySidebar } from '../components/nursery/NurserySidebar';
import { NurseryYard, type NurseryFeedback } from '../components/nursery/NurseryYard';
import { ApiError } from '../lib/api';
import { feedNurseryMon, getNursery, petNurseryMon, type NurseryMon, type NurseryView } from '../lib/api-nursery';
import '../styles/extensions-nursery.css';

const NURSERY_QUERY_KEY = ['nursery'] as const;

export function Nursery(): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<NurseryFeedback | null>(null);
  const nurseryQuery = useQuery({ queryKey: NURSERY_QUERY_KEY, queryFn: getNursery });
  const mutation = useMutation({
    mutationFn: runCareAction,
    onSuccess: async (result) => {
      setNotice(result.message);
      setFeedback({ monId: result.monId, kind: result.kind, nonce: Date.now() });
      await queryClient.invalidateQueries({ queryKey: NURSERY_QUERY_KEY });
    },
  });
  const view = nurseryQuery.data ?? null;
  const error = queryError(nurseryQuery.error, mutation.error);

  return (
    <NurseryChrome meat={view?.meat ?? 0}>
      <NurseryYard mons={view?.mons ?? []} feedback={feedback} />
      <NurserySidebar view={view} loading={nurseryQuery.isPending} busyMonId={mutation.variables?.mon.id ?? null} onPet={(mon) => { if (view !== null) mutation.mutate({ kind: 'pet', mon, view }); }} onFeed={(mon) => { if (view !== null) mutation.mutate({ kind: 'feed', mon, view }); }} />
      <NurseryStatus message={error ?? notice} error={error !== null} />
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

function NurseryStatus({ message, error }: { readonly message: string | null; readonly error: boolean }): JSX.Element | null {
  if (message === null) {
    return null;
  }
  return <div id="toast-slot" className={error ? 'nursery-toast is-error' : 'nursery-toast'} role="status" aria-live="polite">{message}</div>;
}

function queryError(...errors: readonly (Error | null)[]): string | null {
  const found = errors.find((item) => item !== null);
  if (found instanceof ApiError || found instanceof Error) {
    return found.message;
  }
  return null;
}
