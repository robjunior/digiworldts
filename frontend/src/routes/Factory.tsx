import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../hooks/useAuth';
import {
  buyFactory,
  cancelFarmCraftJob,
  getFarm,
  getFarmRecipes,
  startFarmCraft,
  upgradeFactoryLevel,
  type CraftingJobView,
  type FactoryTypeId,
  type FarmView,
  type PlayerFactoryView,
  type RecipeView,
} from '../lib/api-farm';
import '../styles/extensions-factory.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

export function Factory(): JSX.Element {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string>('');
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const [pendingFactoryType, setPendingFactoryType] = useState<FactoryTypeId | null>(null);
  const [pendingUpgradeFactoryId, setPendingUpgradeFactoryId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);
  const [countByRecipe, setCountByRecipe] = useState<Record<string, number>>({});
  
  // New state for Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });
  const pageQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes, refetchInterval: 15_000 });

  const farm = farmQuery.data ?? emptyFarm;
  const owned = pageQuery.data?.ownedFactories ?? [];
  const available = pageQuery.data?.availableFactories ?? [];
  const recipes = pageQuery.data?.recipes ?? [];
  const queueMaxMs = pageQuery.data?.queueMaxMs ?? 8 * 60 * 60 * 1000;

  useEffect(() => {
    if (owned.length === 0) return;
    if (selectedFactoryId === null || !owned.some((f) => f.id === selectedFactoryId)) {
      setSelectedFactoryId(owned[0]!.id);
    }
  }, [owned, selectedFactoryId]);

  const selectedFactory = useMemo(
    () => owned.find((f) => f.id === selectedFactoryId) ?? null,
    [owned, selectedFactoryId],
  );
  const filteredRecipes = useMemo(
    () => (selectedFactory ? recipes.filter((r) => r.category === selectedFactory.type) : []),
    [recipes, selectedFactory],
  );

  const anyActive = owned.some((f) => f.queue.some((j) => j.isActive));
  const isPremium = user?.premiumUntil != null && user.premiumUntil > now;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  
  // Clear notice after delay for toast animation
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 1900);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Handle Escape key for drawer
  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen]);

  const buyMutation = useMutation({
    mutationFn: buyFactory,
    onMutate: (type) => setPendingFactoryType(type),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setSelectedFactoryId(result.factory.id);
      setNotice(`Purchased ${result.factory.name}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'purchase failed'),
    onSettled: () => setPendingFactoryType(null),
  });

  const queueMutation = useMutation({
    mutationFn: (params: { readonly recipeId: string; readonly factoryId: string; readonly auto?: boolean; readonly count?: number }) => {
      const opts: { auto?: boolean; count?: number } = {};
      if (params.auto === true) opts.auto = true;
      if (typeof params.count === 'number') opts.count = params.count;
      return startFarmCraft(params.factoryId, params.recipeId, opts);
    },
    onMutate: (p) => setPendingRecipeId(p.recipeId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setCountByRecipe((prev) => ({ ...prev, [result.job.recipeId]: 1 }));
      const label = result.queuedCount > 1 ? `${result.queuedCount}× ${result.job.itemName}` : result.job.itemName;
      setNotice(result.job.isAuto ? `Auto-producing ${label}` : `Queued: ${label}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'queue failed'),
    onSettled: () => setPendingRecipeId(null),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelFarmCraftJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice('Item cancelled — resources refunded');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'cancel failed'),
  });

  const upgradeFactoryMutation = useMutation({
    mutationFn: upgradeFactoryLevel,
    onMutate: (id) => setPendingUpgradeFactoryId(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice(`${result.factory.name} upgraded to Lv ${result.factory.level}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'upgrade failed'),
    onSettled: () => setPendingUpgradeFactoryId(null),
  });

  const totalQueued = owned.reduce((s, f) => s + f.queue.length, 0);
  const totalReady = owned.reduce((a,f) => a + f.queue.filter(j => j.readyToCollect).length, 0);
  const totalCrafting = owned.reduce((a,f) => a + f.queue.filter(j => j.isActive && !j.readyToCollect).length, 0);
  
  let nextMs = Number.POSITIVE_INFINITY;
  owned.forEach(f => f.queue.forEach(j => {
    if(j.isActive && !j.readyToCollect && j.finishesAt !== null){
      const rem = Math.max(0, j.finishesAt - now);
      if(rem < nextMs) nextMs = rem;
    }
  }));
  const nextTxt = totalReady > 0 ? 'now' : (nextMs === Number.POSITIVE_INFINITY ? '—' : formatDuration(nextMs));

  return (
    <>
      <div className="balbar" data-od-id="resource-balance">
          <div className="bal" data-res="meat">
            <span className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3c4 0 7 3 7 7 0 5-4 9-7 11-3-2-7-6-7-11 0-4 3-7 7-7z"/><path d="M9 9c1-1 4-1 5 0"/></svg>
            </span>
            <span className="col"><span className="k">Meat</span><span className="v">{farm.balances.Meat.toLocaleString()}</span></span>
          </div>
          <div className="bal" data-res="bits">
            <span className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4"/><rect x="8" y="8" width="8" height="8"/></svg>
            </span>
            <span className="col"><span className="k">Bits</span><span className="v">{farm.balances.Bits.toLocaleString()}</span></span>
          </div>
          <div className="bal" data-res="data">
            <span className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.6 3.1 3 7 3s7-1.4 7-3V6"/><path d="M5 12c0 1.6 3.1 3 7 3s7-1.4 7-3"/></svg>
            </span>
            <span className="col"><span className="k">Data</span><span className="v">{farm.balances.Data.toLocaleString()}</span></span>
          </div>
          <div className="bal" data-res="credits">
            <span className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5"/></svg>
            </span>
            <span className="col"><span className="k">Credits</span><span className="v">{farm.credits.toLocaleString()}</span></span>
          </div>
          <div className="strip-title">
            <div className="k">Factory Row</div>
            <div className="s">{totalReady > 0 ? `${totalReady} ready to collect` : `${totalCrafting} crafting`}</div>
          </div>
        </div>

        <div className="scroll">
          <div className="ovw" data-od-id="factory-overview">
            <div className="stat">
              <div className="k">Factories</div>
              <div className="v">{owned.length}<small>/4</small></div>
            </div>
            <div className="stat">
              <div className="k">Crafting</div>
              <div className="v">{totalCrafting}</div>
            </div>
            <div className={`stat ${totalReady > 0 ? 'hot' : ''}`}>
              <div className="k">Ready to collect</div>
              <div className="v">{totalReady}</div>
            </div>
            <div className="stat">
              <div className="k">Next ready</div>
              <div className="v">{nextTxt}</div>
            </div>
          </div>

          <div className="fac-sec">
            <h3 className="stitle">Your Factories <span className="cnt">{owned.length}/4 built</span></h3>
            <div className="fgrid rail" data-od-id="factory-grid">
              {owned.map(f => {
                const maxed = f.level >= f.maxLevel;
                const canAfford = farm.credits >= f.upgradeCost;
                const activeCount = f.queue.filter(j => j.isActive || j.readyToCollect).length;
                const usedMs = queueUsedMs(f.queue, now);
                const capPct = queueMaxMs > 0 ? (usedMs / queueMaxMs) * 100 : 0;
                const groups = groupQueue(f.queue);
                const upgradeRowPending = pendingUpgradeFactoryId === f.id && upgradeFactoryMutation.isPending;
                
                return (
                  <article key={f.id} className="fcard" data-fac={f.type} aria-label={`${f.name}, level ${f.level} of ${f.maxLevel}, ${activeCount} active jobs`}>
                    <div className="fhead">
                      <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><FacIcon type={f.type} /></svg></span>
                      <div><div className="nm">{f.name}</div><div className="desc">{f.description}</div></div>
                      <div className="lvbadge"><div className="lk">Level</div><div className="lv">{f.level}<small>/{f.maxLevel}</small></div></div>
                    </div>
                    <div className="fspeed">
                      <span>Craft speed bonus <b className="spd">+{f.craftSpeedPct}%</b></span>
                      <span>{activeCount}/{f.queue.length} jobs running</span>
                    </div>
                    <div className="queue">
                      <div className="qhead">
                        <span>Crafting queue</span>
                        <span className={`qcap ${capPct >= 100 ? 'full' : ''}`}>
                          <b>{formatDuration(usedMs)}</b> / {formatDuration(queueMaxMs)} queued
                        </span>
                      </div>
                      <div className={`qmeter ${capPct >= 100 ? 'full' : ''}`} role="progressbar" aria-valuenow={Math.round(capPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Queue time used">
                        <i style={{ width: `${Math.min(100, capPct)}%` }} />
                      </div>
                      <div className="qjobs">
                        {f.queue.length === 0 ? (
                          <div className="qempty">Idle — pick a recipe to start crafting.</div>
                        ) : (
                          f.queue.map(j => {
                            if (j.isActive || j.readyToCollect) {
                              const ready = j.readyToCollect;
                              const progressPct = j.startedAt !== null ? Math.min(100, Math.max(0, ((now - j.startedAt) / j.durationMs) * 100)) : 0;
                              return (
                                <div key={j.id} className={`job ${ready ? 'ready' : ''}`} data-job={j.id}>
                                  <div className="jn">
                                    <div className="jt">{j.itemName}</div>
                                    <div className="jbar"><span className="jfill" style={{ width: `${ready ? 100 : progressPct}%` }} /></div>
                                  </div>
                                  <div className="jmeta">
                                    {ready ? (
                                      <>
                                        <span className="rc">READY</span>
                                        <button className="collectbtn" onClick={() => cancelMutation.mutate(j.id)}>Collect</button>
                                      </>
                                    ) : (
                                      <>
                                        <span>{Math.round(progressPct)}%</span>
                                        <button className="cancelbtn" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(j.id)}>Cancel</button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })
                        )}
                        {/* Queued groups */}
                        {groups.filter(g => !g.hasActive && !g.hasReady).map(g => (
                          <div key={g.itemName} className="job qgroup" data-qgroup={g.itemName}>
                            <div className="jn">
                              <div className="jt">{g.itemName} {g.count > 1 ? <span className="xn">×{g.count}</span> : null}</div>
                              <div className="jbar queued"><span className="jfill" style={{ width: '0%' }} /></div>
                            </div>
                            <div className="jmeta">
                              <span>Queued</span>
                              <button className="cancelbtn" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(g.jobs[g.jobs.length - 1]!.id)}>Cancel</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="ffoot-wrap">
                      <div className="ffoot" data-fac={f.type} style={{ borderTop: '1px solid var(--hair)', gridTemplateColumns: '1fr auto' }}>
                        <button className="btn primary" onClick={() => { setSelectedFactoryId(f.id); setIsDrawerOpen(true); }}>Craft item</button>
                        {maxed ? (
                          <span className="maxtag">Max level</span>
                        ) : (
                          <button className="btn ghost" disabled={!canAfford || upgradeRowPending} title={canAfford ? '' : 'Not enough Credits'} onClick={() => upgradeFactoryMutation.mutate(f.id)}>
                            {upgradeRowPending ? 'Upgrading...' : `Upgrade · ${f.upgradeCost.toLocaleString()}`}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="buy-sec">
            <h3 className="stitle">Available Factories</h3>
            <div className="buygrid rail" data-od-id="factory-buy-grid">
              {available.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>
                  All factory types built. Your industrial base is complete.
                </div>
              ) : (
                available.map(a => {
                  const afford = farm.balances.Meat >= a.cost.meat && farm.balances.Bits >= a.cost.bits && farm.balances.Data >= a.cost.data;
                  const rowPending = pendingFactoryType === a.id && buyMutation.isPending;
                  return (
                    <article key={a.id} className="buycard" data-fac={a.id}>
                      <div className="bh">
                        <span className="bbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><FacIcon type={a.id} /></svg></span>
                        <div className="bn">{a.name}</div>
                      </div>
                      <div className="bd">{a.description}</div>
                      <div className="costs">
                        {a.cost.meat > 0 ? (
                          <span className={`cchip ${farm.balances.Meat < a.cost.meat ? 'short' : ''}`} data-res="meat">
                            <span className="cd" />{a.cost.meat} Meat
                          </span>
                        ) : null}
                        {a.cost.bits > 0 ? (
                          <span className={`cchip ${farm.balances.Bits < a.cost.bits ? 'short' : ''}`} data-res="bits">
                            <span className="cd" />{a.cost.bits} Bits
                          </span>
                        ) : null}
                        {a.cost.data > 0 ? (
                          <span className={`cchip ${farm.balances.Data < a.cost.data ? 'short' : ''}`} data-res="data">
                            <span className="cd" />{a.cost.data} Data
                          </span>
                        ) : null}
                      </div>
                      <div className="brow">
                        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {afford ? 'Ready to build' : 'Not enough resources'}
                        </span>
                        <button className="btn primary" disabled={!afford || rowPending} onClick={() => buyMutation.mutate(a.id)}>
                          {rowPending ? 'Building...' : 'Build factory'}
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>

      {/* Drawer */}
      <div className={`drawer factory-drawer ${isDrawerOpen ? 'open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="scrim" onClick={() => setIsDrawerOpen(false)} />
        {selectedFactory && (
          <div className="panel" data-fac={selectedFactory.type}>
            <div className="dhead">
              <div>
                <div className="dk">{selectedFactory.name} · Recipes</div>
                <h2 id="drawer-title">Factory</h2>
              </div>
              <button className="dclose" aria-label="Close recipes" onClick={() => setIsDrawerOpen(false)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
            <div className="dlist">
              {filteredRecipes.map(r => {
                const missing = [
                  farm.balances.Meat < r.meatCost ? 'Meat' : null,
                  farm.balances.Bits < r.bitsCost ? 'Bits' : null,
                  farm.balances.Data < r.dataCost ? 'Data' : null,
                ].filter(Boolean) as string[];
                
                const usedMs = queueUsedMs(selectedFactory.queue, now);
                const effectiveMs = Math.max(1, Math.round(r.craftTimeMs * selectedFactory.craftTimeMultiplier));
                const overflows = usedMs + effectiveMs > queueMaxMs;
                const canCraft = missing.length === 0 && !overflows;
                
                const timeMax = Math.max(0, Math.floor((queueMaxMs - usedMs) / effectiveMs));
                const affordCount = maxAffordableCount(r, farm.balances);
                const maxN = Math.max(1, Math.min(timeMax, affordCount, 99));
                
                const rawCount = countByRecipe[r.id] ?? 1;
                const count = Math.max(1, Math.min(maxN, rawCount));
                const rowPending = pendingRecipeId === r.id && queueMutation.isPending;
                
                const hint = missing.length > 0 ? `Need more ${missing.join(', ')}` : overflows ? `Queue full — ${formatDuration(queueMaxMs)} cap` : '';
                
                return (
                  <div key={r.id} className="recipe" data-recipe={r.id}>
                    <div className="rtop">
                      <div><div className="rn">{r.itemName}</div><div className="rd">{r.itemDescription}</div></div>
                      <div className="rtime">{formatDuration(effectiveMs)}</div>
                    </div>
                    <div className="costs">
                      {r.meatCost === 0 && r.bitsCost === 0 && r.dataCost === 0 ? (
                        <span className="cchip"><span className="cd" />Free</span>
                      ) : (
                        <>
                          {r.meatCost > 0 && <span className={`cchip ${farm.balances.Meat < r.meatCost ? 'short' : ''}`} data-res="meat"><span className="cd" />{r.meatCost} Meat</span>}
                          {r.bitsCost > 0 && <span className={`cchip ${farm.balances.Bits < r.bitsCost ? 'short' : ''}`} data-res="bits"><span className="cd" />{r.bitsCost} Bits</span>}
                          {r.dataCost > 0 && <span className={`cchip ${farm.balances.Data < r.dataCost ? 'short' : ''}`} data-res="data"><span className="cd" />{r.dataCost} Data</span>}
                        </>
                      )}
                    </div>
                    <div className="ract">
                      <span className="rhint" hidden={canCraft}>{hint}</span>
                      <div className="qty" hidden={!canCraft}>
                        <button className="qbtn" onClick={() => setCountByRecipe(prev => ({...prev, [r.id]: count - 1}))} disabled={count <= 1}>−</button>
                        <input className="qin" type="number" inputMode="numeric" min={1} max={maxN} value={count} readOnly />
                        <button className="qbtn" onClick={() => setCountByRecipe(prev => ({...prev, [r.id]: count + 1}))} disabled={count >= maxN}>+</button>
                      </div>
                      <button 
                        className="craftbtn" 
                        disabled={!canCraft || rowPending} 
                        onClick={() => queueMutation.mutate({ factoryId: selectedFactory.id, recipeId: r.id, count })}
                      >
                        {rowPending ? 'Queuing...' : 'Queue craft'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      <div className={`toast factory-toast ${notice ? 'show' : ''}`} role="status" aria-live="polite">{notice}</div>
    </>
  );
}

function queueUsedMs(queue: readonly CraftingJobView[], now: number): number {
  return queue.reduce((a, j) => {
    if (j.readyToCollect) return a;
    const rem = j.isActive && j.finishesAt !== null ? Math.max(0, j.finishesAt - now) : j.durationMs;
    return a + rem;
  }, 0);
}

function FacIcon({ type }: { type: string }) {
  if (type === 'med') return <><path d="M12 4v16M4 12h16" strokeWidth="2.4"/><rect x="4" y="4" width="16" height="16" rx="0"/></>;
  if (type === 'chip') return <><rect x="6" y="6" width="12" height="12"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></>;
  if (type === 'rare') return <><path d="M12 3l3 5 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1 3-5z"/></>;
  if (type === 'pantry') return <><path d="M5 8h14v11H5z"/><path d="M5 8l2-4h10l2 4"/><path d="M9 12h6"/></>;
  return null;
}

type QueueGroup = {
  readonly jobs: readonly CraftingJobView[];
  readonly recipeId: string;
  readonly itemName: string;
  readonly count: number;
  readonly hasAuto: boolean;
  readonly hasActive: boolean;
  readonly hasReady: boolean;
};

function groupQueue(queue: readonly CraftingJobView[]): readonly QueueGroup[] {
  const groups: Array<{
    jobs: CraftingJobView[];
    recipeId: string;
    itemName: string;
    hasAuto: boolean;
  }> = [];
  for (const job of queue) {
    if (job.isActive || job.readyToCollect) continue; // we only group pending jobs
    const last = groups[groups.length - 1];
    if (last && last.recipeId === job.recipeId && last.hasAuto === job.isAuto) {
      last.jobs.push(job);
    } else {
      groups.push({ jobs: [job], recipeId: job.recipeId, itemName: job.itemName, hasAuto: job.isAuto });
    }
  }
  return groups.map((g) => ({
    jobs: g.jobs,
    recipeId: g.recipeId,
    itemName: g.itemName,
    count: g.jobs.length,
    hasAuto: g.hasAuto,
    hasActive: false,
    hasReady: false,
  }));
}

function maxAffordableCount(recipe: RecipeView, balances: Record<'Meat' | 'Bits' | 'Data', number>): number {
  const perResource = [
    recipe.meatCost > 0 ? Math.floor(balances.Meat / recipe.meatCost) : Number.POSITIVE_INFINITY,
    recipe.bitsCost > 0 ? Math.floor(balances.Bits / recipe.bitsCost) : Number.POSITIVE_INFINITY,
    recipe.dataCost > 0 ? Math.floor(balances.Data / recipe.dataCost) : Number.POSITIVE_INFINITY,
  ];
  const min = Math.min(...perResource);
  return Number.isFinite(min) ? min : 999;
}

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}
