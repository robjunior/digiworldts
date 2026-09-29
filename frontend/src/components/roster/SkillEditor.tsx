import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { ATTRIBUTES, ELEMENTS, STAGES, type Attribute, type Element, type Stage } from '@digiworld/shared/digimon';
import { ApiError } from '../../lib/api';
import { getMonSkills, setMonSignature, setMonSkills, type CatalogSkillMeta, type LearnedSkillEntry } from '../../lib/api-roster';

type SkillEditorProps = {
  readonly monId: string;
};

type StageFilter = 'all' | Stage;
type ElementFilter = 'all' | Element;
type AttributeFilter = 'all' | Attribute;

type UnifiedRow = {
  readonly key: string;
  readonly name: string;
  readonly element: string;
  readonly stage: string | null;
  readonly attribute: string | null;
  readonly energyCost: number;
  readonly description: string | null;
};

const ROSTER_QUERY_KEY = ['roster'] as const;

function toUnifiedFromLearned(entry: LearnedSkillEntry): UnifiedRow {
  return {
    key: entry.key,
    name: entry.skill.name,
    element: entry.skill.element,
    stage: entry.sourceStage || null,
    attribute: entry.sourceAttribute || null,
    energyCost: entry.skill.energyCost,
    description: entry.skill.description ?? null,
  };
}

function toUnifiedFromCatalog(meta: CatalogSkillMeta): UnifiedRow {
  return {
    key: meta.id,
    name: meta.name,
    element: meta.element,
    stage: meta.stage ?? null,
    attribute: null,
    energyCost: meta.energyCost,
    description: meta.description,
  };
}

function equippedListFromSet(chosenKeys: ReadonlySet<string>, maxEquipped: number): string[] {
  return Array.from(chosenKeys).slice(0, maxEquipped);
}

const ATTRIBUTE_ABBR: Record<Attribute, string> = {
  Data: 'DAT',
  Vaccine: 'VAC',
  Virus: 'VIR',
  Free: 'FRE',
  Variable: 'VAR',
  Unknown: 'UNK',
  NoData: 'NOD',
};

const ELEMENT_ABBR: Record<Element, string> = {
  fire: 'FIR',
  water: 'WAT',
  plant: 'PLA',
  ice: 'ICE',
  electricity: 'ELE',
  earth: 'EAR',
  steel: 'STE',
  wind: 'WIN',
  light: 'LIG',
  dark: 'DAR',
  null: 'NUL',
};

