import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';

import { ELEMENTS } from '@digiworld/shared/digimon';
import { SKILL_VFX_MELEE_EFFECTS, SKILL_VFX_RANGED_EFFECTS } from '@digiworld/shared/skill-vfx';
import { useLocale } from '../../hooks/useLocale';
import { localizedName, localizedDescription } from '../../lib/locale';
import { createSkill, deleteSkill, getCatalogSkills, getSkills, updateSkill, type SkillElement, type SkillInput, type SkillView, type CatalogSkillMeta } from '../../lib/api-admin';
import { getSkillVfxPresets } from '../../lib/api-skill-vfx-presets';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const SKILLS_QUERY_KEY = ['admin', 'skills'] as const;
const VFX_PRESETS_QUERY_KEY = ['admin', 'skill-vfx-presets'] as const;
const SKILL_ELEMENTS: readonly SkillElement[] = ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'] as const;

const ACTIONS_TEMPLATE = JSON.stringify(
  [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 120, scale: 'atk', factor: 1.2 } }],
  null,
  2,
);
const TAGS_TEMPLATE = JSON.stringify([], null, 2);

export function SkillsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SkillView | null>(null);
  const skillsQuery = useQuery({ queryKey: SKILLS_QUERY_KEY, queryFn: getSkills });
  const createMutation = useMutation({ mutationFn: createSkill, onSuccess: () => queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY }) });
  const updateMutation = useMutation({ mutationFn: ({ id, input }: { readonly id: string; readonly input: SkillInput }) => updateSkill(id, input), onSuccess: () => queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY }) });
  const deleteMutation = useMutation({ mutationFn: deleteSkill, onSuccess: () => queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY }) });
  const skills = skillsQuery.data?.skills ?? [];

  const submit = async (input: SkillInput): Promise<void> => {
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, input });
    } else {
      await createMutation.mutateAsync(input);
    }
    setEditing(null);
  };

  const remove = (id: string, name: string): void => {
    if (!window.confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
    void deleteMutation.mutate(id);
  };

  return (
    <div className="stack" style={{ gap: '32px' }}>
      <div className="admin-two-column">
        <AdminSection title={`Skills (${skills.length})`} lede="Skill DSL: name/element/EN cost/cooldown + a JSON actions array + optional tags. Delete removes the row and un-equips it from any mon that referenced it.">
          <ErrorText error={skillsQuery.error ?? createMutation.error ?? updateMutation.error ?? deleteMutation.error} />
          <div className="admin-scroll">
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Element</th><th>EN</th><th>Actions</th><th>Enabled</th><th></th></tr></thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.id}>
                    <td>
                      <b>{skill.name}</b>
                      {skill.description ? <><br /><span className="muted">{skill.description}</span></> : null}
                    </td>
                    <td><span className="badge">{skill.element}</span></td>
                    <td>{skill.energyCost}</td>
                    <td className="muted">{skill.actions.length} action{skill.actions.length === 1 ? '' : 's'}{typeof skill.cooldown === 'number' && skill.cooldown > 0 ? ` · cd ${skill.cooldown}` : ''}</td>
                    <td>{skill.enabled === false ? 'no' : 'yes'}</td>
                    <td className="admin-actions-cell">
                      <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditing(skill)}>Edit</button>
                      <button className="btn btn--danger btn--sm" type="button" onClick={() => remove(skill.id, skill.name)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {skillsQuery.isPending ? <AdminMessage tone="muted">Loading skills…</AdminMessage> : null}
          {!skillsQuery.isPending && skills.length === 0 ? <AdminMessage tone="muted">No skills yet — create the first one on the right.</AdminMessage> : null}
        </AdminSection>
        <SkillForm
          key={editing?.id ?? 'new'}
          skill={editing}
          busy={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={submit}
        />
      </div>
      <CatalogSkillsViewer />
    </div>
  );
}

