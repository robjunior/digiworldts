import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { ATTRIBUTES, ELEMENTS, STAGES } from '@digiworld/shared/digimon';

import { ApiError } from '../../lib/api';
import { isCatalogSkillId, getMonSkills, setMonSkills } from '../../lib/api-roster';
import { type EquippedSlotContent, SkillSlotBox } from './SkillSlotBox';

type SkillEditorProps = {
  readonly monId: string;
};

const ROSTER_QUERY_KEY = ['roster'] as const;
const DND_MIME = 'application/x-digiworld-skill';
type StageFilter = 'all' | (typeof STAGES)[number];
type ElementFilter = 'all' | (typeof ELEMENTS)[number];
type AttributeFilter = 'all' | (typeof ATTRIBUTES)[number];

function padSlots(equipped: readonly string[], max: number): (string | null)[] {
  const slots: (string | null)[] = new Array(max).fill(null);
  for (let i = 0; i < Math.min(equipped.length, max); i++) {
    slots[i] = equipped[i] ?? null;
  }
  return slots;
}

function slotsEqual(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function SkillEditor({ monId }: SkillEditorProps): JSX.Element {
  const queryClient = useQueryClient();
  const skillsKey = useMemo(() => ['roster', monId, 'skills'] as const, [monId]);
  const query = useQuery({ queryKey: skillsKey, queryFn: () => getMonSkills(monId), retry: false });
  const [slots, setSlots] = useState<(string | null)[] | null>(null);
  const [message, setMessage] = useState<{ readonly tone: 'ok' | 'err'; readonly text: string } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [poolDragOver, setPoolDragOver] = useState(false);
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>('all');
  const [catalogStageFilter, setCatalogStageFilter] = useState<StageFilter>('all');
  const draggingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (query.data && slots === null) {
      setSlots(padSlots(query.data.equipped, query.data.maxEquipped));
    }
  }, [query.data, slots]);

  const mutation = useMutation({
    mutationFn: (keys: readonly string[]) => setMonSkills(monId, keys),
    onSuccess: (result) => {
      setMessage({ tone: 'ok', text: 'Skills saved.' });
      setSlots(padSlots(result.equipped, query.data?.maxEquipped ?? 4));
      void queryClient.invalidateQueries({ queryKey: skillsKey });
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const text = error instanceof ApiError ? `${error.message} (${String(error.code ?? '')})` : error instanceof Error ? error.message : 'save failed';
      setMessage({ tone: 'err', text });
    },
  });

  if (query.isPending) return <div className="skill-editor is-loading">Loading skills…</div>;
  if (query.isError || !query.data) return <div className="skill-editor is-error">Could not load skills.</div>;

  const data = query.data;
  const currentSlots = slots ?? padSlots(data.equipped, data.maxEquipped);
  const chosenKeys = new Set(currentSlots.filter((k): k is string => k !== null));
  const skillByKey = new Map(data.learnedSkills.map((e) => [e.key, e] as const));
  const catalogSkillById = new Map(data.catalogPool.map((e) => [e.id, e] as const));
  const equippedFromLoad = padSlots(data.equipped, data.maxEquipped);
  const dirty = !slotsEqual(currentSlots, equippedFromLoad);
  const canSave = dirty && chosenKeys.size > 0 && chosenKeys.size <= data.maxEquipped;

  const countByStage = new Map<string, number>();
  const countByElement = new Map<string, number>();
  const countByAttribute = new Map<string, number>();
  for (const entry of data.learnedSkills) {
    countByStage.set(entry.sourceStage, (countByStage.get(entry.sourceStage) ?? 0) + 1);
    countByElement.set(entry.skill.element, (countByElement.get(entry.skill.element) ?? 0) + 1);
    countByAttribute.set(entry.sourceAttribute, (countByAttribute.get(entry.sourceAttribute) ?? 0) + 1);
  }
  const availableStages = STAGES.filter((s) => countByStage.has(s));
  const availableElements = ELEMENTS.filter((e) => countByElement.has(e));
  const availableAttributes = ATTRIBUTES.filter((a) => countByAttribute.has(a));
  const activeStageFilter: StageFilter = stageFilter !== 'all' && !countByStage.has(stageFilter) ? 'all' : stageFilter;
  const activeElementFilter: ElementFilter = elementFilter !== 'all' && !countByElement.has(elementFilter) ? 'all' : elementFilter;
  const activeAttributeFilter: AttributeFilter = attributeFilter !== 'all' && !countByAttribute.has(attributeFilter) ? 'all' : attributeFilter;
  const visibleEntries = data.learnedSkills.filter((e) => {
    if (activeStageFilter !== 'all' && e.sourceStage !== activeStageFilter) return false;
    if (activeElementFilter !== 'all' && e.skill.element !== activeElementFilter) return false;
    if (activeAttributeFilter !== 'all' && e.sourceAttribute !== activeAttributeFilter) return false;
    return true;
  });
  const anyFilterActive =
    activeStageFilter !== 'all' || activeElementFilter !== 'all' || activeAttributeFilter !== 'all';

  const catalogCountByStage = new Map<string, number>();
  for (const entry of data.catalogPool) {
    catalogCountByStage.set(entry.stage, (catalogCountByStage.get(entry.stage) ?? 0) + 1);
  }
  const catalogAvailableStages = STAGES.filter((s) => catalogCountByStage.has(s));
  const activeCatalogStageFilter: StageFilter = catalogStageFilter !== 'all' && !catalogCountByStage.has(catalogStageFilter) ? 'all' : catalogStageFilter;
  const visibleCatalogEntries = data.catalogPool.filter((e) => {
    if (activeCatalogStageFilter !== 'all' && e.stage !== activeCatalogStageFilter) return false;
    return true;
  });

  const mapSlotContent = (key: string | null): EquippedSlotContent | null => {
    if (key === null) return null;
    if (isCatalogSkillId(key)) {
      const meta = catalogSkillById.get(key);
      return meta ? { kind: 'catalog', meta } : null;
    } else {
      const entry = skillByKey.get(key);
      return entry ? { kind: 'wikimon', entry } : null;
    }
  };

  const equipToFirstFree = (key: string): void => {
    setMessage(null);
    const next = currentSlots.slice();
    const existingIndex = next.indexOf(key);
    if (existingIndex >= 0) {
      next[existingIndex] = null;
      setSlots(next);
      return;
    }
    const emptyIndex = next.indexOf(null);
    if (emptyIndex >= 0) {
      next[emptyIndex] = key;
    } else {
      next[next.length - 1] = key;
    }
    setSlots(next);
  };

  const placeInSlot = (key: string, slotIndex: number): void => {
    setMessage(null);
    const next = currentSlots.slice();
    const existingIndex = next.indexOf(key);
    if (existingIndex === slotIndex) return;
    if (existingIndex >= 0) {
      next[existingIndex] = next[slotIndex] ?? null;
    }
    next[slotIndex] = key;
    setSlots(next);
  };

  const clearSlot = (slotIndex: number): void => {
    setMessage(null);
    const next = currentSlots.slice();
    next[slotIndex] = null;
    setSlots(next);
  };

  const reset = (): void => {
    setMessage(null);
    setSlots(padSlots(data.equipped, data.maxEquipped));
  };

  const save = (): void => {
    const payload = currentSlots.filter((k): k is string => k !== null);
    if (payload.length === 0) {
      setMessage({ tone: 'err', text: 'Equip at least one skill.' });
      return;
    }
    mutation.mutate(payload);
  };

  const handleDragStart = (key: string) => (event: DragEvent<HTMLElement>): void => {
    draggingKeyRef.current = key;
    event.dataTransfer.setData(DND_MIME, key);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = (): void => {
    draggingKeyRef.current = null;
    setDragOverIndex(null);
    setPoolDragOver(false);
  };

  const readDragKey = (event: DragEvent): string | null => {
    const raw = event.dataTransfer.getData(DND_MIME);
    if (raw) return raw;
    return draggingKeyRef.current;
  };

  const handleSlotDragOver = (index: number) => (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleSlotDrop = (index: number) => (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const key = readDragKey(event);
    setDragOverIndex(null);
    setPoolDragOver(false);
    if (key !== null) placeInSlot(key, index);
  };

  const handlePoolDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggingKeyRef.current !== null && currentSlots.includes(draggingKeyRef.current)) {
      setPoolDragOver(true);
    }
  };

  const handlePoolDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const key = readDragKey(event);
    setPoolDragOver(false);
    setDragOverIndex(null);
    if (key === null) return;
    const existingIndex = currentSlots.indexOf(key);
    if (existingIndex >= 0) clearSlot(existingIndex);
  };

  
  return (
    <>
      <div className="skillhead">
        <span className="lbl">Skills — Equipped</span>
        <button 
          className="navbtn" 
          style={{ marginLeft: '12px', padding: '2px 8px', fontSize: '10px' }} 
          onClick={save} 
          disabled={!canSave || mutation.isPending}
        >
          {mutation.isPending ? 'Saving...' : (dirty ? 'Save changes' : 'Saved')}
        </button>
        <span className={`slots ${currentSlots.filter(s => s !== null).length >= data.maxEquipped ? 'full' : ''}`} id="slotcount">
          {currentSlots.filter(s => s !== null).length} / {data.maxEquipped} slots
        </span>
      </div>
      {message !== null ? <div className={`skill-editor-msg is-${message.tone}`}>{message.text}</div> : null}

      <div className="skill-editor-cols">
        <div className="skill-editor-col skill-editor-col--left">
          <div className="skill-filters">
            <div className="skill-filter" role="tablist" aria-label="Filter skills by stage">
              <span className="skill-filter-label">Stage</span>
              <button
                type="button"
                role="tab"
                className={`skill-filter-btn ${activeStageFilter === 'all' ? 'is-active' : ''}`}
                aria-selected={activeStageFilter === 'all'}
                onClick={() => setStageFilter('all')}
              >
                All <span className="filter-count">{data.learnedSkills.length}</span>
              </button>
              {availableStages.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  role="tab"
                  className={`skill-filter-btn ${activeStageFilter === stage ? 'is-active' : ''}`}
                  aria-selected={activeStageFilter === stage}
                  data-stage={stage.toLowerCase()}
                  onClick={() => setStageFilter(stage)}
                >
                  {stage} <span className="filter-count">{countByStage.get(stage) ?? 0}</span>
                </button>
              ))}
            </div>
            {availableElements.length > 0 ? (
              <div className="skill-filter" role="tablist" aria-label="Filter skills by element">
                <span className="skill-filter-label">Element</span>
                <button
                  type="button"
                  role="tab"
                  className={`skill-filter-btn ${activeElementFilter === 'all' ? 'is-active' : ''}`}
                  aria-selected={activeElementFilter === 'all'}
                  onClick={() => setElementFilter('all')}
                >
                  All
                </button>
                {availableElements.map((element) => (
                  <button
                    key={element}
                    type="button"
                    role="tab"
                    className={`skill-filter-btn skill-filter-btn--el ${activeElementFilter === element ? 'is-active' : ''}`}
                    aria-selected={activeElementFilter === element}
                    data-element={element}
                    style={{ ['--fchip' as string]: `var(--el-${element})` }}
                    onClick={() => setElementFilter(element)}
                  >
                    {element} <span className="filter-count">{countByElement.get(element) ?? 0}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {availableAttributes.length > 0 ? (
              <div className="skill-filter" role="tablist" aria-label="Filter skills by source Digimon attribute">
                <span className="skill-filter-label">Type</span>
                <button
                  type="button"
                  role="tab"
                  className={`skill-filter-btn ${activeAttributeFilter === 'all' ? 'is-active' : ''}`}
                  aria-selected={activeAttributeFilter === 'all'}
                  onClick={() => setAttributeFilter('all')}
                >
                  All
                </button>
                {availableAttributes.map((attribute) => (
                  <button
                    key={attribute}
                    type="button"
                    role="tab"
                    className={`skill-filter-btn skill-filter-btn--attr ${activeAttributeFilter === attribute ? 'is-active' : ''}`}
                    aria-selected={activeAttributeFilter === attribute}
                    data-attribute={attribute.toLowerCase()}
                    onClick={() => setAttributeFilter(attribute)}
                  >
                    {attribute} <span className="filter-count">{countByAttribute.get(attribute) ?? 0}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div
            className={`skill-pool ${poolDragOver ? 'is-dropzone' : ''}`}
            onDragOver={handlePoolDragOver}
            onDragLeave={() => setPoolDragOver(false)}
            onDrop={handlePoolDrop}
          >
            {visibleEntries.length === 0 ? (
              <div className="skill-group-empty">
                {anyFilterActive ? 'No skills match the current filters.' : 'No learned skills yet.'}
              </div>
            ) : (
              <div className="skill-grid">
                {visibleEntries.map((entry) => {
                  const equipped = chosenKeys.has(entry.key);
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      className={`skill-chip ${equipped ? 'is-equipped' : ''}`}
                      draggable
                      onDragStart={handleDragStart(entry.key)}
                      onDragEnd={handleDragEnd}
                      onClick={() => equipToFirstFree(entry.key)}
                      data-element={entry.skill.element}
                      title={entry.skill.description ?? entry.skill.name}
                    >
                      {equipped ? <span className="chip-equipped-badge">Equipped</span> : null}
                      <span className="chip-head">
                        <span className="chip-name">{entry.skill.name}</span>
                        <span className="chip-power">PWR {entry.skill.power}</span>
                      </span>
                      <span className="chip-meta">
                        <span className="chip-el" style={{ color: `var(--el-${entry.skill.element})` }}>{entry.skill.element}</span>
                        <span className="chip-en">EN {entry.skill.energyCost}</span>
                        <span className="chip-from">{entry.sourceStage}{entry.source === 'history' ? ` · ${entry.sourceTemplateName}` : ''}</span>
                      </span>
                      {entry.skill.description ? <span className="chip-desc">{entry.skill.description}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {data.catalogPool.length > 0 ? (
            <div className="catalog-skills-section">
              <div className="roster-section-title" style={{ marginTop: '24px' }}>
                <h4>{data.currentElement.charAt(0).toUpperCase() + data.currentElement.slice(1)} Skills (Advanced)</h4>
              </div>
              <div className="skill-filters">
                <div className="skill-filter" role="tablist" aria-label="Filter catalog skills by stage">
                  <span className="skill-filter-label">Stage</span>
                  <button
                    type="button"
                    role="tab"
                    className={`skill-filter-btn ${activeCatalogStageFilter === 'all' ? 'is-active' : ''}`}
                    aria-selected={activeCatalogStageFilter === 'all'}
                    onClick={() => setCatalogStageFilter('all')}
                  >
                    All <span className="filter-count">{data.catalogPool.length}</span>
                  </button>
                  {catalogAvailableStages.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      role="tab"
                      className={`skill-filter-btn ${activeCatalogStageFilter === stage ? 'is-active' : ''}`}
                      aria-selected={activeCatalogStageFilter === stage}
                      data-stage={stage.toLowerCase()}
                      onClick={() => setCatalogStageFilter(stage)}
                    >
                      {stage} <span className="filter-count">{catalogCountByStage.get(stage) ?? 0}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={`skill-pool ${poolDragOver ? 'is-dropzone' : ''}`}
                onDragOver={handlePoolDragOver}
                onDragLeave={() => setPoolDragOver(false)}
                onDrop={handlePoolDrop}
              >
                {visibleCatalogEntries.length === 0 ? (
                  <div className="skill-group-empty">
                    No catalog skills match the current filters.
                  </div>
                ) : (
                  <div className="skill-grid">
                    {visibleCatalogEntries.map((entry) => {
                      const equipped = chosenKeys.has(entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={`skill-chip catalog-skill-card ${equipped ? 'is-equipped' : ''}`}
                          draggable
                          onDragStart={handleDragStart(entry.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => equipToFirstFree(entry.id)}
                          data-element={entry.element}
                          title={entry.description ?? entry.name}
                        >
                          {equipped ? <span className="chip-equipped-badge">Equipped</span> : null}
                          <span className="chip-head">
                            <span className="chip-name">
                              {entry.name}
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
                          <span className="chip-name-pt">{entry.name_pt}</span>
                          <span className="chip-meta">
                            <span className="chip-el" style={{ color: `var(--el-${entry.element})` }}>{entry.element}</span>
                            <span className="chip-en">EN {entry.energyCost}</span>
                            {entry.cooldown > 0 ? <span className="chip-cd">CD {entry.cooldown}</span> : null}
                            <span className="chip-from">{entry.stage}</span>
                          </span>
                          {entry.description ? <span className="chip-desc">{entry.description.length > 80 ? entry.description.substring(0, 80) + '...' : entry.description}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="skill-editor-col skill-editor-col--right">
          <div className="slot-column" aria-label="Equipped skill slots">
            {currentSlots.map((key, index) => (
              <SkillSlotBox
                key={index}
                index={index}
                entry={mapSlotContent(key)}
                isDragOver={dragOverIndex === index}
                onDragOver={handleSlotDragOver(index)}
                onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
                onDrop={handleSlotDrop(index)}
                onDragStart={key !== null ? handleDragStart(key) : undefined}
                onDragEnd={handleDragEnd}
                onClear={() => clearSlot(index)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="skrow" id="skgrid">
        {data.learnedSkills.filter(entry => {
          if ((activeElementFilter as string) === 'attack') return entry.skill.power > 0;
          if ((activeElementFilter as string) === 'support') return entry.skill.power === 0;
          return true;
        }).map(entry => {
          const isEquipped = currentSlots.includes(entry.key);
          return (
            <button 
              key={entry.key}
              className={`sk ${isEquipped ? 'equipped' : ''}`} 
              data-skill={entry.key}
              onClick={() => {
                if (isEquipped) {
                  const idx = currentSlots.indexOf(entry.key);
                  clearSlot(idx);
                } else {
                  equipToFirstFree(entry.key);
                }
              }}
              style={{ ['--skel' as string]: `var(--el-${entry.skill.element})` }}
            >
              <div className="ic">
                {/* Fallback to simple circle SVG since we don't have EL_ICONS mapped here */}
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8" /></svg>
              </div>
              <div className="body">
                <span className="nm">
                  {entry.skill.name}
                  {isEquipped && <span className="eqtag">Equipped</span>}
                </span>
                <span className="ds">{entry.skill.description || '—'}</span>
              </div>
              <span className="cost">
                <span className="en">EN {entry.skill.energyCost}</span>
                <span className="pw">{entry.skill.power > 0 ? `${entry.skill.power} PWR` : '—'}</span>
              </span>
            </button>
          );
        })}
        {data.learnedSkills.length === 0 && <div className="skempty">No skills in this pool.</div>}
      </div>
      <div className="skhint" id="skhint" aria-live="polite">
        {message ? message.text : 'Click to equip or remove skills.'}
      </div>
    </>
  );
}
