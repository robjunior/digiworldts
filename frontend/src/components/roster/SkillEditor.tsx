import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { STAGES } from '@digiworld/shared/digimon';

import { ApiError } from '../../lib/api';
import { getMonSkills, setMonSkills } from '../../lib/api-roster';
import { SkillSlotBox } from './SkillSlotBox';

type SkillEditorProps = {
  readonly monId: string;
};

const ROSTER_QUERY_KEY = ['roster'] as const;
const DND_MIME = 'application/x-digiworld-skill';
type StageFilter = 'all' | (typeof STAGES)[number];

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
  const equippedFromLoad = padSlots(data.equipped, data.maxEquipped);
  const dirty = !slotsEqual(currentSlots, equippedFromLoad);
  const canSave = dirty && chosenKeys.size > 0 && chosenKeys.size <= data.maxEquipped;

  const countByStage = new Map<string, number>();
  for (const entry of data.learnedSkills) {
    countByStage.set(entry.sourceStage, (countByStage.get(entry.sourceStage) ?? 0) + 1);
  }
  const availableStages = STAGES.filter((s) => countByStage.has(s));
  const activeStageFilter: StageFilter = stageFilter !== 'all' && !countByStage.has(stageFilter) ? 'all' : stageFilter;
  const visibleEntries = activeStageFilter === 'all'
    ? data.learnedSkills
    : data.learnedSkills.filter((e) => e.sourceStage === activeStageFilter);

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
    <div className="skill-editor">
      <div className="skill-editor-header">
        <div className="hdr-title">
          <h3>Skill loadout</h3>
          <span className="hdr-sub">Drag or click to equip up to <b>{data.maxEquipped}</b> — currently <b>{chosenKeys.size}</b>/{data.maxEquipped}</span>
        </div>
        <div className="hdr-actions">
          <button className="btn btn--secondary btn--sm" type="button" onClick={reset} disabled={!dirty || mutation.isPending}>Reset</button>
          <button className="btn btn--sm" type="button" onClick={save} disabled={!canSave || mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save loadout'}</button>
        </div>
      </div>
      {message !== null ? <div className={`skill-editor-msg is-${message.tone}`}>{message.text}</div> : null}

      <div className="skill-editor-cols">
        <div className="skill-editor-col skill-editor-col--left">
          <div className="skill-filter" role="tablist" aria-label="Filter skills by stage">
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
          <div
            className={`skill-pool ${poolDragOver ? 'is-dropzone' : ''}`}
            onDragOver={handlePoolDragOver}
            onDragLeave={() => setPoolDragOver(false)}
            onDrop={handlePoolDrop}
          >
            {visibleEntries.length === 0 ? (
              <div className="skill-group-empty">No {activeStageFilter === 'all' ? 'learned skills' : `${activeStageFilter} skills`} yet.</div>
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
        </div>

        <div className="skill-editor-col skill-editor-col--right">
          <div className="slot-column" aria-label="Equipped skill slots">
            {currentSlots.map((key, index) => (
              <SkillSlotBox
                key={index}
                index={index}
                entry={key !== null ? skillByKey.get(key) ?? null : null}
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
    </div>
  );
}
