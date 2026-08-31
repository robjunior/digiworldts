/**
 * ItemSlot — the single, reusable slot cell used by BOTH Inventory and Vault
 * (brief section 8: "ItemSlot must be reusable").
 *
 * It is a pure presentational component: it takes a SlotView and optional
 * interaction handlers. It knows nothing about capacity rules, filters, or
 * whether it belongs to a vault. Drag/drop hooks are accepted as optional
 * props so the data structure already supports future reorganisation without
 * rewriting the component.
 */

import { memo, type CSSProperties, type JSX } from 'react';

import type { SlotView } from '../types';

export interface ItemSlotProps {
  slot: SlotView;
  /** When true, hidden-by-filter slots render dimmed instead of removed. */
  dimFiltered: boolean | undefined;
  selected: boolean | undefined;
  onSelect: ((index: number) => void) | undefined;
  onHover: ((index: number | null) => void) | undefined;
  /** Optional drag-handle props forwarded to the root (future DnD). */
  draggable: boolean | undefined;
  onDragStart: ((index: number) => void) | undefined;
  onDrop: ((index: number) => void) | undefined;
}

function ItemSlotImpl(props: ItemSlotProps): JSX.Element {
  const { slot, dimFiltered = true } = props;
  const occupied = slot.item !== null;

  const style: CSSProperties = {
    // Visual hint: stacked slots (same item, not the head) get a subtle join.
    ['--stack-join' as string]: slot.isStackTail && occupied ? '1' : '0',
  };

  const cls = [
    'ic-slot',
    occupied ? 'is-occupied' : 'is-empty',
    slot.visible ? '' : 'is-hidden',
    props.selected ? 'is-selected' : '',
    !slot.visible && dimFiltered ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      style={style}
      aria-label={slot.item ? `${slot.item.name} ×${slot.quantity}` : `Empty slot ${slot.index + 1}`}
      data-empty={occupied ? undefined : 'true'}
      data-od-id={`slot-${slot.index}`}
      draggable={props.draggable}
      onClick={() => props.onSelect?.(slot.index)}
      onMouseEnter={() => props.onHover?.(slot.index)}
      onMouseLeave={() => props.onHover?.(null)}
      onDragStart={() => props.onDragStart?.(slot.index)}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop?.(slot.index);
      }}
      onDragOver={(e) => {
        if (props.draggable) e.preventDefault();
      }}
    >
      {occupied && slot.item ? (
        <>
          <span className="ic-icon" aria-hidden="true">
            {slot.item.icon}
          </span>
          {slot.quantity > 1 && <span className="ic-qty">×{slot.quantity}</span>}
        </>
      ) : (
        <span className="ic-empty-mark" aria-hidden="true" />
      )}
    </button>
  );
}

export const ItemSlot = memo(ItemSlotImpl);
