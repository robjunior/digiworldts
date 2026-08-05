import type { RosterView } from '../../lib/api';
import type { MarketListing, MyMarketListing } from '../../lib/api-market';
import { perStatTrainingProgress } from '../roster/types';

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
  const isMine = props.kind === 'browse' ? props.listing.isMine : props.kind === 'mine';

  const training = perStatTrainingProgress(listing);

  return (
    <article
      className={`card ${isMine ? 'mine' : ''}`}
      style={{ '--ac': `var(--el-${element})` } as React.CSSProperties}
    >
      <div className="chead">
        <span className="art">
          <img src={portrait} alt={listing.nickname} onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} />
        </span>
        <div>
          <div className="nm">{listing.nickname}</div>
          <div className="sub">
            <span className="dot" />
            {element} · Lv {listing.level} · {stage}
          </div>
        </div>
      </div>

      {training ? (
        <div className="statgrid">
          <div className="stat"><div className="sk">HP</div><div className={`sv ${training.hp.filled > 0 ? 'pos' : ''}`}>{training.hp.filled}/{training.hp.cap}</div></div>
          <div className="stat"><div className="sk">EN</div><div className={`sv ${training.en.filled > 0 ? 'pos' : ''}`}>{training.en.filled}/{training.en.cap}</div></div>
          <div className="stat"><div className="sk">ATK</div><div className={`sv ${training.atk.filled > 0 ? 'pos' : ''}`}>{training.atk.filled}/{training.atk.cap}</div></div>
          <div className="stat"><div className="sk">DEF</div><div className={`sv ${training.def.filled > 0 ? 'pos' : ''}`}>{training.def.filled}/{training.def.cap}</div></div>
          <div className="stat"><div className="sk">INT</div><div className={`sv ${training.int.filled > 0 ? 'pos' : ''}`}>{training.int.filled}/{training.int.cap}</div></div>
          <div className="stat"><div className="sk">SPD</div><div className={`sv ${training.spd.filled > 0 ? 'pos' : ''}`}>{training.spd.filled}/{training.spd.cap}</div></div>
        </div>
      ) : null}

      <div className="cfoot">
        <div className="priced">
          {props.kind === 'sell' ? (
            <span className="pw">List for sale</span>
          ) : (
            <span className="pw">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
              </svg>
              {props.listing.price.toLocaleString()}
            </span>
          )}
          {props.kind === 'browse' ? (
            <span className="seller">by <b>{props.listing.seller.displayName}</b></span>
          ) : null}
        </div>
        <CardAction props={props} />
      </div>
    </article>
  );
}

function CardAction({ props }: { readonly props: CardMode }): JSX.Element {
  switch (props.kind) {
    case 'browse':
      return (
        <button className="buybtn" type="button" disabled={props.listing.isMine} title={props.listing.isMine ? 'You listed this' : undefined} onClick={() => props.onBuy(props.listing)}>
          Buy
        </button>
      );
    case 'mine':
      return props.listing.status === 'active' ? (
        <button className="cancelbtn" type="button" onClick={() => props.onCancel(props.listing)}>
          Cancel listing
        </button>
      ) : (
        <div className="needhint">{props.listing.status.toUpperCase()}</div>
      );
    case 'sell':
      return (
        <button className="buybtn" type="button" onClick={() => props.onSell(props.listing)}>
          List →
        </button>
      );
  }
}
