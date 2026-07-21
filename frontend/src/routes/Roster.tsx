import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppNav, NavStat } from '../components/AppNav';
import { useEffect, useMemo, useState } from 'react';

import { PageStrip } from '../components/common/PageStrip';
import { EvolveDialog } from '../components/roster/EvolveDialog';
import { Pagination } from '../components/roster/Pagination';
import { PartyPicker } from '../components/roster/PartyPicker';
import { RenameDialog } from '../components/roster/RenameDialog';
import { RosterList } from '../components/roster/RosterList';
import { SubstitutionDialog } from '../components/roster/SubstitutionDialog';
import type { ActivityByMon, RosterActions, RosterMon } from '../components/roster/types';
import { isDowned } from '../components/roster/types';
import { useAuth } from '../hooks/useAuth';
import { getRoster } from '../lib/api';
import { getCatalog } from '../lib/api-admin';
import { evolveRosterMon, getEvolutionGate, getTrainingStatus, removeFromParty, renameRosterMon, reviveRosterMon, seedStarterRoster, setPartySlot } from '../lib/api-roster';
import type { EvolutionGate } from '../lib/api-roster';
import type { TemplateDigimon } from '@digiworld/shared/digimon';
import '../styles/extensions-roster.css';

const ROSTER_QUERY_KEY = ['roster'] as const;
const TRAINING_QUERY_KEY = ['training'] as const;
const CATALOG_QUERY_KEY = ['catalog'] as const;
const PER_PAGE = 12;

