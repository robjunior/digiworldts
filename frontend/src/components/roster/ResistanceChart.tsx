import type { Attribute, Element, TemplateDigimon } from '@digiworld/shared/digimon';
import { ATTRIBUTES, ELEMENTS, resolveResistance, attrMultiplier } from '@digiworld/shared/digimon';

const ATTR_ICONS: Record<Attribute, JSX.Element> = {
  Vaccine: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z" /></svg>,
  Data: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.35.19-.79.19-1.14 0l-7.9-4.44A.993.993 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.35-.19.79-.19 1.14 0l7.9 4.44c.32.17.53.5.53.88v9z" /></svg>,
  Virus: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M9 15l6-6m0 6L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  Free: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" /></svg>,
  Variable: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2v20m-10-10h20m-17 7l14-14m0 14L5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  Unknown: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><text x="12" y="16" fontSize="14" fontWeight="bold" textAnchor="middle" fill="currentColor">?</text></svg>,
  NoData: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
};

const EL_ICONS: Record<Element, JSX.Element> = {
  fire: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8 6 6 10 6 14c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-2-8-6-12z" /></svg>,
  water: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21c-3.87 0-7-3.13-7-7 0-4.04 7-11.36 7-11.36s7 7.32 7 11.36c0 3.87-3.13 7-7 7z" /></svg>,
  plant: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 5.92L9 2v18h6v-6h4.5c1.93 0 3.5-1.57 3.5-3.5C23 8.35 19.86 5.92 17 5.92z" /><path d="M8 22H2v-6h6v6z" /></svg>,
  ice: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L9 9H2l6 5-2 8 6-5 6 5-2-8 6-5h-7L12 2z" /></svg>,
  electricity: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z" /></svg>,
  earth: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l8 8-4 12H8L4 10z" /></svg>,
  steel: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" /></svg>,
  wind: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 14h11c1.1 0 2-.9 2-2s-.9-2-2-2H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /><path d="M4 18h7c1.1 0 2 .9 2 2s-.9 2-2 2H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /><path d="M4 10h14c1.66 0 3-1.34 3-3s-1.34-3-3-3H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>,
  light: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m9.9-9.9l2.12-2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  dark: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-1.5.89-3.23 1.36-5.06 1.36-4.97 0-9-4.03-9-9 0-1.25.26-2.45.74-3.53C6.01 4.54 5.3 5.48 4.8 6.5A8.995 8.995 0 0 0 12 21c4.97 0 9-4.03 9-9 0-.89-.13-1.74-.36-2.55C19.34 11.51 16 13 12 13V3z" /></svg>,
  null: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" strokeWidth="2" /></svg>,
};

function RmTile({ svg, lbl, mult, isSelf }: { readonly svg: JSX.Element; readonly lbl: string; readonly mult: number; readonly isSelf: boolean }): JSX.Element {
  const txt = mult === 1.5 ? '+' : (mult === 0.5 ? '−' : (mult === 2 ? '++' : (mult === 0 ? '0' : '—')));
  const cl = mult === 1.5 ? 'weak' : (mult === 0.5 ? 'strong' : 'even');
  return (
    <div className={`rmtile ${isSelf ? 'you' : ''} ${cl}`}>
      <div className="rl">{lbl}</div>
      <div className="ic">{svg}</div>
      <div className="bd">{txt}</div>
    </div>
  );
}

const ATTR_STRONG: Partial<Record<Attribute, Attribute>> = { Vaccine: 'Virus', Virus: 'Data', Data: 'Vaccine' };

export function ResistanceChart({ template }: { readonly template: TemplateDigimon }): JSX.Element {
  const defenderAttr = template.attribute;
  const defenderEl = template.element;
  const resistances = template.resistances;

  const beats = ATTR_STRONG[defenderAttr];
  const weakToAttr = (Object.entries(ATTR_STRONG) as [Attribute, Attribute][]).find(([, d]) => d === defenderAttr)?.[0];

  const affSum = (
    <span className="affsum" style={{ ['--el' as string]: 'var(--el)' }}>
      <span className="as self">{defenderAttr}</span>
      {weakToAttr ? <> <span className="as weak">weak {weakToAttr}</span></> : null}
      {beats ? <> <span className="as strong">strong {beats}</span></> : null}
    </span>
  );

  return (
    <div className="resmx affpanel" data-od-id="affinity-panel">
      <div className="rmh">Affinity{affSum}</div>
      
      <div className="affline">
        <span className="alab">Attribute</span>
        <div className="rmgrid">
          {ATTRIBUTES.map((a) => (
            <RmTile 
              key={a}
              svg={ATTR_ICONS[a] ?? ATTR_ICONS.Unknown} 
              lbl={a.slice(0, 3).toUpperCase()} 
              mult={attrMultiplier(a, defenderAttr)} 
              isSelf={a === defenderAttr} 
            />
          ))}
        </div>
      </div>

      <div className="affline">
        <span className="alab">Element</span>
        <div className="rmgrid">
          {ELEMENTS.map((elk) => (
            <RmTile 
              key={elk}
              svg={EL_ICONS[elk] ?? EL_ICONS.null} 
              lbl={elk.slice(0, 3).toUpperCase()} 
              mult={resolveResistance(elk, defenderEl, resistances)} 
              isSelf={elk === defenderEl} 
            />
          ))}
        </div>
      </div>

      <div className="afflegend">
        <b style={{ color: 'var(--battle)' }}>+</b> weak &nbsp;·&nbsp; 
        <b style={{ color: 'var(--signal)' }}>−</b> resist &nbsp;·&nbsp; 
        <span style={{ color: 'var(--muted)' }}>—</span> even
      </div>
    </div>
  );
}