function SkillForm({ skill, busy, onCancel, onSubmit }: { readonly skill: SkillView | null; readonly busy: boolean; readonly onCancel: () => void; readonly onSubmit: (input: SkillInput) => Promise<void> }): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const build = buildInput(new FormData(event.currentTarget));
    if ('error' in build) {
      setError(build.error);
      return;
    }
    setError(null);
    try {
      await onSubmit(build.input);
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const vfxPresetsQuery = useQuery({
    queryKey: VFX_PRESETS_QUERY_KEY,
    queryFn: () => getSkillVfxPresets(),
    staleTime: 60_000,
  });
  const vfxPresets = vfxPresetsQuery.data ?? [];

  const initialActions = skill ? JSON.stringify(skill.actions, null, 2) : ACTIONS_TEMPLATE;
  const initialTags = skill && skill.tags ? JSON.stringify(skill.tags, null, 2) : TAGS_TEMPLATE;

  return (
    <AdminSection title={skill ? `Edit skill: ${skill.name}` : 'Create skill'} lede="Actions is the raw JSON array validated by the backend DSL (deal_damage / heal / apply_status / modify_stat / consume_en / restore_en / shift_initiative / schedule / conditional).">
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Name (2-48 chars)"><input className="input" name="name" defaultValue={skill?.name ?? ''} maxLength={48} required /></Field>
        <Field label="Description (optional)"><textarea className="input" name="description" defaultValue={skill?.description ?? ''} rows={2} maxLength={400} /></Field>
        <div className="row">
          <Field label="Element"><select className="input" name="element" defaultValue={skill?.element ?? 'null'}>{SKILL_ELEMENTS.map((element) => <option key={element} value={element}>{element}</option>)}</select></Field>
          <Field label="Energy cost"><input className="input" name="energyCost" type="number" min="0" max="200" defaultValue={skill?.energyCost ?? 12} required /></Field>
          <Field label="Cooldown"><input className="input" name="cooldown" type="number" min="0" max="10" defaultValue={skill?.cooldown ?? 0} /></Field>
        </div>
        <Field label="Animation key (optional)"><input className="input" name="animation" defaultValue={skill?.animation ?? ''} maxLength={80} placeholder="e.g. slash-arc, flame-orb" /></Field>
        <Field label="Visual effect (optional)">
          <select className="input" name="vfxPresetId" defaultValue={skill?.vfxPresetId ?? ''}>
            <option value="">Element default ({skill?.element ?? 'element'} runner)</option>
            <optgroup label="Ranged skill effects">
              {SKILL_VFX_RANGED_EFFECTS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </optgroup>
            <optgroup label="Melee basic-attack effects">
              {SKILL_VFX_MELEE_EFFECTS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </optgroup>
            <optgroup label="Editor presets">
              {vfxPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}{preset.element ? ` — ${preset.element}` : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="admin-hint">
            Plays from the attacking Digimon onto each unit the skill hits. Leave on
            “Element default” to keep the built-in per-element effect — or pick a
            named code effect (ranged = the reference skill FX; melee = the dash +
            slash basic-attack FX). Editor presets are particle-based and tunable in
            the Skill VFX editor.
          </p>
        </Field>
        <Field label="Actions JSON (array, 1-20 items)"><textarea className="input mono" name="actions" rows={12} defaultValue={initialActions} spellCheck={false} required /></Field>
        <Field label="Tags JSON (optional string array)"><textarea className="input mono" name="tags" rows={3} defaultValue={initialTags} spellCheck={false} /></Field>
        <label className="admin-checkbox"><input type="checkbox" name="enabled" defaultChecked={skill?.enabled !== false} /> Enabled</label>
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="row spread">
          <button className="btn btn--secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn" type="submit" disabled={busy}>{skill ? 'Save skill' : 'Create skill'}</button>
        </div>
      </form>
    </AdminSection>
  );
}

const CATALOG_STAGES = ['Rookie', 'Champion', 'Ultimate', 'Mega'] as const;
const SLOT_ROLES = ['primary_attack', 'sustain_dot', 'control', 'buff_support', 'utility', 'identity_finisher'] as const;

function CatalogSkillsViewer(): JSX.Element {
  const locale = useLocale();
  const query = useQuery({ queryKey: ['admin', 'skills-catalog'], queryFn: getCatalogSkills });
  const [searchTerm, setSearchTerm] = useState('');
  const [elementFilter, setElementFilter] = useState<'all' | (typeof ELEMENTS)[number]>('all');
  const [stageFilter, setStageFilter] = useState<'all' | (typeof CATALOG_STAGES)[number]>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | (typeof SLOT_ROLES)[number]>('all');
  const [tier2Only, setTier2Only] = useState(false);
  const [open, setOpen] = useState(false);

  const [hoveredChainTarget, setHoveredChainTarget] = useState<string | null>(null);

  const skills = query.data?.skills ?? [];

  const visible = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return skills.filter((sk) => {
      if (elementFilter !== 'all' && sk.element !== elementFilter) return false;
      if (stageFilter !== 'all' && sk.stage !== stageFilter) return false;
      if (roleFilter !== 'all' && sk.slot_role !== roleFilter) return false;
      if (tier2Only && !sk.tier_2) return false;
      if (q.length > 0 && !sk.name.toLowerCase().includes(q) && !sk.name_pt.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, searchTerm, elementFilter, stageFilter, roleFilter, tier2Only]);

  const countByElement = useMemo(() => {
    const map = new Map<string, number>();
    for (const sk of skills) map.set(sk.element, (map.get(sk.element) ?? 0) + 1);
    return map;
  }, [skills]);

  const countByStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const sk of skills) map.set(sk.stage, (map.get(sk.stage) ?? 0) + 1);
    return map;
  }, [skills]);

  const buildChainString = (skillId: string): string => {
    const chain: CatalogSkillMeta[] = [];
    let current: CatalogSkillMeta | undefined = skills.find((s) => s.id === skillId);
    while (current) {
      chain.unshift(current);
      if (!current.upgrade_of) break;
      const prevId = current.upgrade_of;
      current = skills.find((s) => s.id === prevId);
    }
    return chain.map((sk) => sk.id === skillId ? `${sk.name} (this)` : sk.name).join(' → ');
  };

  if (!open) {
    return (
      <AdminSection title={`Skills Catalog (v2, ${skills.length} seeded)`}>
        <div style={{ paddingBottom: '16px' }}>
          <button className="btn btn--secondary" type="button" onClick={() => setOpen(true)}>Expand read-only catalog</button>
        </div>
      </AdminSection>
    );
  }

  return (
    <AdminSection title={`Skills Catalog (v2, ${skills.length} seeded)`} actions={<button className="btn btn--sm btn--secondary" onClick={() => setOpen(false)}>Collapse</button>}>
      <ErrorText error={query.error} />
      
      <div className="stack" style={{ marginBottom: '24px' }}>
        <div className="row">
          <Field label="Search by name">
            <input className="input" type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Type name..." />
          </Field>
          <div className="field">
            <label className="admin-checkbox" style={{ marginTop: '24px' }}>
              <input type="checkbox" checked={tier2Only} onChange={(e) => setTier2Only(e.target.checked)} /> Tier 2 only
            </label>
          </div>
        </div>

        <div className="skill-filters">
          <div className="skill-filter" role="tablist">
            <span className="skill-filter-label">Stage</span>
            <button type="button" role="tab" className={`skill-filter-btn ${stageFilter === 'all' ? 'is-active' : ''}`} onClick={() => setStageFilter('all')}>All <span className="filter-count">{skills.length}</span></button>
            {CATALOG_STAGES.map((s) => (
              <button key={s} type="button" role="tab" className={`skill-filter-btn ${stageFilter === s ? 'is-active' : ''}`} onClick={() => setStageFilter(s)}>
                {s} <span className="filter-count">{countByStage.get(s) ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="skill-filter" role="tablist">
            <span className="skill-filter-label">Element</span>
            <button type="button" role="tab" className={`skill-filter-btn ${elementFilter === 'all' ? 'is-active' : ''}`} onClick={() => setElementFilter('all')}>All</button>
            {ELEMENTS.map((el) => (
              <button key={el} type="button" role="tab" className={`skill-filter-btn ${elementFilter === el ? 'is-active' : ''}`} onClick={() => setElementFilter(el)}>
                {el} <span className="filter-count">{countByElement.get(el) ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="skill-filter" role="tablist">
            <span className="skill-filter-label">Role</span>
            <button type="button" role="tab" className={`skill-filter-btn ${roleFilter === 'all' ? 'is-active' : ''}`} onClick={() => setRoleFilter('all')}>All</button>
            {SLOT_ROLES.map((r) => (
              <button key={r} type="button" role="tab" className={`skill-filter-btn ${roleFilter === r ? 'is-active' : ''}`} onClick={() => setRoleFilter(r)}>
                {r.split('_').map(w => w.toUpperCase()).join(' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {query.isPending ? <AdminMessage tone="muted">Loading catalog…</AdminMessage> : null}
      
      {!query.isPending && (
        <div className="skill-grid">
          {visible.map((entry) => {
            const locName = localizedName(entry, locale);
            const locDesc = localizedDescription(entry, locale);
            const subName = locale === 'en' ? entry.name_pt : entry.name;
            const chainStr = (entry.upgrade_of && hoveredChainTarget === entry.id) ? buildChainString(entry.id) : null;

            return (
              <div key={entry.id} className="skill-chip catalog-skill-card" data-element={entry.element}>
                <span className="chip-head">
                  <span className="chip-name">
                    {locName}
                    {entry.tier_2 ? <span className="tier-2-badge" title="Tier 2">★</span> : null}
                  </span>
                  {entry.slot_role ? (
                    <span className="catalog-badge">
                      {entry.slot_role === 'primary_attack' ? 'PRIMARY' : 
                       entry.slot_role === 'sustain_dot' ? 'SUSTAIN' : 
                       entry.slot_role === 'control' ? 'CONTROL' : 
                       entry.slot_role === 'buff_support' ? 'BUFF' : 
                       entry.slot_role === 'utility' ? 'UTILITY' : 
                       entry.slot_role === 'identity_finisher' ? 'FINISHER' : 
                       entry.slot_role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </span>
                  ) : null}
                </span>
                <span className="chip-name-pt" style={{ fontStyle: 'italic', fontSize: '11px', color: 'var(--muted)', marginTop: '-2px', marginBottom: '2px', display: 'block' }}>{subName}</span>
                <span className="chip-meta">
                  <span className="chip-el" style={{ color: `var(--el-${entry.element})` }}>{entry.element}</span>
                  <span className="chip-from">{entry.stage}</span>
                  <span className="chip-en">EN {entry.energyCost}</span>
                  {entry.cooldown > 0 ? <span className="chip-en">CD {entry.cooldown}</span> : null}
                </span>
                {locDesc ? <span className="chip-desc" style={{ marginTop: '4px' }}>{locDesc.length > 80 ? locDesc.slice(0, 80) + '...' : locDesc}</span> : null}
                {entry.upgrade_of ? (
                  <span 
                    className="chip-chain-hint" 
                    style={{ fontSize: '10px', color: 'var(--ink)', background: 'color-mix(in oklab, var(--hairline) 30%, transparent)', padding: '2px 4px', borderRadius: '4px', marginTop: '4px', cursor: 'help', display: 'inline-block' }}
                    onMouseEnter={() => setHoveredChainTarget(entry.id)}
                    onMouseLeave={() => setHoveredChainTarget(null)}
                  >
                    {chainStr ? chainStr : '↰ upgrades'}
                  </span>
                ) : null}
              </div>
            );
          })}
          {visible.length === 0 ? <div className="muted">No skills match filters.</div> : null}
        </div>
      )}
    </AdminSection>
  );
}

type BuildResult = { readonly input: SkillInput } | { readonly error: string };

function buildInput(form: FormData): BuildResult {
  const name = readTrimmed(form, 'name');
  if (name === null || name.length < 2) return { error: 'Name must be at least 2 characters.' };
  const element = readTrimmed(form, 'element');
  if (element === null || !isSkillElement(element)) return { error: 'Element is required.' };
  const energyCost = readNumber(form, 'energyCost');
  if (energyCost === null) return { error: 'Energy cost must be a number.' };
  const cooldownRaw = readTrimmed(form, 'cooldown');
  const cooldown = cooldownRaw === null || cooldownRaw === '' ? 0 : Number(cooldownRaw);
  if (!Number.isFinite(cooldown)) return { error: 'Cooldown must be a number.' };
  const description = readTrimmed(form, 'description') ?? undefined;
  const animationRaw = readTrimmed(form, 'animation');
  const animation = animationRaw && animationRaw.length > 0 ? animationRaw : undefined;
  // Empty means "element default": omit the field entirely rather than sending
  // an empty string, which the backend schema would reject as too short.
  const vfxPresetRaw = readTrimmed(form, 'vfxPresetId');
  const vfxPresetId = vfxPresetRaw && vfxPresetRaw.length > 0 ? vfxPresetRaw : undefined;
  const actionsRaw = readTrimmed(form, 'actions') ?? '';
  if (actionsRaw.length === 0) return { error: 'Actions JSON is required.' };
  const actions = parseJsonArray(actionsRaw);
  if (actions === null) return { error: 'Actions JSON must be a JSON array of objects.' };
  if (actions.length < 1) return { error: 'Actions array must contain at least 1 action.' };
  const tagsRaw = readTrimmed(form, 'tags') ?? '';
  let tags: readonly string[] | undefined;
  if (tagsRaw.length > 0) {
    const parsedTags = parseStringArray(tagsRaw);
    if (parsedTags === null) return { error: 'Tags JSON must be a JSON array of strings.' };
    tags = parsedTags;
  }
  const input: SkillInput = {
    name,
    element,
    energyCost,
    cooldown,
    actions,
    enabled: form.get('enabled') === 'on',
  };
  if (description !== undefined && description.length > 0) (input as Writable<SkillInput>).description = description;
  if (animation !== undefined) (input as Writable<SkillInput>).animation = animation;
  if (vfxPresetId !== undefined) (input as Writable<SkillInput>).vfxPresetId = vfxPresetId;
  if (tags !== undefined) (input as Writable<SkillInput>).tags = tags;
  return { input };
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

function parseJsonArray(text: string): readonly Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.every(isRecord) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

function parseStringArray(text: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.every((value) => typeof value === 'string') ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSkillElement(value: string): value is SkillElement {
  return (SKILL_ELEMENTS as readonly string[]).includes(value);
}

function readTrimmed(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== 'string') return null;
  return value.trim();
}

function readNumber(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
