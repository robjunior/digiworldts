import type { Attribute, Element, TemplateDigimon } from '@digiworld/shared/digimon';
import { ATTRIBUTES, ELEMENTS, resolveResistance, attrMultiplier } from '@digiworld/shared/digimon';
import { ElementIcon } from '../common/ElementIcon';

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
  fire: <ElementIcon element="fire" size="xs" />,
  water: <ElementIcon element="water" size="xs" />,
  plant: <ElementIcon element="plant" size="xs" />,
  ice: <ElementIcon element="ice" size="xs" />,
  electricity: <ElementIcon element="electricity" size="xs" />,
  earth: <ElementIcon element="earth" size="xs" />,
  steel: <ElementIcon element="steel" size="xs" />,
  wind: <ElementIcon element="wind" size="xs" />,
  light: <ElementIcon element="light" size="xs" />,
  dark: <ElementIcon element="dark" size="xs" />,
  null: <ElementIcon element="null" size="xs" />,
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
