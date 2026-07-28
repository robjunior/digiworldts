import type { ChangeEvent } from 'react';

import { MARKET_ELEMENTS, MARKET_STAGES, type MarketFilters as MarketFiltersValue, DEFAULT_MARKET_FILTERS } from '../../lib/api-market';

type FilterKey = keyof MarketFiltersValue;

export function MarketFilters({ filters, onFilters }: { readonly filters: MarketFiltersValue; readonly onFilters: (filters: MarketFiltersValue) => void }): JSX.Element {
  const update = (key: FilterKey) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    onFilters({ ...filters, [key]: event.currentTarget.value });
  };

  const hasFilters = filters.q !== '' || filters.stage !== '' || filters.element !== '' || filters.minLevel !== '' || filters.maxLevel !== '' || filters.minPrice !== '' || filters.maxPrice !== '';

  return (
    <aside className="filters" data-od-id="market-filters">
      <div className="fgroup">
        <div className="fl">Search</div>
        <label className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input type="text" placeholder="Name…" aria-label="Search listings" autoComplete="off" value={filters.q} onChange={update('q')} />
        </label>
      </div>

      <div className="fgroup">
        <div className="fl">Stage</div>
        <select className="fsel" aria-label="Stage filter" value={filters.stage} onChange={update('stage')}>
          <option value="">Any stage</option>
          {MARKET_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      </div>

      <div className="fgroup">
        <div className="fl">Element</div>
        <select className="fsel" aria-label="Element filter" value={filters.element} onChange={update('element')}>
          <option value="">Any element</option>
          {MARKET_ELEMENTS.map((element) => (
            <option key={element} value={element}>
              {label(element)}
            </option>
          ))}
        </select>
      </div>

      <div className="fgroup">
        <div className="fl">Level range</div>
        <div className="frow">
          <input className="fnum" type="number" min="1" max="99" placeholder="Min" aria-label="Min level" value={filters.minLevel} onChange={update('minLevel')} />
          <input className="fnum" type="number" min="1" max="99" placeholder="Max" aria-label="Max level" value={filters.maxLevel} onChange={update('maxLevel')} />
        </div>
      </div>

      <div className="fgroup">
        <div className="fl">Price range</div>
        <div className="frow">
          <input className="fnum" type="number" min="0" placeholder="Min" aria-label="Min price" value={filters.minPrice} onChange={update('minPrice')} />
          <input className="fnum" type="number" min="0" placeholder="Max" aria-label="Max price" value={filters.maxPrice} onChange={update('maxPrice')} />
        </div>
      </div>

      <button
        className="clearchip"
        type="button"
        hidden={!hasFilters}
        onClick={() => onFilters({ ...DEFAULT_MARKET_FILTERS, sort: filters.sort })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
        Clear filters
      </button>
    </aside>
  );
}

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
