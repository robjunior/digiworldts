/**
 * ItemContainer — the SHARED shell for Inventory AND Vault (brief section 8).
 *
 * It receives derived data + filter controls via props and renders:
 *   Header  (title + "used / total" capacity readout)
 *   Filters (category chips + search box, all driven by `useItemContainer`)
 *   Grid    (ItemGrid or VirtualizedGrid — same SlotView contract)
 *   Footer  (capacity breakdown summary)
 *
 * It contains ZERO capacity/access/business logic of its own. It is the same
 * component for inventory and vault; only the props differ. This proves the
 * spike's central claim: Inventory and Vault are two instances of one system.
 */

import { memo, type CSSProperties, type JSX } from 'react';

import type { ItemFilterCategory } from '../types';
import type { UseItemContainerResult } from '../useItemContainer';
import { ItemGrid } from './ItemGrid';
import { VirtualizedGrid } from './VirtualizedGrid';

export interface ItemContainerProps {
  title: string;
  /** Result from useItemContainer (derived view + UI-state controls). */
  container: UseItemContainerResult;
  /** Capacity readout: occupied/total. `total` comes from capacity derivation. */
  used: number;
  total: number;
  columns?: number;
  /** Enable windowed rendering for very large containers (e.g. big vaults). */
  virtualized?: boolean;
  /** Optional capacity breakdown lines shown in the footer. */
  capacityBreakdown?: ReadonlyArray<{ label: string; slots: number }>;
  /** When false, the whole container is locked (e.g. vault unavailable). */
  enabled?: boolean;
  /** Overlay message shown when disabled (e.g. "Vault unavailable"). */
  disabledReason?: string;
}

function ItemContainerImpl(props: ItemContainerProps): JSX.Element {
  const { container, used, total, columns = 6, virtualized = false } = props;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const headerStyle: CSSProperties = { ['--fill' as string]: `${pct}%` };

  return (
    <section className={`ic-container ${props.enabled === false ? 'is-disabled' : ''}`} data-od-id="item-container">
      <header className="ic-header">
        <h2 className="ic-title">{props.title}</h2>
        <div className="ic-cap" aria-label={`${used} of ${total} slots used`}>
          <span className="ic-cap-num">
            {used} / {total}
          </span>
          <span className="ic-cap-bar">
            <span className="ic-cap-fill" style={headerStyle} />
          </span>
        </div>
      </header>

      <div className="ic-filters" role="tablist" aria-label={`${props.title} filters`}>
        {container.categoryFilters.map((f) => {
          const active = container.filter.category === f.category;
          const count = container.categoryCounts[f.category] ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ic-chip ${active ? 'is-active' : ''}`}
              onClick={() => container.setCategory(f.category as ItemFilterCategory)}
            >
              {f.label}
              <span className="ic-chip-n">{count}</span>
            </button>
          );
        })}
        <input
          className="ic-search"
          type="search"
          placeholder="Search…"
          aria-label="Search items"
          value={container.filter.search}
          onChange={(e) => container.setSearch(e.target.value)}
        />
      </div>

      <div className="ic-body">
        {props.enabled === false ? (
          <div className="ic-locked" role="status">
            <span className="ic-lock-ico" aria-hidden="true">🔒</span>
            <p>{props.disabledReason ?? 'Unavailable'}</p>
          </div>
        ) : container.view.slots.length === 0 ? (
          <div className="ic-empty-state">No slots.</div>
        ) : virtualized ? (
          <VirtualizedGrid
            slots={container.view.slots}
            columns={columns}
            selectedIndex={null}
            onSelect={(i) => container.setSearch(container.grid[i]?.item?.name ?? '')}
          />
        ) : (
          <ItemGrid
            slots={container.view.slots}
            columns={columns}
            selectedIndex={null}
            onSelect={(i) => container.setSearch(container.grid[i]?.item?.name ?? '')}
          />
        )}
      </div>

      {props.capacityBreakdown && props.capacityBreakdown.length > 0 && (
        <footer className="ic-footer">
          {props.capacityBreakdown.map((line) => (
            <span key={line.label} className="ic-foot-line">
              {line.label}: <b>+{line.slots}</b>
            </span>
          ))}
        </footer>
      )}
    </section>
  );
}

export const ItemContainer = memo(ItemContainerImpl);
