import type { MarketTab } from '../../lib/api-market';

const TABS: readonly { readonly id: MarketTab; readonly label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'mine', label: 'My Listings' },
  { id: 'sell', label: 'Sell a Digimon' },
];

export function MarketTabs({ activeTab, onTab }: { readonly activeTab: MarketTab; readonly onTab: (tab: MarketTab) => void }): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="Market sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={activeTab === tab.id ? 'tab is-active' : 'tab'}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
