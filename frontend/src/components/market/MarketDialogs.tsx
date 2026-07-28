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
      return (
        <ConfirmDialog
          title="Buy this Digimon?"
          body={`${state.listing.nickname} costs ${state.listing.price.toLocaleString()} DigiCredits.`}
          action="Buy"
          busy={props.busy}
          onClose={props.onClose}
          onConfirm={() => props.onBuy(state.listing)}
        />
      );
    case 'cancel':
      return (
        <ConfirmDialog
          title="Cancel this listing?"
          body={`${state.listing.nickname} returns to your roster.`}
          action="Cancel listing"
          busy={props.busy}
          danger
          onClose={props.onClose}
          onConfirm={() => props.onCancel(state.listing)}
        />
      );
    case 'sell':
      return (
        <SellDialog
          state={state}
          busy={props.busy}
          onClose={props.onClose}
          onSellPrice={props.onSellPrice}
          onSell={props.onSell}
        />
      );
  }
}

function ConfirmDialog({ title, body, action, busy, danger, onClose, onConfirm }: { readonly title: string; readonly body: string; readonly action: string; readonly busy: boolean; readonly danger?: boolean; readonly onClose: () => void; readonly onConfirm: () => void }): JSX.Element {
  return (
    <div className="drawer open" role="dialog" aria-modal="true" aria-labelledby="market-dialog-title">
      <div className="scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }} />
      <div className="dpanel">
        <div className="dhead">
          <div>
            <div className="dk">Confirm Action</div>
            <h2 id="market-dialog-title">{title}</h2>
          </div>
          <button className="dclose" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="dbody">
          <p className="market-dialog-copy">{body}</p>
        </div>
        <div className="dfoot">
          <span className="dhint"></span>
          <button className="btn" type="button" disabled={busy} onClick={onConfirm} style={danger ? { background: 'var(--battle)' } : undefined}>
            {busy ? 'Working…' : action}
          </button>
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
    <div className="drawer open" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }} />
      <div className="dpanel">
        <div className="dhead">
          <div>
            <div className="dk">Sell on the Market</div>
            <h2 id="drawer-title">List a Digimon</h2>
          </div>
          <button className="dclose" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="dbody">
          <div className="field">
            <div className="flabel"><span>Selected Digimon</span></div>
            <div className="sellpick">
              <div className="sp on">
                <span className="sps">
                  <img src={portrait} alt="" onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} />
                </span>
                <div>
                  <div className="spn">{state.mon.nickname}</div>
                  <div className="spsub">{template?.name ?? 'Digimon'} · Lv {state.mon.level} · {stage}</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="field">
            <div className="flabel"><span>Asking price</span><b>min 10</b></div>
            <label className="priceinput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
              </svg>
              <input
                type="number"
                min="10"
                placeholder="0"
                value={state.price}
                onChange={(event) => onSellPrice(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && valid) onSell(state.mon, price); }}
                aria-label="Asking price in DigiCredits"
              />
            </label>
          </div>
        </div>
        <div className="dfoot">
          <span className={`dhint ${!valid && state.price ? 'warn' : ''}`}>
            {!state.price ? 'Set a price of at least 10 DigiCredits.' : 
             !valid ? 'Minimum price is 10 DigiCredits.' : 
             `List ${state.mon.nickname} for ${price.toLocaleString()} DigiCredits.`}
          </span>
          <button className="btn" type="button" disabled={busy || !valid} onClick={() => onSell(state.mon, price)}>
            {busy ? 'Listing…' : 'List'}
          </button>
        </div>
      </div>
    </div>
  );
}
