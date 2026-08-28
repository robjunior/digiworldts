/**
 * ItemGrid — reusable, non-virtualised grid of ItemSlots (brief section 8).
 *
 * Renders every slot in the view. Suitable for the inventory (small) and for
 * the vault spike demo. For genuinely huge vaults, swap this for
 * `VirtualizedGrid` (same SlotView contract) — the parent container doesn't
 * care which one it renders.
 */

import { memo, type JSX } from 'react';

import type { SlotView } from '../types';
import { ItemSlot, type ItemSlotProps } from './ItemSlot';

export interface ItemGridProps {
  slots: ReadonlyArray<SlotView>;
  columns?: number;
  dimFiltered?: boolean;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  onHover?: (index: number | null) => void;
  draggable?: boolean;
  onDragStart?: (index: number) => void;
  onDrop?: (index: number) => void;
}

function ItemGridImpl(props: ItemGridProps): JSX.Element {
  const { slots, columns = 6 } = props;
  return (
    <div
      className="ic-grid"
      role="grid"
      style={{ ['--cols' as string]: columns }}
      data-od-id="item-grid"
    >
      {slots.map((slot) => {
        const slotProps: ItemSlotProps = {
          slot,
          dimFiltered: props.dimFiltered ?? true,
          selected: props.selectedIndex === slot.index,
          onSelect: props.onSelect,
          onHover: props.onHover,
          draggable: props.draggable,
          onDragStart: props.onDragStart,
          onDrop: props.onDrop,
        };
        return <ItemSlot key={slot.index} {...slotProps} />;
      })}
    </div>
  );
}

export const ItemGrid = memo(ItemGridImpl);
