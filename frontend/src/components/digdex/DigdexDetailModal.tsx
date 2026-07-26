import { useEffect, useMemo } from 'react';
import { WEAK_MAP, RESIST_MAP, type Element } from '@digiworld/shared/digimon';

import type { DigdexEntry } from '../../lib/api-digdex';

export type DigdexDetailModalProps = {
  readonly entry: DigdexEntry;
  readonly entriesById: ReadonlyMap<string, DigdexEntry>;
  readonly onClose: () => void;
  readonly onSelect: (entry: DigdexEntry) => void;
};

function affName(el: Element | undefined): string {
  return el || '—';
}

export function DigdexDetailModal({ entry, entriesById, onClose, onSelect }: DigdexDetailModalProps): JSX.Element | null {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stopPropagation = (event: React.MouseEvent): void => event.stopPropagation();

  const d = entry;
  const el = d.template?.element || 'null';
  const weak = WEAK_MAP[el as Element];
  const resist = RESIST_MAP[el as Element];

  return (
    <div className="digdex-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="digdex-modal-title">
      <div 
        className="digdex-modal-container detail" 
        style={{ '--ec': `var(--el-${el})` } as React.CSSProperties} 
        onClick={stopPropagation}
      >
        <button className="digdex-modal-close" onClick={onClose} aria-label="Close">×</button>
        {d.met && d.template ? (
          <>
            <div className="dhead" style={{ '--ec': `var(--el-${el})` } as React.CSSProperties}>
              <div className="dk">{d.template.element} · {d.template.attribute}</div>
              <div className="dspr">
                <img src={d.template.assets.dot} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              </div>
              <h2 id="digdex-modal-title">{d.template.name}</h2>
              <div className="dnum">No. {String(parseInt(d.catalogId, 10)).padStart(3, '0')} · {d.template.stage}</div>
            </div>
            <div className="dmeta">
              <div className="mrow"><span className="mk">Status</span><span className="metpill met">Met</span></div>
              <div className="mrow"><span className="mk">Element</span><span className="chip" style={{ '--ec': `var(--el-${el})` } as React.CSSProperties}><span className="cd" />{d.template.element}</span></div>
              <div className="mrow"><span className="mk">Attribute</span><span className="mv">{d.template.attribute}</span></div>
              <div className="mrow"><span className="mk">Stage</span><span className="mv">{d.template.stage}</span></div>
              <div className="mrow"><span className="mk">Type</span><span className="mv">{d.template.type || '—'}</span></div>
            </div>
            <div className="daff">
              <div className="dlk">Elemental affinity</div>
              <div className="affrow"><span className="tag weak">Weak</span>{weak ? <span className="av">{affName(weak)}</span> : <span className="none">— none</span>}</div>
              <div className="affrow"><span className="tag resist">Resist</span>{resist ? <span className="av">{affName(resist)}</span> : <span className="none">— none</span>}</div>
            </div>
          </>
        ) : (
          <>
            <div className="dhead" style={{ '--ec': `var(--el-null)` } as React.CSSProperties}>
              <div className="dk">null · Unknown</div>
              <div className="dspr"><span className="qq">?</span></div>
              <h2 id="digdex-modal-title">Unknown species</h2>
              <div className="dnum">No. {String(parseInt(d.catalogId, 10)).padStart(3, '0')} · Unknown</div>
            </div>
            <div className="dmeta">
              <div className="mrow"><span className="mk">Status</span><span className="metpill unmet">Not met</span></div>
              <div className="mrow"><span className="mk">Element</span><span className="chip" style={{ '--ec': `var(--el-null)` } as React.CSSProperties}><span className="cd" />???</span></div>
              <div className="mrow"><span className="mk">Attribute</span><span className="mv">???</span></div>
              <div className="mrow"><span className="mk">Stage</span><span className="mv">???</span></div>
              <div className="mrow"><span className="mk">Type</span><span className="mv">—</span></div>
            </div>
            <div className="daff">
              <div className="dlk">Elemental affinity</div>
              <div className="affrow"><span className="tag weak">Weak</span><span className="none">— none</span></div>
              <div className="affrow"><span className="tag resist">Resist</span><span className="none">— none</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
