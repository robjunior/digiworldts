import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { createSkill, deleteSkill, getSkills, updateSkill, type SkillElement, type SkillInput, type SkillView } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const SKILLS_QUERY_KEY = ['admin', 'skills'] as const;
const SKILL_ELEMENTS: readonly SkillElement[] = ['fire', 'water', 'nature', 'electric', 'neutral'] as const;

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

  const initialActions = skill ? JSON.stringify(skill.actions, null, 2) : ACTIONS_TEMPLATE;
  const initialTags = skill && skill.tags ? JSON.stringify(skill.tags, null, 2) : TAGS_TEMPLATE;

  return (
    <AdminSection title={skill ? `Edit skill: ${skill.name}` : 'Create skill'} lede="Actions is the raw JSON array validated by the backend DSL (deal_damage / heal / apply_status / modify_stat / consume_en / restore_en / shift_initiative / schedule / conditional).">
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Name (2-48 chars)"><input className="input" name="name" defaultValue={skill?.name ?? ''} maxLength={48} required /></Field>
        <Field label="Description (optional)"><textarea className="input" name="description" defaultValue={skill?.description ?? ''} rows={2} maxLength={400} /></Field>
        <div className="row">
          <Field label="Element"><select className="input" name="element" defaultValue={skill?.element ?? 'neutral'}>{SKILL_ELEMENTS.map((element) => <option key={element} value={element}>{element}</option>)}</select></Field>
          <Field label="Energy cost"><input className="input" name="energyCost" type="number" min="0" max="200" defaultValue={skill?.energyCost ?? 12} required /></Field>
          <Field label="Cooldown"><input className="input" name="cooldown" type="number" min="0" max="10" defaultValue={skill?.cooldown ?? 0} /></Field>
        </div>
        <Field label="Animation key (optional)"><input className="input" name="animation" defaultValue={skill?.animation ?? ''} maxLength={80} placeholder="e.g. slash-arc, flame-orb" /></Field>
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
