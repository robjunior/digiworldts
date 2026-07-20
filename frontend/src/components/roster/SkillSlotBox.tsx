import { type DragEvent } from 'react';

import type { LearnedSkillEntry } from '../../lib/api-roster';

type SkillSlotBoxProps = {
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

export function SkillSlotBox({ index, entry, isDragOver, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd, onClear }: SkillSlotBoxProps): JSX.Element {
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
      data-element={entry?.skill.element ?? 'null'}
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
