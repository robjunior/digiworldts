import type { JSX } from 'react';

import { AlertIcon } from '../common/icons';
import type { AdventureReport, AdventureView } from '../../lib/api-adventure';
import { unitSpriteStaticUrl } from '@digiworld/scene3d';

/**
 * Right-column "Last Report" pane that shows wins/losses, loot totals,
 * XP deltas, and any KOs. Previously an inline function in Adventure.tsx.
 */
export function ReportPanel({
  report,
  adventure,
}: {
  readonly report: AdventureReport | null;
  readonly adventure: AdventureView | null;
}): JSX.Element {
  if (!report || !adventure) {
    return (
      <div className="rep-empty">
        No expeditions yet. Send a party into the field, and their battle report — loot, XP, and any KOs — lands here
        when they return.
      </div>
    );
  }

  const h = Math.max(1, Math.round(adventure.distanceMs / 3600000));
  const encCount = report.wins + report.losses;
  const noLoot =
    report.totals.meat === 0 &&
    report.totals.bits === 0 &&
    report.totals.data === 0 &&
    report.totals.netcore === 0;

  return (
    <>
      <div className="wl">
        <div className="b wins">
          <div className="k">Wins</div>
          <div className="v">{report.wins}</div>
        </div>
        <div className="b loss">
          <div className="k">Losses</div>
          <div className="v">{report.losses}</div>
        </div>
      </div>
      <div className="rlabel">
        {h}h run · {encCount} encounters
      </div>
      <div className="rlabel">Loot banked</div>
      <div className="loot">
        {report.totals.meat > 0 && (
          <span className="lchip" data-res="meat">
            <span className="cd" />
            {report.totals.meat.toLocaleString('en-US')} <span className="u">Meat</span>
          </span>
        )}
        {report.totals.bits > 0 && (
          <span className="lchip" data-res="bits">
            <span className="cd" />
            {report.totals.bits.toLocaleString('en-US')} <span className="u">Bits</span>
          </span>
        )}
        {report.totals.data > 0 && (
          <span className="lchip" data-res="data">
            <span className="cd" />
            {report.totals.data.toLocaleString('en-US')} <span className="u">Data</span>
          </span>
        )}
        {report.totals.netcore > 0 && (
          <span className="lchip" data-res="credits">
            <span className="cd" />
            {report.totals.netcore.toLocaleString('en-US')} <span className="u">NetCore</span>
          </span>
        )}
        {noLoot && <span className="rep-empty">No loot this run.</span>}
      </div>
      <div className="rlabel">Experience</div>
      {report.xpDeltas.map((x) => {
        const mon = adventure.party.find((p) => p.monId === x.monId);
        return (
          <div className="xprow" key={x.monId}>
            <span className="xspr">
              <img src={mon != null ? unitSpriteStaticUrl(mon.catalogId) : ''} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            </span>
            <span className="xn">{mon?.nickname ?? x.monId}</span>
            <span className="xg">
              +{x.xpGained.toLocaleString('en-US')} XP
              {x.gainedLevels > 0 && <span className="lvup">Lv {x.levelAfter}</span>}
            </span>
          </div>
        );
      })}
      {report.koedMonIds.length > 0 && (
        <div className="koline">
          <AlertIcon />
          {report.koedMonIds
            .map((id) => adventure.party.find((p) => p.monId === id)?.nickname ?? id)
            .join(', ')}{' '}
          knocked out — recovering (30m)
        </div>
      )}
    </>
  );
}
