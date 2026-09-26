import type { JSX } from 'react';

import { AlertIcon } from '../common/icons';
import type { AdventureReport, AdventureView } from '../../lib/api-adventure';
import { DigimonSprite } from '../common/DigimonSprite';
import '../../styles/extensions-premium.css';

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
  // Reports stored in the DB before the `foundDigimons` rewrite may lack the
  // newer fields — default them so old rows still render.
  const {
    wins = 0,
    losses = 0,
    totals = { meat: 0, bits: 0, data: 0, netcore: 0 },
    premium = false,
    premiumBonus = { meat: 0, bits: 0, data: 0, netcore: 0, xp: 0 },
    foundDigimons = [],
    xpDeltas = [],
    koedMonIds = [],
  } = report;
  const encCount = wins + losses;
  const noLoot =
    totals.meat === 0 &&
    totals.bits === 0 &&
    totals.data === 0 &&
    totals.netcore === 0;

  return (
    <>
      <div className="wl">
        <div className="b wins">
          <div className="k">Wins</div>
          <div className="v">{wins}</div>
        </div>
        <div className="b loss">
          <div className="k">Losses</div>
          <div className="v">{losses}</div>
        </div>
      </div>
      <div className="rlabel">
        {h}h run · {encCount} encounters
      </div>
      <div className="rlabel">Loot banked</div>
      <div className="loot">
        {totals.meat > 0 && (
          <span className="lchip" data-res="meat">
            <span className="cd" />
            <span className={premium && premiumBonus.meat > 0 ? 'prem-amt' : ''}>{totals.meat.toLocaleString('en-US')}</span>{' '}
            <span className="u">Meat</span>
            {premium && premiumBonus.meat > 0 && <span className="prem-plus">{premiumBonus.meat.toLocaleString('en-US')}</span>}
          </span>
        )}
        {totals.bits > 0 && (
          <span className="lchip" data-res="bits">
            <span className="cd" />
            <span className={premium && premiumBonus.bits > 0 ? 'prem-amt' : ''}>{totals.bits.toLocaleString('en-US')}</span>{' '}
            <span className="u">Bits</span>
            {premium && premiumBonus.bits > 0 && <span className="prem-plus">{premiumBonus.bits.toLocaleString('en-US')}</span>}
          </span>
        )}
        {totals.data > 0 && (
          <span className="lchip" data-res="data">
            <span className="cd" />
            <span className={premium && premiumBonus.data > 0 ? 'prem-amt' : ''}>{totals.data.toLocaleString('en-US')}</span>{' '}
            <span className="u">Data</span>
            {premium && premiumBonus.data > 0 && <span className="prem-plus">{premiumBonus.data.toLocaleString('en-US')}</span>}
          </span>
        )}
        {totals.netcore > 0 && (
          <span className="lchip" data-res="credits">
            <span className="cd" />
            <span className={premium && premiumBonus.netcore > 0 ? 'prem-amt' : ''}>{totals.netcore.toLocaleString('en-US')}</span>{' '}
            <span className="u">NetCore</span>
            {premium && premiumBonus.netcore > 0 && <span className="prem-plus">{premiumBonus.netcore.toLocaleString('en-US')}</span>}
          </span>
        )}
        {noLoot && <span className="rep-empty">No loot this run.</span>}
      </div>
      {premium && premiumBonus.xp > 0 && (
        <div className="prem-banner" style={{ margin: '8px 0' }}>
          <span className="ico">&#9733;</span>
          <span><b>Premium</b> — <b>+{premiumBonus.xp.toLocaleString('en-US')} XP</b> de bônus nesta expedição.</span>
        </div>
      )}
      {foundDigimons.length > 0 && (
        <>
          <div className="rlabel">Digimon found</div>
          <div className="found">
            {foundDigimons.map((f) => (
              <span
                className="fchip"
                key={f.catalogId}
                title={`${f.name} — ${f.stage}${f.element !== 'null' ? ` · ${f.element}` : ''}`}
              >
                <span className="fspr">
                  <DigimonSprite catalogId={f.catalogId} />
                </span>
                <span className="fn">{f.name}</span>
                <span className="fst">{f.stage}</span>
                {f.count > 1 && <span className="fcnt">×{f.count}</span>}
              </span>
            ))}
          </div>
        </>
      )}
      <div className="rlabel">Experience</div>
      {xpDeltas.map((x) => {
        const mon = adventure.party.find((p) => p.monId === x.monId);
        return (
          <div className="xprow" key={x.monId}>
            <span className="xspr">
              {mon != null ? <DigimonSprite catalogId={mon.catalogId} /> : null}
            </span>
            <span className="xn">{mon?.nickname ?? x.monId}</span>
            <span className="xg">
              <span className={premium ? 'prem-amt' : ''}>+{x.xpGained.toLocaleString('en-US')} XP</span>
              {x.gainedLevels > 0 && <span className="lvup">Lv {x.levelAfter}</span>}
            </span>
          </div>
        );
      })}
      {koedMonIds.length > 0 && (
        <div className="koline">
          <AlertIcon />
          {koedMonIds
            .map((id) => adventure.party.find((p) => p.monId === id)?.nickname ?? id)
            .join(', ')}{' '}
          knocked out — recovering (30m)
        </div>
      )}
    </>
  );
}
