import type { JSX } from 'react';

import { FacIcon } from './FacIcon';
import { formatDuration, groupQueue, queueUsedMs } from './utils';
import type { CraftingJobView, PlayerFactoryView } from '../../lib/api-farm';

/**
 * Single owned factory card — the `<article className="fcard">` block that
 * was previously inline in Factory.tsx. Renders header, craft-speed row,
 * queue meter, active/queued jobs, and the footer with "Craft item" and
 * "Upgrade" buttons.
 */
export function FactoryCard({
  factory,
  now,
  queueMaxMs,
  credits,
  upgradePending,
  cancelPending,
  onOpenRecipes,
  onUpgrade,
  onCancelJob,
  onCollect,
}: {
  readonly factory: PlayerFactoryView;
  readonly now: number;
  readonly queueMaxMs: number;
  readonly credits: number;
  readonly upgradePending: boolean;
  readonly cancelPending: boolean;
  readonly onOpenRecipes: (factoryId: string) => void;
  readonly onUpgrade: (factoryId: string) => void;
  readonly onCancelJob: (jobId: string) => void;
  readonly onCollect: (jobId: string) => void;
}): JSX.Element {
  const maxed = factory.level >= factory.maxLevel;
  const canAfford = credits >= factory.upgradeCost;
  const activeCount = factory.queue.filter((j) => j.isActive || j.readyToCollect).length;
  const usedMs = queueUsedMs(factory.queue, now);
  const capPct = queueMaxMs > 0 ? (usedMs / queueMaxMs) * 100 : 0;
  const groups = groupQueue(factory.queue);
  const pendingGroups = groups.filter((g) => !g.hasActive && !g.hasReady);

  return (
    <article
      className="fcard"
      data-fac={factory.type}
      aria-label={`${factory.name}, level ${factory.level} of ${factory.maxLevel}, ${activeCount} active jobs`}
    >
      <div className="fhead">
        <span className="badge">
          <FacIcon type={factory.type} />
        </span>
        <div>
          <div className="nm">{factory.name}</div>
          <div className="desc">{factory.description}</div>
        </div>
        <div className="lvbadge">
          <div className="lk">Level</div>
          <div className="lv">
            {factory.level}
            <small>/{factory.maxLevel}</small>
          </div>
        </div>
      </div>
      <div className="fspeed">
        <span>
          Craft speed bonus <b className="spd">+{factory.craftSpeedPct}%</b>
        </span>
        <span>
          {activeCount}/{factory.queue.length} jobs running
        </span>
      </div>
      <div className="queue">
        <div className="qhead">
          <span>Crafting queue</span>
          <span className={`qcap ${capPct >= 100 ? 'full' : ''}`}>
            <b>{formatDuration(usedMs)}</b> / {formatDuration(queueMaxMs)} queued
          </span>
        </div>
        <div
          className={`qmeter ${capPct >= 100 ? 'full' : ''}`}
          role="progressbar"
          aria-valuenow={Math.round(capPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Queue time used"
        >
          <i style={{ width: `${Math.min(100, capPct)}%` }} />
        </div>
        <div className="qjobs">
          {factory.queue.length === 0 ? (
            <div className="qempty">Idle — pick a recipe to start crafting.</div>
          ) : (
            factory.queue.map((j) =>
              j.isActive || j.readyToCollect ? (
                <FactoryQueueJob
                  key={j.id}
                  job={j}
                  now={now}
                  cancelPending={cancelPending}
                  onCancel={onCancelJob}
                  onCollect={onCollect}
                />
              ) : null,
            )
          )}
          {pendingGroups.map((g) => (
            <div key={g.itemName} className="job qgroup" data-qgroup={g.itemName}>
              <div className="jn">
                <div className="jt">
                  {g.itemName} {g.count > 1 ? <span className="xn">×{g.count}</span> : null}
                </div>
                <div className="jbar queued">
                  <span className="jfill" style={{ width: '0%' }} />
                </div>
              </div>
              <div className="jmeta">
                <span>Queued</span>
                <button
                  className="cancelbtn"
                  disabled={cancelPending}
                  onClick={() => {
                    const last = g.jobs[g.jobs.length - 1];
                    if (last) onCancelJob(last.id);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ffoot-wrap">
        <div className="ffoot" data-fac={factory.type} style={{ borderTop: '1px solid var(--hair)', gridTemplateColumns: '1fr auto' }}>
          <button className="btn primary" onClick={() => onOpenRecipes(factory.id)}>Craft item</button>
          {maxed ? (
            <span className="maxtag">Max level</span>
          ) : (
            <button
              className="btn ghost"
              disabled={!canAfford || upgradePending}
              title={canAfford ? '' : 'Not enough Credits'}
              onClick={() => onUpgrade(factory.id)}
            >
              {upgradePending ? 'Upgrading...' : `Upgrade · ${factory.upgradeCost.toLocaleString()}`}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function FactoryQueueJob({
  job,
  now,
  cancelPending,
  onCancel,
  onCollect,
}: {
  readonly job: CraftingJobView;
  readonly now: number;
  readonly cancelPending: boolean;
  readonly onCancel: (jobId: string) => void;
  readonly onCollect: (jobId: string) => void;
}): JSX.Element {
  const ready = job.readyToCollect;
  const progressPct =
    job.startedAt !== null ? Math.min(100, Math.max(0, ((now - job.startedAt) / job.durationMs) * 100)) : 0;
  return (
    <div className={`job ${ready ? 'ready' : ''}`} data-job={job.id}>
      <div className="jn">
        <div className="jt">{job.itemName}</div>
        <div className="jbar">
          <span className="jfill" style={{ width: `${ready ? 100 : progressPct}%` }} />
        </div>
      </div>
      <div className="jmeta">
        {ready ? (
          <>
            <span className="rc">READY</span>
            <button className="collectbtn" onClick={() => onCollect(job.id)}>Collect</button>
          </>
        ) : (
          <>
            <span>{Math.round(progressPct)}%</span>
            <button className="cancelbtn" disabled={cancelPending} onClick={() => onCancel(job.id)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
