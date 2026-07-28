import { type DragEvent } from 'react';

import type { CatalogSkillMeta, LearnedSkillEntry } from '../../lib/api-roster';

export type EquippedSlotContent =
  | { readonly kind: 'wikimon'; readonly entry: LearnedSkillEntry }
  | { readonly kind: 'catalog'; readonly meta: CatalogSkillMeta };

type SkillSlotBoxProps = {
  readonly index: number;
  readonly entry: EquippedSlotContent | null;
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
  const element = entry?.kind === 'wikimon' ? entry.entry.skill.element : entry?.kind === 'catalog' ? entry.meta.element : 'null';
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
      data-element={element}
    >
      <div className="slot-label">Slot {index + 1}</div>
      {filled && entry.kind === 'wikimon' ? (
        <>
          <div className="slot-name">{entry.entry.skill.name}</div>
          <div className="slot-meta">
            <span className="slot-el" style={{ color: `var(--el-${entry.entry.skill.element})` }}>{entry.entry.skill.element}</span>
            <span className="slot-power">PWR {entry.entry.skill.power}</span>
            <span className="slot-en">EN {entry.entry.skill.energyCost}</span>
          </div>
          {entry.entry.source === 'history' ? <span className="slot-source">from {entry.entry.sourceTemplateName}</span> : null}
          <button type="button" className="slot-clear" aria-label={`Unequip ${entry.entry.skill.name}`} onClick={onClear}>×</button>
        </>
      ) : filled && entry.kind === 'catalog' ? (
        <>
          <div className="slot-name">
            {entry.meta.name}
            {entry.meta.tier_2 ? <span className="tier-2-badge" title="Tier 2">★</span> : null}
          </div>
          <div className="slot-meta">
            <span className="slot-el" style={{ color: `var(--el-${entry.meta.element})` }}>{entry.meta.element}</span>
            <span className="slot-en">EN {entry.meta.energyCost}</span>
            {entry.meta.cooldown > 0 ? <span className="slot-cd">CD {entry.meta.cooldown}</span> : null}
          </div>
          <button type="button" className="slot-clear" aria-label={`Unequip ${entry.meta.name}`} onClick={onClear}>×</button>
        </>
      ) : (
        <div className="slot-empty-hint">Drop skill here</div>
      )}
    </div>
  );
}