export function SkillEditor({ monId }: SkillEditorProps): JSX.Element {
  const queryClient = useQueryClient();
  const skillsKey = useMemo(() => ['roster', monId, 'skills'] as const, [monId]);
  const query = useQuery({ queryKey: skillsKey, queryFn: () => getMonSkills(monId), retry: false });
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [message, setMessage] = useState<{ readonly tone: 'ok' | 'err'; readonly text: string } | null>(null);
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>('all');

  // Single active signature (one at a time). `undefined` = not initialised from the server yet.
  const [activeSignature, setActiveSignature] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (query.data && activeSignature === undefined) setActiveSignature(query.data.activeSignatureId);
  }, [query.data, activeSignature]);

  const signatureMutation = useMutation({
    mutationFn: (skillId: string | null) => setMonSignature(monId, skillId),
    onSuccess: (result) => {
      setActiveSignature(result.signatureSkillId);
      setMessage({ tone: 'ok', text: result.signatureSkillId ? 'Signature skill set.' : 'Signature cleared.' });
      void queryClient.invalidateQueries({ queryKey: skillsKey });
    },
    onError: (error: unknown) => {
      const text = error instanceof ApiError ? `${error.message} (${String(error.code ?? '')})` : error instanceof Error ? error.message : 'signature update failed';
      setMessage({ tone: 'err', text });
    },
  });

  useEffect(() => {
    if (query.data && chosen === null) {
      setChosen(new Set(query.data.equipped));
    }
  }, [query.data, chosen]);

  const mutation = useMutation({
    mutationFn: (keys: readonly string[]) => setMonSkills(monId, keys),
    onSuccess: (result) => {
      setMessage({ tone: 'ok', text: 'Skills saved.' });
      setChosen(new Set(result.equipped));
      void queryClient.invalidateQueries({ queryKey: skillsKey });
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const text = error instanceof ApiError ? `${error.message} (${String(error.code ?? '')})` : error instanceof Error ? error.message : 'save failed';
      setMessage({ tone: 'err', text });
      if (query.data) setChosen(new Set(query.data.equipped));
    },
  });

  if (query.isPending) return <div className="skill-editor is-loading">Loading skills…</div>;
  if (query.isError || !query.data) return <div className="skill-editor is-error">Could not load skills.</div>;

  const data = query.data;
  const chosenKeys = chosen ?? new Set(data.equipped);
  const maxEquipped = data.maxEquipped;

  const seen = new Set<string>();
  const unified: UnifiedRow[] = [];
  for (const entry of data.learnedSkills) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    unified.push(toUnifiedFromLearned(entry));
  }
  for (const meta of data.catalogPool) {
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    unified.push(toUnifiedFromCatalog(meta));
  }

  const filtered = unified.filter((row) => {
    if (stageFilter !== 'all' && row.stage !== stageFilter) return false;
    if (elementFilter !== 'all' && row.element !== elementFilter) return false;
    if (attributeFilter !== 'all' && row.attribute !== attributeFilter) return false;
    return true;
  });

  const equippedCount = chosenKeys.size;
  const hasAnyFilter = stageFilter !== 'all' || elementFilter !== 'all' || attributeFilter !== 'all';

  const toggle = (key: string): void => {
    setMessage(null);
    const next = new Set(chosenKeys);
    if (next.has(key)) {
      next.delete(key);
    } else if (next.size >= maxEquipped) {
      setMessage({ tone: 'err', text: `Slot full — unequip one first (${maxEquipped} max).` });
      return;
    } else {
      next.add(key);
    }
    setChosen(next);
    mutation.mutate(equippedListFromSet(next, maxEquipped));
  };

  const clearFilters = (): void => {
    setStageFilter('all');
    setElementFilter('all');
    setAttributeFilter('all');
  };

  return (
    <div className="skill-editor-simple">
      {/* Signature skill picker: exactly one active at a time, representing an element archetype. */}
      <div className="skl-signature">
        <div className="skl-hdr">
          <span className="skl-title">Signature Skill</span>
          <span className="skl-slots">one archetype · one slot</span>
        </div>
        {data.signatureOptions.length === 0 ? (
          <div className="skl-empty">This form owns no signature skills yet.</div>
        ) : (
          <div className="skl-sig-list" role="radiogroup" aria-label="Signature skill">
            <button
              type="button"
              role="radio"
              aria-checked={activeSignature === null}
              className={`skl-sigrow is-none${activeSignature === null ? ' is-active' : ''}`}
              onClick={() => signatureMutation.mutate(null)}
              disabled={signatureMutation.isPending}
            >
              <span className="skl-sig-name">None</span>
              <span className="skl-sig-arch">clears the selection</span>
              <span className="skl-sig-stage">—</span>
            </button>
            {data.signatureOptions.map((opt) => {
              const isActive = activeSignature === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`skl-sigrow${isActive ? ' is-active' : ''}${opt.archetypeValid ? '' : ' is-locked'}`}
                  onClick={() => signatureMutation.mutate(opt.id)}
                  disabled={signatureMutation.isPending || !opt.archetypeValid}
                  title={opt.description ?? opt.name}
                >
                  <span className="skl-sig-name">{opt.name}</span>
                  <span className="skl-sig-arch">{opt.archetype ?? (opt.archetypeValid ? '—' : 'not a valid archetype')}</span>
                  <span className="skl-sig-stage">{opt.stage}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="skl-hdr">
        <span className="skl-title">Skills — Equipped</span>
        <span className={`skl-slots${equippedCount >= maxEquipped ? ' is-full' : ''}`}>
          {equippedCount} / {maxEquipped} slots
        </span>
      </div>

      <div className="skl-filter-groups">
        <div className="skl-filter-row">
          <span className="skl-flabel">Stage</span>
          <div className="skl-fchips" role="tablist" aria-label="Filter by stage">
            <button
              type="button"
              className={`skl-fchip${stageFilter === 'all' ? ' is-on' : ''}`}
              onClick={() => setStageFilter('all')}
              aria-pressed={stageFilter === 'all'}
            >
              All
            </button>
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                className={`skl-fchip${stageFilter === s ? ' is-on' : ''}`}
                onClick={() => setStageFilter(s)}
                aria-pressed={stageFilter === s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="skl-filter-row">
          <span className="skl-flabel">Element</span>
          <div className="skl-fchips" role="tablist" aria-label="Filter by element">
            <button
              type="button"
              className={`skl-fchip${elementFilter === 'all' ? ' is-on' : ''}`}
              onClick={() => setElementFilter('all')}
              aria-pressed={elementFilter === 'all'}
            >
              All
            </button>
            {ELEMENTS.map((el) => (
              <button
                key={el}
                type="button"
                className={`skl-fchip skl-fchip--el${elementFilter === el ? ' is-on' : ''}`}
                onClick={() => setElementFilter(el)}
                aria-pressed={elementFilter === el}
                style={{ ['--el' as string]: `var(--el-${el})` }}
                title={el}
              >
                {ELEMENT_ABBR[el]}
              </button>
            ))}
          </div>
        </div>

        <div className="skl-filter-row">
          <span className="skl-flabel">Attribute</span>
          <div className="skl-fchips" role="tablist" aria-label="Filter by attribute">
            <button
              type="button"
              className={`skl-fchip${attributeFilter === 'all' ? ' is-on' : ''}`}
              onClick={() => setAttributeFilter('all')}
              aria-pressed={attributeFilter === 'all'}
            >
              All
            </button>
            {ATTRIBUTES.map((a) => (
              <button
                key={a}
                type="button"
                className={`skl-fchip${attributeFilter === a ? ' is-on' : ''}`}
                onClick={() => setAttributeFilter(a)}
                aria-pressed={attributeFilter === a}
                title={a}
              >
                {ATTRIBUTE_ABBR[a]}
              </button>
            ))}
          </div>
        </div>

        {hasAnyFilter ? (
          <button type="button" className="skl-clear" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {message !== null ? (
        <div className={`skl-msg is-${message.tone}`}>{message.text}</div>
      ) : null}

      <div className="skl-list" role="list">
        {filtered.length === 0 ? (
          <div className="skl-empty">No skills match this filter.</div>
        ) : (
          filtered.map((row) => {
            const isEquipped = chosenKeys.has(row.key);
            return (
              <button
                key={row.key}
                type="button"
                role="listitem"
                className={`skl-row${isEquipped ? ' is-equipped' : ''}`}
                onClick={() => toggle(row.key)}
                disabled={mutation.isPending}
                data-element={row.element}
                title={row.description ?? row.name}
              >
                <span className="skl-ic" style={{ ['--el' as string]: `var(--el-${row.element})` }} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <circle cx="12" cy="12" r="7" />
                  </svg>
                </span>
                <span className="skl-nm">
                  {row.name}
                  {isEquipped ? <span className="skl-badge">Equipped</span> : null}
                </span>
                <span className="skl-desc">{row.description ?? '—'}</span>
                <span className="skl-cost">EN {row.energyCost}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
