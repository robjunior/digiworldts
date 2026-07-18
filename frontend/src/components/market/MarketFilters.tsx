import type { ChangeEvent } from 'react';

import { MARKET_ELEMENTS, MARKET_STAGES, type MarketFilters as MarketFiltersValue } from '../../lib/api-market';

type FilterKey = keyof MarketFiltersValue;

export function MarketFilters({ filters, onFilters }: { readonly filters: MarketFiltersValue; readonly onFilters: (filters: MarketFiltersValue) => void }): JSX.Element {
  const update = (key: FilterKey) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    onFilters({ ...filters, [key]: event.currentTarget.value });
  };

  return (
    <div className="filter-bar">
      <input className="input" placeholder="Search by name…" value={filters.q} onChange={update('q')} />
      <select className="input" value={filters.stage} onChange={update('stage')} aria-label="Stage filter">
        <option value="">Any stage</option>
        {MARKET_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
      </select>
      <select className="input" value={filters.element} onChange={update('element')} aria-label="Element filter">
        <option value="">Any element</option>
        {MARKET_ELEMENTS.map((element) => <option key={element} value={element}>{label(element)}</option>)}
      </select>
      <input className="input" placeholder="Min lvl" type="number" min="1" max="99" value={filters.minLevel} onChange={update('minLevel')} />
      <input className="input" placeholder="Max lvl" type="number" min="1" max="99" value={filters.maxLevel} onChange={update('maxLevel')} />
      <input className="input" placeholder="Min price" type="number" min="0" value={filters.minPrice} onChange={update('minPrice')} />
      <input className="input" placeholder="Max price" type="number" min="0" value={filters.maxPrice} onChange={update('maxPrice')} />
      <select className="input" value={filters.sort} onChange={update('sort')} aria-label="Sort listings">
        <option value="newest">Newest</option>
        <option value="price_asc">Price ↑</option>
        <option value="price_desc">Price ↓</option>
        <option value="level_desc">Level ↓</option>
      </select>
    </div>
  );
}

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
