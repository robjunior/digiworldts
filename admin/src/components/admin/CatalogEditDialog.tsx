import type { Attribute, Element, EvolveEdge, ResistanceMap, Skill, Stage, TemplateDigimon } from '@digiworld/shared/digimon';
import { ATTRIBUTES, ELEMENTS, STAGES } from '@digiworld/shared/digimon';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { ShopItemView, TemplateDraft } from '../../lib/api-admin';
import { Field } from './AdminShared';

const DEFAULT_STAGE: Stage = 'Rookie';
const DEFAULT_ATTRIBUTE: Attribute = 'Vaccine';
const DEFAULT_ELEMENT: Element = 'null';
const SKILL_COUNT = 4;

export type CatalogDialogMode = 'create' | 'edit';

type DraftState = {
  id: string;
  name: string;
  stage: Stage;
  attribute: Attribute;
  element: Element;
  type: string;
  wikimonSlug: string;
  sourceUrl: string;
  baseStats: { hp: number; en: number; atk: number; def: number; int: number; spd: number };
  assets: { portrait: string; dot: string };
  skills: Array<{ name: string; element: Element; energyCost: number; power: number }>;
  edges: EvolveEdge[];
};

function emptyDraft(): DraftState {
  return {
    id: '',
    name: '',
    stage: DEFAULT_STAGE,
    attribute: DEFAULT_ATTRIBUTE,
    element: DEFAULT_ELEMENT,
    type: '',
    wikimonSlug: '',
    sourceUrl: '',
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    assets: { portrait: '', dot: '' },
    skills: [
      { name: 'Basic Attack', element: DEFAULT_ELEMENT, energyCost: 0, power: 120 },
      { name: '', element: DEFAULT_ELEMENT, energyCost: 8, power: 180 },
      { name: '', element: DEFAULT_ELEMENT, energyCost: 8, power: 180 },
      { name: '', element: DEFAULT_ELEMENT, energyCost: 8, power: 180 },
    ],
    edges: [],
  };
}

function draftFromTemplate(template: TemplateDigimon): DraftState {
  const skills = [0, 1, 2, 3].map((idx) => {
    const s = template.skillPool[idx];
    return s
      ? { name: s.name, element: s.element, energyCost: s.energyCost, power: s.power }
      : { name: '', element: DEFAULT_ELEMENT, energyCost: 8, power: 180 };
  });
  return {
    id: template.id,
    name: template.name,
    stage: template.stage,
    attribute: template.attribute,
    element: template.element,
    type: template.type ?? '',
    wikimonSlug: template.wikimonSlug ?? '',
    sourceUrl: template.sourceUrl ?? '',
    baseStats: { ...template.baseStats },
    assets: { ...template.assets },
    skills,
    edges: (template.evolvesInto ?? []).map((e) => ({ ...e })),
  };
}

function draftToPayload(draft: DraftState, original?: TemplateDigimon): TemplateDraft | null {
  if (!draft.id.trim() || !draft.name.trim() || !draft.assets.portrait.trim() || !draft.assets.dot.trim()) return null;
  const skillPool: Skill[] = [];
  for (let i = 0; i < SKILL_COUNT; i += 1) {
    const s = draft.skills[i]!;
    if (!s.name.trim()) return null;
    const skill: Skill = {
      id: `s${i}`,
      name: s.name.trim(),
      element: s.element,
      energyCost: s.energyCost,
      power: s.power,
    };
    const originalSkill = original?.skillPool[i];
    if (originalSkill?.description !== undefined) skill.description = originalSkill.description;
    if (originalSkill?.effect !== undefined) skill.effect = originalSkill.effect;
    skillPool.push(skill);
  }
  const payload: TemplateDraft = {
    id: draft.id.trim(),
    name: draft.name.trim(),
    stage: draft.stage,
    attribute: draft.attribute,
    element: draft.element,
    baseStats: draft.baseStats,
    skillPool,
    assets: { portrait: draft.assets.portrait.trim(), dot: draft.assets.dot.trim() },
  };
  const typeStr = draft.type.trim();
  if (typeStr) (payload as { type?: string }).type = typeStr;
  const wiki = draft.wikimonSlug.trim();
  if (wiki) (payload as { wikimonSlug?: string }).wikimonSlug = wiki;
  const src = draft.sourceUrl.trim();
  if (src) (payload as { sourceUrl?: string }).sourceUrl = src;
  if (draft.edges.length > 0) {
    (payload as { evolvesInto?: readonly EvolveEdge[] }).evolvesInto = draft.edges.map((e) => {
      const edge: EvolveEdge = { targetId: e.targetId };
      if (e.requiredLevel !== undefined) edge.requiredLevel = e.requiredLevel;
      if (e.requiredMood !== undefined) edge.requiredMood = e.requiredMood;
      if (e.requiredAttribute !== undefined) edge.requiredAttribute = e.requiredAttribute;
      if (e.requiredItemId !== undefined) {
        edge.requiredItemId = e.requiredItemId;
        edge.requiredItemQty = Math.max(1, e.requiredItemQty ?? 1);
      }
      return edge;
    });
  }
  if (original?.resistances && Object.keys(original.resistances).length > 0) {
    (payload as { resistances?: ResistanceMap }).resistances = original.resistances;
  }
  return payload;
}

