/**
 * VirtualizedGrid — windowed grid for LARGE containers (brief section 12).
 *
 * The spike does not require thousands of slots yet, but the architecture must
 * not block future virtualisation. This component keeps the SAME `SlotView`
 * contract as `ItemGrid`, so the only change needed later is which grid the
 * container renders. It implements a simple fixed-row windowing strategy
 * (no external dep) that only mounts the rows near the scroll viewport.
 *
 * The container component is agnostic: `ItemContainer` accepts a `grid` render
 * prop / `virtualized` flag and picks ItemGrid or VirtualizedGrid.
 */

import { memo, useRef, useState, type JSX, type UIEvent } from 'react';

import type { SlotView } from '../types';
import { ItemSlot, type ItemSlotProps } from './ItemSlot';

export interface VirtualizedGridProps {
  slots: ReadonlyArray<SlotView>;
  columns?: number;
  /** Visible row buffer above/below the viewport. */
  overscan?: number;
  rowHeight?: number;
  viewportHeight?: number;
  dimFiltered?: boolean;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  onHover?: (index: number | null) => void;
}

function VirtualizedGridImpl(props: VirtualizedGridProps): JSX.Element {
  const {
    slots,
    columns = 10,
    overscan = 2,
    rowHeight = 72,
    viewportHeight = 480,
  } = props;

  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowCount = Math.ceil(slots.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const lastRow = Math.min(rowCount - 1, Math.floor((scrollTop + viewportHeight) / rowHeight) + overscan);

  const visible: JSX.Element[] = [];
  for (let r = firstRow; r <= lastRow; r += 1) {
    const start = r * columns;
    const rowSlots = slots.slice(start, start + columns);
    visible.push(
      <div className="ic-vrow" key={r} style={{ height: rowHeight }}>
        {rowSlots.map((slot) => {
          const slotProps: ItemSlotProps = {
            slot,
            dimFiltered: props.dimFiltered ?? true,
            selected: props.selectedIndex === slot.index,
            onSelect: props.onSelect,
            onHover: props.onHover,
            draggable: undefined,
            onDragStart: undefined,
            onDrop: undefined,
          };
          return <ItemSlot key={slot.index} {...slotProps} />;
        })}
      </div>,
    );
  }

  const onScroll = (e: UIEvent<HTMLDivElement>): void => setScrollTop(e.currentTarget.scrollTop);

  return (
    <div
      className="ic-vgrid"
      ref={scrollRef}
      onScroll={onScroll}
      style={{ height: viewportHeight, overflowY: 'auto' }}
      data-od-id="item-grid-virtualized"
      role="grid"
    >
      <div className="ic-vspacer" style={{ height: rowCount * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${firstRow * rowHeight}px)` }}>{visible}</div>
      </div>
    </div>
  );
}

export const VirtualizedGrid = memo(VirtualizedGridImpl);
