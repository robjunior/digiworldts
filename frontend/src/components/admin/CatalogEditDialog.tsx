import type { Attribute, Element, Skill, Stage } from '@digiworld/shared/digimon';
import { ATTRIBUTES, ELEMENTS, STAGES } from '@digiworld/shared/digimon';
import type { FormEvent } from 'react';
import { useState } from 'react';

import type { TemplateDraft } from '../../lib/api-admin';
import { Field } from './AdminShared';

const DEFAULT_STAGE: Stage = 'Rookie';
const DEFAULT_ATTRIBUTE: Attribute = 'Vaccine';
const DEFAULT_ELEMENT: Element = 'neutral';

export function CatalogEditDialog({ open, onClose, onSubmit }: { readonly open: boolean; readonly onClose: () => void; readonly onSubmit: (draft: TemplateDraft) => Promise<void> }): JSX.Element | null {
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft = buildDraft(form);
    if (draft === null) {
      setError('Fill every required template field and all numeric stats.');
      return;
    }
    setError(null);
    await onSubmit(draft);
    event.currentTarget.reset();
  };

  return (
    <div className="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="custom-entry-title">
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="custom-entry-title">Custom catalog entry</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close custom entry dialog">×</button>
        </div>
        <form className="stack" id="custom-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <Field label="ID"><input className="input" name="id" placeholder="skb-custom" required /></Field>
            <Field label="Name"><input className="input" name="name" required /></Field>
            <Field label="Stage"><Select name="stage" values={STAGES} defaultValue={DEFAULT_STAGE} /></Field>
            <Field label="Attribute"><Select name="attribute" values={ATTRIBUTES} defaultValue={DEFAULT_ATTRIBUTE} /></Field>
            <Field label="Element"><Select name="element" values={ELEMENTS} defaultValue={DEFAULT_ELEMENT} /></Field>
            <Field label="Wikimon slug"><input className="input" name="wikimonSlug" /></Field>
            {(['hp', 'en', 'atk', 'def', 'int', 'spd'] as const).map((stat) => (
              <Field key={stat} label={stat.toUpperCase()}><input className="input" name={stat} type="number" min="1" defaultValue={stat === 'hp' ? 500 : stat === 'en' ? 30 : 100} required /></Field>
            ))}
            <Field label="Portrait URL"><input className="input" name="portrait" required /></Field>
            <Field label="Dot URL"><input className="input" name="dot" required /></Field>
          </div>
          <div className="skill-editor" id="skills-editor">
            {[0, 1, 2, 3].map((index) => <SkillFields key={index} index={index} />)}
          </div>
          {error ? <p className="auth-error" id="err-custom">{error}</p> : null}
          <div className="row spread">
            <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn" type="submit">Create template</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SkillFields({ index }: { readonly index: number }): JSX.Element {
  return (
    <div className="skill-editor-row">
      <span className="caps">Skill {index + 1}</span>
      <div className="row">
        <Field label="Name"><input className="input" name={`skill_name_${index}`} defaultValue={index === 0 ? 'Basic Attack' : ''} required /></Field>
        <Field label="Element"><Select name={`skill_el_${index}`} values={ELEMENTS} defaultValue={DEFAULT_ELEMENT} /></Field>
        <Field label="Cost"><input className="input" name={`skill_cost_${index}`} type="number" min="0" defaultValue={index === 0 ? 0 : 8} required /></Field>
        <Field label="Power"><input className="input" name={`skill_power_${index}`} type="number" min="0" defaultValue={index === 0 ? 120 : 180} required /></Field>
      </div>
    </div>
  );
}

function Select<T extends string>({ name, values, defaultValue }: { readonly name: string; readonly values: readonly T[]; readonly defaultValue: T }): JSX.Element {
  return (
    <select className="input" name={name} defaultValue={defaultValue}>
      {values.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  );
}

function buildDraft(form: FormData): TemplateDraft | null {
  const id = readString(form, 'id');
  const name = readString(form, 'name');
  const portrait = readString(form, 'portrait');
  const dot = readString(form, 'dot');
  const hp = readNumber(form, 'hp');
  const en = readNumber(form, 'en');
  const atk = readNumber(form, 'atk');
  const def = readNumber(form, 'def');
  const int = readNumber(form, 'int');
  const spd = readNumber(form, 'spd');
  if (!id || !name || !portrait || !dot || hp === null || en === null || atk === null || def === null || int === null || spd === null) return null;

  const skillPool = [0, 1, 2, 3].map((index) => buildSkill(form, index));
  if (skillPool.some((skill) => skill === null)) return null;
  const wikimonSlug = readOptionalString(form, 'wikimonSlug');
  return {
    id,
    name,
    stage: readStage(form),
    attribute: readAttribute(form),
    element: readElement(form),
    baseStats: { hp, en, atk, def, int, spd },
    skillPool: skillPool.filter(isSkill),
    assets: { portrait, dot },
    ...(wikimonSlug === undefined ? {} : { wikimonSlug }),
  };
}

function buildSkill(form: FormData, index: number): Skill | null {
  const name = readString(form, `skill_name_${index}`);
  const energyCost = readNumber(form, `skill_cost_${index}`);
  const power = readNumber(form, `skill_power_${index}`);
  if (!name || energyCost === null || power === null) return null;
  return { id: `s${index}`, name, element: readElement(form, `skill_el_${index}`), energyCost, power };
}

function readString(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(form: FormData, key: string): string | undefined {
  return readString(form, key) ?? undefined;
}

function readNumber(form: FormData, key: string): number | null {
  const value = readString(form, key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStage(form: FormData): Stage {
  const value = readString(form, 'stage');
  return STAGES.find((stage) => stage === value) ?? DEFAULT_STAGE;
}

function readAttribute(form: FormData): Attribute {
  const value = readString(form, 'attribute');
  return ATTRIBUTES.find((attribute) => attribute === value) ?? DEFAULT_ATTRIBUTE;
}

function readElement(form: FormData, key = 'element'): Element {
  const value = readString(form, key);
  return ELEMENTS.find((element) => element === value) ?? DEFAULT_ELEMENT;
}

function isSkill(skill: Skill | null): skill is Skill {
  return skill !== null;
}