export function CatalogEditDialog({
  open,
  mode,
  initial,
  catalogList,
  shopItems,
  onClose,
  onSubmit,
}: {
  readonly open: boolean;
  readonly mode: CatalogDialogMode;
  readonly initial?: TemplateDigimon;
  readonly catalogList: readonly TemplateDigimon[];
  readonly shopItems: readonly ShopItemView[];
  readonly onClose: () => void;
  readonly onSubmit: (draft: TemplateDraft) => Promise<void>;
}): JSX.Element | null {
  const [draft, setDraft] = useState<DraftState>(() => (initial ? draftFromTemplate(initial) : emptyDraft()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setDraft(initial ? draftFromTemplate(initial) : emptyDraft());
  }, [open, initial]);

  const targetOptions = useMemo(
    () => [...catalogList].sort((a, b) => a.name.localeCompare(b.name)),
    [catalogList],
  );

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const payload = draftToPayload(draft, initial);
    if (payload === null) {
      setError('Fill id, name, portrait, dot, and every skill name.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'edit' ? `Edit ${initial?.name ?? 'template'}` : 'Custom catalog entry';
  const submitLabel = mode === 'edit' ? 'Save changes' : 'Create template';
  const resistanceCount = initial?.resistances ? Object.keys(initial.resistances).length : 0;

  return (
    <div className="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title">
      <div className="modal-card modal-card--wide">
        <div className="modal-header">
          <h3 id="catalog-dialog-title">{title}</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close catalog editor">×</button>
        </div>
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <section className="stack" aria-label="Identity">
            <div className="form-grid">
              <Field label="ID">
                <input
                  className="input"
                  name="id"
                  placeholder="skb-custom"
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  readOnly={mode === 'edit'}
                  required
                />
              </Field>
              <Field label="Name">
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
              </Field>
              <Field label="Stage">
                <Select value={draft.stage} values={STAGES} onChange={(v) => setDraft({ ...draft, stage: v })} />
              </Field>
              <Field label="Attribute">
                <Select value={draft.attribute} values={ATTRIBUTES} onChange={(v) => setDraft({ ...draft, attribute: v })} />
              </Field>
              <Field label="Element">
                <Select value={draft.element} values={ELEMENTS} onChange={(v) => setDraft({ ...draft, element: v })} />
              </Field>
              <Field label="Type (e.g. Reptile)">
                <input className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} />
              </Field>
              <Field label="Wikimon slug">
                <input className="input" value={draft.wikimonSlug} onChange={(e) => setDraft({ ...draft, wikimonSlug: e.target.value })} />
              </Field>
              <Field label="Source URL">
                <input className="input" value={draft.sourceUrl} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} />
              </Field>
              <Field label="Portrait">
                <input className="input" value={draft.assets.portrait} onChange={(e) => setDraft({ ...draft, assets: { ...draft.assets, portrait: e.target.value } })} required />
              </Field>
              <Field label="Dot">
                <input className="input" value={draft.assets.dot} onChange={(e) => setDraft({ ...draft, assets: { ...draft.assets, dot: e.target.value } })} required />
              </Field>
            </div>
            {resistanceCount > 0 ? (
              <p className="muted">
                {resistanceCount} custom resistance override{resistanceCount === 1 ? '' : 's'} preserved from XML (not editable here yet).
              </p>
            ) : null}
          </section>

          <section className="stack" aria-label="Base stats">
            <h4 className="caps">Stats</h4>
            <div className="form-grid">
              {(['hp', 'en', 'atk', 'def', 'int', 'spd'] as const).map((k) => (
                <Field key={k} label={k.toUpperCase()}>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={draft.baseStats[k]}
                    onChange={(e) => setDraft({ ...draft, baseStats: { ...draft.baseStats, [k]: Number(e.target.value) || 0 } })}
                    required
                  />
                </Field>
              ))}
            </div>
          </section>

          <section className="stack" aria-label="Skills">
            <h4 className="caps">Skills <span className="muted">(description + effect preserved on save)</span></h4>
            <div className="skill-editor">
              {draft.skills.map((skill, index) => (
                <div key={index} className="skill-editor-row">
                  <span className="caps">Skill {index + 1}</span>
                  <div className="row">
                    <Field label="Name">
                      <input
                        className="input"
                        value={skill.name}
                        onChange={(e) => {
                          const next = draft.skills.slice();
                          next[index] = { ...skill, name: e.target.value };
                          setDraft({ ...draft, skills: next });
                        }}
                        required
                      />
                    </Field>
                    <Field label="Element">
                      <Select
                        value={skill.element}
                        values={ELEMENTS}
                        onChange={(v) => {
                          const next = draft.skills.slice();
                          next[index] = { ...skill, element: v };
                          setDraft({ ...draft, skills: next });
                        }}
                      />
                    </Field>
                    <Field label="Cost">
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={skill.energyCost}
                        onChange={(e) => {
                          const next = draft.skills.slice();
                          next[index] = { ...skill, energyCost: Number(e.target.value) || 0 };
                          setDraft({ ...draft, skills: next });
                        }}
                        required
                      />
                    </Field>
                    <Field label="Power">
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={skill.power}
                        onChange={(e) => {
                          const next = draft.skills.slice();
                          next[index] = { ...skill, power: Number(e.target.value) || 0 };
                          setDraft({ ...draft, skills: next });
                        }}
                        required
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="stack" aria-label="Evolutions">
            <div className="row spread">
              <h4 className="caps">Evolutions <span className="muted">({draft.edges.length})</span></h4>
              <button
                className="btn btn--secondary btn--sm"
                type="button"
                onClick={() => {
                  const first = targetOptions.find((t) => !draft.edges.some((e) => e.targetId === t.id));
                  if (!first) return;
                  setDraft({ ...draft, edges: [...draft.edges, { targetId: first.id }] });
                }}
                disabled={targetOptions.length === 0}
              >
                + Add edge
              </button>
            </div>
            <p className="muted evolve-note">
              Items are shared definitions — the same item can gate any number of evolutions across the catalog. Only <b>one player-owned copy</b> is consumed per evolution action (using the qty on the specific edge the player triggers).
            </p>
            {draft.edges.length === 0 ? (
              <p className="muted">No evolutions configured. Click <b>+ Add edge</b> to link a target.</p>
            ) : (
              <ul className="evolve-edges" aria-label="Evolution edges">
                {draft.edges.map((edge, idx) => (
                  <li key={idx} className="evolve-edge-row">
                    <EdgeEditor
                      edge={edge}
                      catalog={targetOptions}
                      shopItems={shopItems}
                      onChange={(next) => {
                        const list = draft.edges.slice();
                        list[idx] = next;
                        setDraft({ ...draft, edges: list });
                      }}
                      onRemove={() => setDraft({ ...draft, edges: draft.edges.filter((_, i) => i !== idx) })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {error ? <p className="auth-error">{error}</p> : null}
          <div className="row spread">
            <button className="btn btn--secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EdgeEditor({
  edge,
  catalog,
  shopItems,
  onChange,
  onRemove,
}: {
  readonly edge: EvolveEdge;
  readonly catalog: readonly TemplateDigimon[];
  readonly shopItems: readonly ShopItemView[];
  readonly onChange: (next: EvolveEdge) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const targetTpl = catalog.find((t) => t.id === edge.targetId);
  const itemOptions = useMemo(
    () => [...shopItems].filter((i) => i.enabled !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [shopItems],
  );
  const selectedItem = edge.requiredItemId !== undefined ? shopItems.find((i) => i.id === edge.requiredItemId) : undefined;

  const buildEdge = (overrides: {
    targetId?: string;
    requiredLevel?: number | null;
    requiredMood?: number | null;
    requiredAttribute?: Attribute | null;
    requiredItemId?: string | null;
    requiredItemQty?: number | null;
  }): EvolveEdge => {
    const merged: EvolveEdge = { targetId: overrides.targetId ?? edge.targetId };
    const level = 'requiredLevel' in overrides ? overrides.requiredLevel : edge.requiredLevel;
    if (level !== null && level !== undefined) merged.requiredLevel = level;
    const mood = 'requiredMood' in overrides ? overrides.requiredMood : edge.requiredMood;
    if (mood !== null && mood !== undefined) merged.requiredMood = mood;
    const attr = 'requiredAttribute' in overrides ? overrides.requiredAttribute : edge.requiredAttribute;
    if (attr !== null && attr !== undefined) merged.requiredAttribute = attr;
    const itemId = 'requiredItemId' in overrides ? overrides.requiredItemId : edge.requiredItemId;
    if (itemId !== null && itemId !== undefined && itemId !== '') {
      merged.requiredItemId = itemId;
      const qty = 'requiredItemQty' in overrides ? overrides.requiredItemQty : edge.requiredItemQty;
      merged.requiredItemQty = Math.max(1, qty ?? edge.requiredItemQty ?? 1);
    }
    return merged;
  };

  return (
    <div className="evolve-edge">
      <div className="row">
        <Field label="Target">
          <select
            className="input"
            value={edge.targetId}
            onChange={(e) => onChange(buildEdge({ targetId: e.target.value }))}
          >
            {catalog.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.stage}) — {t.id}</option>
            ))}
          </select>
        </Field>
        <span className="muted evolve-edge-target">
          {targetTpl ? <>→ <b>{targetTpl.name}</b> · {targetTpl.stage} · {targetTpl.attribute}</> : <em>unknown target</em>}
        </span>
        <button className="btn btn--danger btn--sm" type="button" onClick={onRemove} aria-label={`Remove edge to ${targetTpl?.name ?? edge.targetId}`}>✕</button>
      </div>
      <div className="row">
        <Field label="Min level">
          <input
            className="input"
            type="number"
            min="0"
            value={edge.requiredLevel ?? ''}
            placeholder="stage default"
            onChange={(e) => onChange(buildEdge({ requiredLevel: e.target.value === '' ? null : Number(e.target.value) }))}
          />
        </Field>
        <Field label="Min mood">
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            value={edge.requiredMood ?? ''}
            placeholder="stage default"
            onChange={(e) => onChange(buildEdge({ requiredMood: e.target.value === '' ? null : Number(e.target.value) }))}
          />
        </Field>
        <Field label="Attribute">
          <select
            className="input"
            value={edge.requiredAttribute ?? ''}
            onChange={(e) => onChange(buildEdge({ requiredAttribute: e.target.value === '' ? null : (e.target.value as Attribute) }))}
          >
            <option value="">any</option>
            {ATTRIBUTES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
      </div>
      <div className="row evolve-edge-item-row">
        <Field label="Required item">
          <select
            className="input"
            value={edge.requiredItemId ?? ''}
            onChange={(e) => onChange(buildEdge({ requiredItemId: e.target.value === '' ? null : e.target.value }))}
          >
            <option value="">none</option>
            {itemOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.kind}{item.priceCredits > 0 ? ` · ${item.priceCredits}c` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Qty">
          <input
            className="input"
            type="number"
            min="1"
            max="999"
            value={edge.requiredItemQty ?? ''}
            placeholder={edge.requiredItemId !== undefined ? '1' : '—'}
            disabled={edge.requiredItemId === undefined}
            onChange={(e) => onChange(buildEdge({ requiredItemQty: e.target.value === '' ? null : Number(e.target.value) }))}
          />
        </Field>
        {selectedItem !== undefined ? (
          <span className="muted evolve-edge-item-hint">
            Consumes {edge.requiredItemQty ?? 1} × <b>{selectedItem.name}</b> from the player's inventory when this edge fires.
          </span>
        ) : (
          <span className="muted evolve-edge-item-hint">Leave empty for no item cost.</span>
        )}
      </div>
    </div>
  );
}

function Select<T extends string>({
  value,
  values,
  onChange,
}: {
  readonly value: T;
  readonly values: readonly T[];
  readonly onChange: (v: T) => void;
}): JSX.Element {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {values.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}
