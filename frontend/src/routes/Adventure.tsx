import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { BalBar, ResourceBal } from '../components/common/BalBar';
import { SectionHead } from '../components/common/SectionHead';
import { Toast } from '../components/common/Toast';
import { ActiveExpCard } from '../components/adventure/ActiveExpCard';
import { ExpeditionPlanner } from '../components/adventure/ExpeditionPlanner';
import { ReportPanel } from '../components/adventure/ReportPanel';
import { getRoster } from '../lib/api';
import {
  collectAdventure,
  getAdventure,
  startAdventure,
  type AdventurePageView,
} from '../lib/api-adventure';
import { getFarm, type FarmView } from '../lib/api-farm';
import type { RosterView } from '../lib/api';
import '../styles/extensions-adventure.css';

const ADVENTURE_QUERY_KEY = ['adventure'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;
const FARM_QUERY_KEY = ['farm'] as const;

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  netcore: 0,
  buildings: [],
};

export function Adventure(): JSX.Element {
  const queryClient = useQueryClient();
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedIds, setSelectedIds] = useState<readonly (string | null)[]>([null, null, null]);
  const [hours, setHours] = useState<number>(1);
  const [notice, setNotice] = useState<string>('');

  const adventureQuery = useQuery({ queryKey: ADVENTURE_QUERY_KEY, queryFn: getAdventure, refetchInterval: 15_000 });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const page = adventureQuery.data ?? null;
  const active = page?.active ?? null;
  const lastCollected = page?.lastCollected ?? null;
  const meatOwned = page?.meatOwned ?? 0;
  const config = page?.config ?? {
    minHours: 1,
    maxHours: 8,
    meatPerHour: 10,
    encountersPerHour: 3,
    partySize: 3,
  };
  const roster = rosterQuery.data?.roster ?? [];
  const farm: FarmView = farmQuery.data ?? emptyFarm;

  const meatNeeded = hours * config.meatPerHour;

  const startMutation = useMutation({
    mutationFn: (params: { readonly monIds: readonly string[]; readonly hours: number }) =>
      startAdventure(params.monIds, params.hours),
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_QUERY_KEY, (prev) => ({
        active: result.adventure,
        lastCollected: prev?.lastCollected ?? null,
        meatOwned: result.meatOwned,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      setSelectedIds([null, null, null]);
      setNotice(`Adventure started — ${hours}h expedition with ${result.adventure.party.length} Digimon.`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'start failed'),
  });

  const collectMutation = useMutation({
    mutationFn: collectAdventure,
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_QUERY_KEY, (prev) => ({
        active: null,
        lastCollected: result.adventure,
        meatOwned: prev?.meatOwned ?? 0,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ADVENTURE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      const report = result.adventure.report;
      const wins = report?.wins ?? 0;
      const losses = report?.losses ?? 0;
      setNotice(`Party returned — ${wins} win${wins === 1 ? '' : 's'}, ${losses} loss${losses === 1 ? '' : 'es'}.`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'collect failed'),
  });

  function handleTogglePick(monId: string): void {
    const slotIndex = selectedIds.indexOf(monId);
    if (slotIndex >= 0) {
      const next = [...selectedIds];
      next[slotIndex] = null;
      setSelectedIds(next);
      return;
    }
    const emptyIdx = selectedIds.indexOf(null);
    if (emptyIdx >= 0) {
      const next = [...selectedIds];
      next[emptyIdx] = monId;
      setSelectedIds(next);
      return;
    }
    setNotice(`Party is full (${config.partySize}). Deselect one first.`);
  }

  const filled = selectedIds.filter((id) => id !== null).length;
  const enoughMeat = meatOwned >= meatNeeded;
  const canStart = filled === config.partySize && enoughMeat;

  const hint: { readonly node: ReactNode; readonly warn: boolean } = useMemo(() => {
    if (filled < config.partySize) {
      return {
        node: (
          <>
            Pick <b>{config.partySize - filled}</b> more Digimon to embark.
          </>
        ),
        warn: false,
      };
    }
    if (!enoughMeat) {
      return {
        node: (
          <>
            Need <b>{meatNeeded}</b> Meat — you have <b>{meatOwned}</b>. Produce more in the Farm or hunt it down.
          </>
        ),
        warn: true,
      };
    }
    return {
      node: (
        <>
          Ready — <b>{meatNeeded}</b> Meat for a <b>{hours}h</b> run.
        </>
      ),
      warn: false,
    };
  }, [filled, config.partySize, enoughMeat, meatNeeded, meatOwned, hours]);

  const displayRoster = useMemo<readonly RosterView[]>(
    () =>
      roster.filter((m) => m.status === 'resting' && m.listedAt === null && typeof m.slot !== 'number'),
    [roster],
  );

  const subtitle = active ? '1 in the field' : 'idle · ready to send';

  return (
    <>
      <BalBar title="Expeditions" subtitle={subtitle}>
        <ResourceBal resource="meat" label="Meat" value={farm.balances.Meat ?? 0} />
        <ResourceBal resource="bits" label="Bits" value={farm.balances.Bits ?? 0} />
        <ResourceBal resource="data" label="Data" value={farm.balances.Data ?? 0} />
        <ResourceBal resource="credits" label="Credits" value={farm.credits ?? 0} />
        <ResourceBal resource="meat" label="Meat" value={meatOwned} />
      </BalBar>

      <div className="scroll">
        <div className="col left">
          <div className="lstack">
            <SectionHead title="Send an expedition" />
            <ExpeditionPlanner
              roster={displayRoster}
              selectedIds={selectedIds}
              now={now}
              hours={hours}
              config={config}
              meatOwned={meatOwned}
              meatNeeded={meatNeeded}
              canStart={canStart}
              isPending={startMutation.isPending}
              hint={hint}
              onTogglePick={handleTogglePick}
              onHours={setHours}
              onEmbark={() => {
                const monIds = selectedIds.filter((id): id is string => id !== null);
                startMutation.mutate({ monIds, hours });
              }}
            />
          </div>

          <div className="lstack">
            <SectionHead title="Active Expeditions" count={active ? 1 : 0} />
            <div className="panelbox">
              <div className="pinner">
                <div className="explist">
                  {active ? (
                    <ActiveExpCard
                      active={active}
                      now={now}
                      config={config}
                      onCollect={() => collectMutation.mutate()}
                      isCollecting={collectMutation.isPending}
                    />
                  ) : (
                    <div className="exp-empty">
                      No expeditions in the field. Pick a party above and Embark — every run you send appears here with its
                      own countdown, and you can send as many as you like.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col right">
          <SectionHead title="Last Report" />
          <div className="panelbox">
            <div className="pinner">
              <ReportPanel report={lastCollected?.report ?? null} adventure={lastCollected} />
            </div>
          </div>
        </div>
      </div>

      <Toast message={notice} />
    </>
  );
}
