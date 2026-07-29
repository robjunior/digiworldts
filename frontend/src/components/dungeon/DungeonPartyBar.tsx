import type { ReactElement } from 'react';

import type { RosterView } from '../../lib/api';

type DungeonPartyBarProps = {
  readonly party: readonly RosterView[];
  readonly targeting: boolean;
  readonly busy: boolean;
  readonly now: number;
  readonly onTarget: (monId: string) => void;
};

function effectiveHp(mon: RosterView): number {
  return mon.currentHp ?? mon.hpMax;
}

function effectiveEn(mon: RosterView): number {
  return mon.currentEn ?? mon.enMax;
}

function hpTone(pct: number): string {
  if (pct <= 25) return 'is-crit';
  if (pct <= 55) return 'is-low';
  return '';
}

export function DungeonPartyBar({ party, targeting, busy, now, onTarget }: DungeonPartyBarProps): ReactElement {
  return (
    <div className={`dp-party${targeting ? ' is-targeting' : ''}`}>
      <div className="dp-party-hd">
        <span className="dp-party-title">Party</span>
        {targeting ? <span className="dp-party-hint">Click a member to apply</span> : null}
      </div>
      <div className="dp-party-slots">
        {party.map((mon) => {
          const dot = mon.template?.assets?.dot;
          const element = mon.template?.element ?? 'null';
          const stage = mon.template?.stage ?? 'Rookie';
          const isDown = mon.reviveAt !== null && mon.reviveAt > now;
          const hp = effectiveHp(mon);
          const hpMax = Math.max(1, mon.hpMax);
          const en = effectiveEn(mon);
          const enMax = Math.max(1, mon.enMax);
          const hpPct = Math.max(0, Math.min(100, Math.round((hp / hpMax) * 100)));
          const enPct = Math.max(0, Math.min(100, Math.round((en / enMax) * 100)));
          return (
            <button
              key={mon.id}
              type="button"
              className={`dp-slot${isDown ? ' is-down' : ''}`}
              data-element={element}
              style={{ ['--el' as string]: `var(--el-${element})` }}
              onClick={() => onTarget(mon.id)}
              disabled={busy || !targeting}
              aria-label={`${mon.nickname}, Lv ${mon.level} ${stage}, HP ${hp}/${hpMax}, EN ${en}/${enMax}${isDown ? ', downed' : ''}${targeting ? ' — apply item' : ''}`}
              title={isDown ? `${mon.nickname} — recovering` : targeting ? `Apply to ${mon.nickname}` : mon.nickname}
            >
              <span className="dp-slot-pic">
                {dot ? <img src={dot} alt="" /> : <span className="dp-slot-q">?</span>}
              </span>
              <span className="dp-slot-nm">{mon.nickname}</span>
              <span className="dp-slot-lv">Lv {mon.level}</span>
              <span className={`dp-slot-hp ${hpTone(hpPct)}`} aria-hidden="true">
                <span className="dp-slot-bar"><span className="dp-slot-fill" style={{ width: `${hpPct}%` }} /></span>
                <span className="dp-slot-num">{hp}/{hpMax}</span>
              </span>
              <span className="dp-slot-en" aria-hidden="true">
                <span className="dp-slot-bar"><span className="dp-slot-fill" style={{ width: `${enPct}%` }} /></span>
                <span className="dp-slot-num">{en}/{enMax}</span>
              </span>
              {isDown ? <span className="dp-slot-down">DOWN</span> : null}
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, 3 - party.length) }, (_, i) => (
          <div key={`empty-${i}`} className="dp-slot dp-slot--empty" aria-hidden="true">
            <span className="dp-slot-pic"><span className="dp-slot-q">·</span></span>
            <span className="dp-slot-nm">Empty</span>
          </div>
        ))}
      </div>
    </div>
  );
}
