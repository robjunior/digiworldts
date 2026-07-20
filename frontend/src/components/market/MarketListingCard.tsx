import type { RosterView } from '../../lib/api';
import type { MarketListing, MyMarketListing } from '../../lib/api-market';

type CardMode =
  | { readonly kind: 'browse'; readonly listing: MarketListing; readonly onBuy: (listing: MarketListing) => void }
  | { readonly kind: 'mine'; readonly listing: MyMarketListing; readonly onCancel: (listing: MyMarketListing) => void }
  | { readonly kind: 'sell'; readonly listing: RosterView; readonly onSell: (mon: RosterView) => void };

export function MarketListingCard(props: CardMode): JSX.Element {
  const listing = props.listing;
  const template = listing.template;
  const element = template?.element ?? 'null';
  const stage = template?.stage ?? '—';
  const portrait = template?.assets.portrait ?? `/assets/digimon/${listing.catalogId}/portrait.webp`;
  const status = props.kind === 'mine' ? props.listing.status : null;
  const isMine = props.kind === 'browse' ? props.listing.isMine : props.kind === 'mine' && props.listing.status === 'active';

  return (
    <div className={isMine ? 'listing-card is-mine' : 'listing-card'} data-element={element}>
      <div className="rail" />
      {status === 'sold' ? <span className="status-badge sold">SOLD</span> : null}
      {status === 'canceled' ? <span className="status-badge canceled">CANCELED</span> : null}
      <div className="portrait">
        <img src={portrait} alt={listing.nickname} onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} />
      </div>
      <div className="body">
        <div className="name-row">
          <div className="name">{listing.nickname}</div>
          <span className="lvl">LV {listing.level}</span>
        </div>
        <div className="sub">
          <span>{stage}</span>
          <span className="el-tag">{element.toUpperCase()}</span>
        </div>
        {props.kind === 'browse' ? <div className="seller">Seller <b>{props.listing.seller.displayName}</b></div> : null}
        <div className="price-row">
          {props.kind === 'sell' ? <span className="market-card-note">Click to list</span> : <span className="price">{props.listing.price.toLocaleString()}</span>}
          <CardAction props={props} />
        </div>
      </div>
    </div>
  );
}

function CardAction({ props }: { readonly props: CardMode }): JSX.Element {
  switch (props.kind) {
    case 'browse':
      return <button className="card-btn" type="button" disabled={props.listing.isMine} title={props.listing.isMine ? 'You listed this' : undefined} onClick={() => props.onBuy(props.listing)}>Buy</button>;
    case 'mine':
      return props.listing.status === 'active'
        ? <button className="card-btn danger" type="button" onClick={() => props.onCancel(props.listing)}>Cancel</button>
        : <span className="market-card-note">{props.listing.status}</span>;
    case 'sell':
      return <button className="card-btn" type="button" onClick={() => props.onSell(props.listing)}>List →</button>;
  }
}
