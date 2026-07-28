import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { ATTRIBUTES, ELEMENTS, STAGES } from '@digiworld/shared/digimon';

import { ApiError } from '../../lib/api';
import { getMonSkills, setMonSkills } from '../../lib/api-roster';
import { SkillSlotBox } from './SkillSlotBox';

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
      
      <div className="skfilter" id="skfilter" role="group" aria-label="Filter skills by type">
        <button className={`skchip ${activeElementFilter === 'all' ? 'is-on' : ''}`} aria-pressed={activeElementFilter === 'all'} onClick={() => setElementFilter('all')}>All</button>
        <button className={`skchip ${(activeElementFilter as string) === 'attack' ? 'is-on' : ''}`} aria-pressed={(activeElementFilter as string) === 'attack'} onClick={() => setElementFilter('attack' as any)}>Attack</button>
        <button className={`skchip ${(activeElementFilter as string) === 'support' ? 'is-on' : ''}`} aria-pressed={(activeElementFilter as string) === 'support'} onClick={() => setElementFilter('support' as any)}>Support</button>
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
