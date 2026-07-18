import type { CSSProperties } from 'react';

import type { FarmBuildingView, FarmResourceKind } from '../../lib/api-farm';

const RESOURCE_CLASS: Record<FarmResourceKind, string> = {
  Meat: 'bld--meat',
  Bits: 'bld--bits',
  Data: 'bld--data',
};

const KIND_GLYPH: Record<string, string> = {
  'Meat Farm': 'M15 4a4 4 0 0 0-4 4c0 1-1 2-3 2a5 5 0 0 0 0 10c4 0 6-2 8-5s3-6 3-9a2 2 0 0 0-2-2Z',
  'Bit Foundry': 'M5 8h14v10H5zM9 3v3M15 3v3M9 13h.01M15 13h.01M2 12h3M19 12h3',
  'Data Spire': 'M12 2 4 7v10l8 5 8-5V7ZM12 2v20M4 7l8 5 8-5',
  'Bio Lab': 'M9 3v6l-4 8a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-4-8V3M8 3h8',
};

type FarmBuildingActions = {
  readonly building: FarmBuildingView;
  readonly credits: number;
  readonly pendingBuildingId: string | null;
  readonly onCollect: (buildingId: string) => void;
  readonly onUpgrade: (buildingId: string) => void;
};

export function FarmBuildingCard(props: FarmBuildingActions): JSX.Element {
  const { building, credits, pendingBuildingId, onCollect, onUpgrade } = props;
  const ready = building.produced >= 1;
  const canUpgrade = credits >= building.upgradeCost;
  const fillStyle: CSSProperties & Record<'--pct', string> = { '--pct': `${clamp(Math.round((building.produced / building.capacity) * 100), 0, 100)}%` };
  const pending = pendingBuildingId === building.id;

  return (
    <article className={`bld ${RESOURCE_CLASS[building.resource]} ${ready ? 'is-ready' : ''}`}>
      <div className="art">
        <span className="lv">Lv {building.level}</span>
        {ready ? <span className="ready-dot" aria-hidden="true" /> : null}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={KIND_GLYPH[building.kind] ?? ''} />
        </svg>
      </div>
      <div className="body">
        <div className="top">
          <span className="bname">{building.kind}</span>
          <span className="rate">+<b>{building.ratePerHour}</b> {building.resource}/hr</span>
        </div>
        <div className="store">
          <div className="store-head">
            <span>Stored{building.full ? ' · Full' : ''}</span>
            <span className="v"><b>{formatAmount(building.produced)}</b> / {formatAmount(building.capacity)}</span>
          </div>
          <div className="fill" role="progressbar" aria-valuenow={Math.round(building.produced)} aria-valuemin={0} aria-valuemax={building.capacity}>
            <i style={fillStyle} />
          </div>
        </div>
        <div className="foot">
          <button className="btn btn--secondary" type="button" disabled={!ready || pending} aria-label={`Collect ${formatAmount(building.produced)} ${building.resource}`} onClick={() => onCollect(building.id)}>Collect</button>
          <button className="btn btn--tertiary" type="button" disabled={!canUpgrade || pending} aria-label={`Upgrade ${building.kind}, costs ${building.upgradeCost} DigiCredits`} onClick={() => onUpgrade(building.id)}>
            Upgrade <span className="credits">{formatAmount(building.upgradeCost)}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString();
}
