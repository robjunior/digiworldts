import type { JSX, ReactNode } from 'react';

import { CheckIcon } from '../common/icons';
import type { AdventureConfigView } from '../../lib/api-adventure';
import type { RosterView } from '../../lib/api';

/**
 * "Send an expedition" planner — the panel that lets the player pick 3 resting mons,
 * choose the expedition length, review provisions/encounter counts, and embark.
 * Previously inline in Adventure.tsx (~90 lines within the JSX tree).
 */
export function ExpeditionPlanner({
  roster,
  selectedIds,
  now,
  hours,
  config,
  provisionsOwned,
  provisionsNeeded,
  canStart,
  isPending,
  hint,
  onTogglePick,
  onHours,
  onEmbark,
}: {
  readonly roster: readonly RosterView[];
  readonly selectedIds: readonly (string | null)[];
  readonly now: number;
  readonly hours: number;
  readonly config: AdventureConfigView;
  readonly provisionsOwned: number;
  readonly provisionsNeeded: number;
  readonly canStart: boolean;
  readonly isPending: boolean;
  readonly hint: { readonly node: ReactNode; readonly warn: boolean };
  readonly onTogglePick: (monId: string) => void;
  readonly onHours: (h: number) => void;
  readonly onEmbark: () => void;
}): JSX.Element {
  return (
    <div className="panelbox">
      <div className="pinner">
        <div className="rlabel">Pick your party — {config.partySize} resting Digimon</div>
        <div className="party">
          {roster.map((mon) => {
            const isDowned = mon.reviveAt !== null && mon.reviveAt > now;
            const isPicked = selectedIds.includes(mon.id);
            return (
              <div
                key={mon.id}
                className={`mon ${isPicked ? 'picked' : ''} ${isDowned ? 'downed' : ''} ${!isDowned ? 'picker' : ''}`}
                onClick={() => {
                  if (!isDowned) onTogglePick(mon.id);
                }}
              >
                <span className="pick-ic">
                  <CheckIcon />
                </span>
                {isDowned && <span className="ko">Downed</span>}
                <span className="spr">
                  <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
                </span>
                <span className="nick">{mon.nickname}</span>
                <span className="sub">
                  Lv {mon.level} · <span className="st">{mon.template?.stage ?? '?'}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="field">
          <div className="flabel">
            <span>Expedition length</span>
            <b>{hours}h</b>
          </div>
          <input
            type="range"
            min={config.minHours}
            max={config.maxHours}
            step="1"
            value={hours}
            onChange={(e) => onHours(Number(e.target.value))}
            aria-label="Expedition length in hours"
          />
        </div>

        <div className="previewgrid">
          <div className={`pv ${provisionsNeeded > provisionsOwned ? 'short' : ''}`} title="Provisions come from Farm crafting (Bio Lab) or Shop.">
            <div className="k">Provisions</div>
            <div className="v">{provisionsNeeded}</div>
          </div>
          <div className="pv">
            <div className="k">Encounters</div>
            <div className="v">~{Math.round(hours * config.encountersPerHour)}</div>
          </div>
          <div className="pv">
            <div className="k">Returns in</div>
            <div className="v">{hours}h</div>
          </div>
        </div>
      </div>
      <div className="afoot">
        <span className={`ahint ${hint.warn ? 'warn' : ''}`}>{hint.node}</span>
        <button className="btn primary" disabled={!canStart || isPending} onClick={onEmbark}>
          Embark
        </button>
      </div>
    </div>
  );
}
