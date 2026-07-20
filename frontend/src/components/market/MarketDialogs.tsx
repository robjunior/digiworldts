import type { RosterView } from '../../lib/api';
import type { MarketListing, MyMarketListing } from '../../lib/api-market';

export type MarketDialogState =
  | { readonly kind: 'none' }
  | { readonly kind: 'buy'; readonly listing: MarketListing }
  | { readonly kind: 'cancel'; readonly listing: MyMarketListing }
  | { readonly kind: 'sell'; readonly mon: RosterView; readonly price: string };

type DialogProps = {
  readonly state: MarketDialogState;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onBuy: (listing: MarketListing) => void;
  readonly onCancel: (listing: MyMarketListing) => void;
  readonly onSellPrice: (price: string) => void;
  readonly onSell: (mon: RosterView, price: number) => void;
};

export function MarketDialogs(props: DialogProps): JSX.Element | null {
  const state = props.state;
  switch (state.kind) {
    case 'none':
      return null;
    case 'buy':
      return <ConfirmDialog title="Buy this Digimon?" body={`${state.listing.nickname} costs ${state.listing.price.toLocaleString()} DigiCredits.`} action="Buy" busy={props.busy} onClose={props.onClose} onConfirm={() => props.onBuy(state.listing)} />;
    case 'cancel':
      return <ConfirmDialog title="Cancel this listing?" body={`${state.listing.nickname} returns to your roster.`} action="Cancel listing" busy={props.busy} danger onClose={props.onClose} onConfirm={() => props.onCancel(state.listing)} />;
    case 'sell':
      return <SellDialog state={state} busy={props.busy} onClose={props.onClose} onSellPrice={props.onSellPrice} onSell={props.onSell} />;
  }
}

function ConfirmDialog({ title, body, action, busy, danger, onClose, onConfirm }: { readonly title: string; readonly body: string; readonly action: string; readonly busy: boolean; readonly danger?: boolean; readonly onClose: () => void; readonly onConfirm: () => void }): JSX.Element {
  return (
    <div className="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="market-dialog-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="market-dialog-title">{title}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="market-dialog-copy">{body}</p>
        <div className="market-dialog-actions">
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={onClose}>Back</button>
          <button className={danger ? 'btn btn--danger' : 'btn'} type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : action}</button>
        </div>
      </div>
    </div>
  );
}

function SellDialog({ state, busy, onClose, onSellPrice, onSell }: { readonly state: Extract<MarketDialogState, { readonly kind: 'sell' }>; readonly busy: boolean; readonly onClose: () => void; readonly onSellPrice: (price: string) => void; readonly onSell: (mon: RosterView, price: number) => void }): JSX.Element {
  const template = state.mon.template;
  const portrait = template?.assets.portrait ?? `/assets/digimon/${state.mon.catalogId}/portrait.webp`;
  const stage = template?.stage ?? '—';
  const element = template?.element ?? 'null';
  const price = Number(state.price);
  const valid = Number.isInteger(price) && price >= 10 && price <= 1_000_000;

  return (
    <div className="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="sell-dialog-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="sell-dialog-title">List on Market</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div id="sell-summary">
          <img src={portrait} alt="" onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} />
          <div>
            <div className="name">{state.mon.nickname}</div>
            <div className="meta">{stage} · {element} · LV {state.mon.level}</div>
          </div>
        </div>
        <label className="price-label" htmlFor="sell-price">Price (DigiCredits)</label>
        <input id="sell-price" type="number" min="10" max="1000000" step="1" value={state.price} onChange={(event) => onSellPrice(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && valid) onSell(state.mon, price); }} />
        <div className="price-hint">Between 10 and 1,000,000 DigiCredits.</div>
        <button className="btn btn--wide" type="button" disabled={busy || !valid} onClick={() => onSell(state.mon, price)}>{busy ? 'Listing…' : 'List for Sale'}</button>
      </div>
    </div>
  );
}
