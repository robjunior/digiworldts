import type { MarketTab } from '../../lib/api-market';

const TABS: readonly { readonly id: MarketTab; readonly label: string; readonly svg: JSX.Element }[] = [
  {
    id: 'browse',
    label: 'Digimon',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="9" r="4" />
        <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      </svg>
    ),
  },
  {
    id: 'mine',
    label: 'My Listings',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 7h16l-1.2 4.5H5.2L4 7z" />
        <path d="M5.2 11.5V19h13.6v-7.5" />
      </svg>
    ),
  },
  {
    id: 'sell',
    label: 'List a Digimon',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    id: 'coins',
    label: 'Coin Market',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
      </svg>
    ),
  },
];

export function MarketTabs({ activeTab, onTab }: { readonly activeTab: MarketTab; readonly onTab: (tab: MarketTab) => void }): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="Market sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={activeTab === tab.id ? 'tab on' : 'tab'}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTab(tab.id)}
        >
          {tab.svg}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
