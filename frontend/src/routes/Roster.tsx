import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useMemo, useState } from 'react';

import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { RosterList } from '../components/roster/RosterList';
import { SlotPickerDialog } from '../components/roster/SlotPickerDialog';
import type { RosterActions, RosterMon } from '../components/roster/types';
import { getRoster } from '../lib/api';
import { getCatalog } from '../lib/api-catalog';
import { removeFromParty, reviveRosterMon, seedStarterRoster, setPartySlot } from '../lib/api-roster';
import '../styles/extensions-roster.css';

const ROSTER_QUERY_KEY = ['roster'] as const;
const CATALOG_QUERY_KEY = ['catalog'] as const;

export function Roster(): JSX.Element {
  const queryClient = useQueryClient();
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog, staleTime: 5 * 60 * 1000 });
  const roster = rosterQuery.data?.roster ?? [];
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [pickForSlot, setPickForSlot] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const templateById = useMemo<ReadonlyMap<string, TemplateDigimon>>(() => {
    const m = new Map<string, TemplateDigimon>();
    for (const d of catalogQuery.data?.digimons ?? []) m.set(d.id, d);
    return m;
  }, [catalogQuery.data]);

  const invalidateRoster = (): void => {
    void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
  };

  const assignMutation = useMutation({
    mutationFn: ({ monId, slot }: { readonly monId: string; readonly slot: number }) => setPartySlot(monId, slot),
    onSuccess: () => { setMessage('Party updated.'); invalidateRoster(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'party update failed'),
  });
  const removeMutation = useMutation({
    mutationFn: removeFromParty,
    onSuccess: () => { setMessage('Party slot cleared.'); invalidateRoster(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'party remove failed'),
  });
  const seedMutation = useMutation({
    mutationFn: seedStarterRoster,
    onSuccess: (result) => { setMessage(result.seeded > 0 ? `Seeded ${result.seeded} starter Digimon.` : result.reason ?? 'Nothing to seed.'); invalidateRoster(); },
  });
  const reviveMutation = useMutation({ mutationFn: reviveRosterMon, onSuccess: () => { setMessage('Revived.'); invalidateRoster(); } });

  const actions: RosterActions = {
    onPickForSlot: setPickForSlot,
    onAssign: (monId, slot) => { if (monId.length > 0) assignMutation.mutate({ monId, slot }); },
    onRemoveSlot: (slot) => removeMutation.mutate(slot),
    onRevive: (monId) => reviveMutation.mutate(monId),
  };

  return (
    <>
      {roster.length === 0 && rosterQuery.isFetched ? (
        <EmptyRoster busy={seedMutation.isPending} onSeed={() => seedMutation.mutate()} />
      ) : (
        <RosterList roster={roster} now={now} actions={actions} templateById={templateById} message={message} />
      )}
      <SlotPickerDialog
        slot={pickForSlot}
        roster={roster}
        now={now}
        busy={assignMutation.isPending}
        onClose={() => setPickForSlot(null)}
        onPick={(monId) => {
          if (pickForSlot === null) return;
          assignMutation.mutate({ monId, slot: pickForSlot }, { onSuccess: () => setPickForSlot(null) });
        }}
      />
    </>
  );
}

function EmptyRoster({ busy, onSeed }: { readonly busy: boolean; readonly onSeed: () => void }): JSX.Element {
  return (
    <div className="empty">
      <p>No Digimon yet<br />The admin needs to add Digimon to the catalog before you can get a starter roster.</p>
      <button className="navbtn" type="button" disabled={busy} onClick={onSeed}>Try to seed starter roster</button>
    </div>
  );
}