export function Roster(): JSX.Element {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const trainingQuery = useQuery({ queryKey: TRAINING_QUERY_KEY, queryFn: getTrainingStatus, retry: false });
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog, staleTime: 5 * 60 * 1000 });
  const roster = rosterQuery.data?.roster ?? [];
  const partyFilled = roster.filter((mon) => typeof mon.slot === 'number').length;
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [renameMon, setRenameMon] = useState<RosterMon | null>(null);
  const [evolveMonId, setEvolveMonId] = useState<string | null>(null);
  const [evolutionGate, setEvolutionGate] = useState<EvolutionGate | null>(null);
  const [substituteFor, setSubstituteFor] = useState<RosterMon | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if ((page - 1) * PER_PAGE >= roster.length && page > 1) {
      setPage(page - 1);
    }
  }, [page, roster.length]);

  const activityByMon = useMemo<ActivityByMon>(() => {
    const entries = trainingQuery.data?.stations.flatMap((station) => station.active ? [[station.active.monId, station.active] as const] : []) ?? [];
    return new Map(entries);
  }, [trainingQuery.data]);

  const templateById = useMemo<ReadonlyMap<string, TemplateDigimon>>(() => {
    const m = new Map<string, TemplateDigimon>();
    for (const t of catalogQuery.data?.digimons ?? []) m.set(t.id, t);
    return m;
  }, [catalogQuery.data]);

  const reverseGraph = useMemo<ReadonlyMap<string, readonly string[]>>(() => {
    const g = new Map<string, string[]>();
    for (const t of catalogQuery.data?.digimons ?? []) {
      for (const edge of t.evolvesInto ?? []) {
        const list = g.get(edge.targetId) ?? [];
        list.push(t.id);
        g.set(edge.targetId, list);
      }
    }
    return g;
  }, [catalogQuery.data]);

  const invalidateRoster = (): void => {
    void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: TRAINING_QUERY_KEY });
  };

  const assignMutation = useMutation({
    mutationFn: ({ monId, slot }: { readonly monId: string; readonly slot: number }) => setPartySlot(monId, slot),
    onSuccess: () => { setMessage('Party updated.'); invalidateRoster(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'party update failed'),
  });
  const removeMutation = useMutation({ mutationFn: removeFromParty, onSuccess: () => { setMessage('Party slot cleared.'); invalidateRoster(); } });
  const seedMutation = useMutation({ mutationFn: seedStarterRoster, onSuccess: (result) => { setMessage(result.seeded > 0 ? `Seeded ${result.seeded} starter Digimon.` : result.reason ?? 'Nothing to seed.'); invalidateRoster(); } });
  const renameMutation = useMutation({ mutationFn: ({ monId, nickname }: { readonly monId: string; readonly nickname: string }) => renameRosterMon(monId, nickname), onSuccess: () => { setMessage('Nickname updated.'); setRenameMon(null); invalidateRoster(); } });
  const reviveMutation = useMutation({ mutationFn: reviveRosterMon, onSuccess: () => { setMessage('Revived.'); invalidateRoster(); } });
  const evolveMutation = useMutation({ mutationFn: ({ monId, targetCatalogId }: { readonly monId: string; readonly targetCatalogId: string }) => evolveRosterMon(monId, targetCatalogId), onSuccess: (result) => { setMessage(`Evolved into ${result.nickname}.`); setEvolveMonId(null); setEvolutionGate(null); invalidateRoster(); } });

  const paginated = roster.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const evolveMon = roster.find((mon) => mon.id === evolveMonId) ?? null;
  const partyBySlot = useMemo<readonly (RosterMon | null)[]>(() => {
    const slots: (RosterMon | null)[] = [null, null, null];
    for (const mon of roster) {
      if (typeof mon.slot === 'number' && mon.slot >= 0 && mon.slot < 3) {
        slots[mon.slot] = mon;
      }
    }
    return slots;
  }, [roster]);
  const actions: RosterActions = {
    onAssign: (monId, slot) => { if (monId.length > 0) assignMutation.mutate({ monId, slot }); },
    onRemoveSlot: (slot) => removeMutation.mutate(slot),
    onAddToParty: (mon) => {
      if (typeof mon.slot === 'number') return;
      if (isDowned(mon, now)) { setMessage('This Digimon is recovering. Revive it first.'); return; }
      if (mon.listedAt !== null) { setMessage('This Digimon is on the market. Cancel the listing first.'); return; }
      if (mon.status === 'training') { setMessage('This Digimon is training. Collect the training session first.'); return; }
      const emptySlot = partyBySlot.findIndex((slot) => slot === null);
      if (emptySlot >= 0) { assignMutation.mutate({ monId: mon.id, slot: emptySlot }); return; }
      setSubstituteFor(mon);
    },
    onEvolve: (monId) => {
      setEvolveMonId(monId);
      setEvolutionGate(null);
      void getEvolutionGate(monId).then(setEvolutionGate).catch((error: unknown) => { if (error instanceof Error) setMessage(error.message); else throw error; });
    },
    onRename: setRenameMon,
    onRevive: (monId) => reviveMutation.mutate(monId),
  };

  return (
    <div className="app-shell roster-shell">
      <AppNav>
        <NavStat tone="signal" label="Owned" value={roster.length} />
        <NavStat tone="nature" label="Party" value={`${roster.filter((mon) => mon.status === 'party').length}/3`} />
      </AppNav>
      <main className="app-main">
        <PageStrip
          name="Roster"
          tone={partyFilled >= 3 ? 'reward' : 'warn'}
          metrics={[
            { label: <><b>{roster.length}</b> owned</> },
            { label: <><b>{partyFilled}</b>/3 in party</>, className: partyFilled >= 3 ? 'reward' : 'warn' },
          ]}
        />
        {message ? <div className="banner roster-message"><div className="b-s">{message}</div></div> : null}
        <section><h2 className="caps roster-section-title">Active party</h2><PartyPicker roster={roster} now={now} actions={actions} /></section>
        {roster.length === 0 ? <EmptyRoster busy={seedMutation.isPending} onSeed={() => seedMutation.mutate()} /> : null}
        <section>
          <div className="row spread owned-header">
            <h2 className="caps roster-section-title owned-title">Owned</h2>
          </div>
          <RosterList roster={paginated} now={now} activityByMon={activityByMon} actions={actions} templateById={templateById} reverseGraph={reverseGraph} />
          <Pagination total={roster.length} page={page} perPage={PER_PAGE} onPage={setPage} />
        </section>
      </main>
      <EvolveDialog gate={evolutionGate} monName={evolveMon?.nickname ?? null} busy={evolveMutation.isPending} onClose={() => setEvolveMonId(null)} onEvolve={(targetCatalogId) => { if (evolveMonId) evolveMutation.mutate({ monId: evolveMonId, targetCatalogId }); }} />
      <RenameDialog mon={renameMon} busy={renameMutation.isPending} onClose={() => setRenameMon(null)} onSave={(nickname) => { if (renameMon) renameMutation.mutate({ monId: renameMon.id, nickname }); }} />
      <SubstitutionDialog
        incoming={substituteFor}
        party={partyBySlot}
        now={now}
        busy={assignMutation.isPending}
        onClose={() => setSubstituteFor(null)}
        onPick={(slot) => {
          if (substituteFor === null) return;
          assignMutation.mutate({ monId: substituteFor.id, slot }, { onSuccess: () => setSubstituteFor(null) });
        }}
      />
    </div>
  );
}

function EmptyRoster({ busy, onSeed }: { readonly busy: boolean; readonly onSeed: () => void }): JSX.Element {
  return <div className="empty-state"><h3>No Digimon yet</h3><p>The admin needs to add Digimon to the catalog before you can get a starter roster.</p><button className="btn" type="button" disabled={busy} onClick={onSeed}>Try to seed starter roster</button></div>;
}
