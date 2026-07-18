import { SHOP_FILTERS, type ShopFilter } from './types';

export function ShopFilters({ active, onFilter }: { readonly active: ShopFilter; readonly onFilter: (filter: ShopFilter) => void }): JSX.Element {
  return (
    <div className="filters" id="shop-filters">
      {SHOP_FILTERS.map((filter) => <button key={filter.value} className={`filter-btn ${active === filter.value ? 'active' : ''}`} type="button" onClick={() => onFilter(filter.value)}>{filter.label}</button>)}
    </div>
  );
}
