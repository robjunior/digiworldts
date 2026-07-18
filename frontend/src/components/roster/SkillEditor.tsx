import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { ApiError } from '../../lib/api';
import { getMonSkills, setMonSkills, type LearnedSkillEntry } from '../../lib/api-roster';

type SkillEditorProps = {
  readonly monId: string;
};

const ROSTER_QUERY_KEY = ['roster'] as const;
const DND_MIME = 'application/x-digiworld-skill';

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
  const fromCurrent = data.groupings.fromCurrent.map((k) => skillByKey.get(k)).filter((e): e is LearnedSkillEntry => Boolean(e));
  const fromHistory = data.groupings.fromHistory.map((k) => skillByKey.get(k)).filter((e): e is LearnedSkillEntry => Boolean(e));
  const equippedFromLoad = padSlots(data.equipped, data.maxEquipped);
  const dirty = !slotsEqual(currentSlots, equippedFromLoad);
  const canSave = dirty && chosenKeys.size > 0 && chosenKeys.size <= data.maxEquipped;

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

      <div className="slot-row" aria-label="Equipped skill slots">
        {currentSlots.map((key, index) => (
          <SlotBox
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

      <div
        className={`skill-pool ${poolDragOver ? 'is-dropzone' : ''}`}
        onDragOver={handlePoolDragOver}
        onDragLeave={() => setPoolDragOver(false)}
        onDrop={handlePoolDrop}
      >
        <SkillGroup title="Current form" subtitle={data.currentName} entries={fromCurrent} chosenKeys={chosenKeys} onEquip={equipToFirstFree} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        {fromHistory.length > 0 ? (
          <SkillGroup title="From prior evolutions" subtitle={`${data.history.length} form${data.history.length === 1 ? '' : 's'} in history`} entries={fromHistory} chosenKeys={chosenKeys} onEquip={equipToFirstFree} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        ) : (
          <div className="skill-group-empty">No prior-evolution skills yet. Digivolve this Digimon to unlock more skills.</div>
        )}
      </div>
    </div>
  );
}

type SlotBoxProps = {
  readonly index: number;
  readonly entry: LearnedSkillEntry | null;
  readonly isDragOver: boolean;
  readonly onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDragStart: ((event: DragEvent<HTMLElement>) => void) | undefined;
  readonly onDragEnd: () => void;
  readonly onClear: () => void;
};

function SlotBox({ index, entry, isDragOver, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd, onClear }: SlotBoxProps): JSX.Element {
  const filled = entry !== null;
  const classes = ['skill-slot', filled ? 'is-filled' : 'is-empty', isDragOver ? 'is-dragover' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      draggable={filled}
      onDragStart={filled && onDragStart ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      data-element={entry?.skill.element ?? 'neutral'}
    >
      <div className="slot-label">Slot {index + 1}</div>
      {filled && entry !== null ? (
        <>
          <div className="slot-name">{entry.skill.name}</div>
          <div className="slot-meta">
            <span className="slot-el" style={{ color: `var(--el-${entry.skill.element})` }}>{entry.skill.element}</span>
            <span className="slot-power">PWR {entry.skill.power}</span>
            <span className="slot-en">EN {entry.skill.energyCost}</span>
          </div>
          {entry.source === 'history' ? <span className="slot-source">from {entry.sourceTemplateName}</span> : null}
          <button type="button" className="slot-clear" aria-label={`Unequip ${entry.skill.name}`} onClick={onClear}>×</button>
        </>
      ) : (
        <div className="slot-empty-hint">Drop skill here</div>
      )}
    </div>
  );
}

type SkillGroupProps = {
  readonly title: string;
  readonly subtitle: string;
  readonly entries: readonly LearnedSkillEntry[];
  readonly chosenKeys: ReadonlySet<string>;
  readonly onEquip: (key: string) => void;
  readonly onDragStart: (key: string) => (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
};

function SkillGroup({ title, subtitle, entries, chosenKeys, onEquip, onDragStart, onDragEnd }: SkillGroupProps): JSX.Element {
  return (
    <div className="skill-group">
      <div className="skill-group-head">
        <span className="skill-group-title">{title}</span>
        <span className="skill-group-sub">{subtitle}</span>
      </div>
      <div className="skill-grid">
        {entries.map((entry) => {
          const equipped = chosenKeys.has(entry.key);
          return (
            <button
              key={entry.key}
              type="button"
              className={`skill-chip ${equipped ? 'is-equipped' : ''}`}
              draggable
              onDragStart={onDragStart(entry.key)}
              onDragEnd={onDragEnd}
              onClick={() => onEquip(entry.key)}
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
                {entry.source === 'history' ? <span className="chip-from">from {entry.sourceTemplateName}</span> : null}
              </span>
              {entry.skill.description ? <span className="chip-desc">{entry.skill.description}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
