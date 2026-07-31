import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  cancelCoinOffer,
  fillCoinOffer,
  getCoinMarket,
  postCoinOffer,
  type CoinOffer,
} from '../../lib/api-coins';
import { Credits, NetCore } from '../common/DigiCredits';
import { ApiError } from '../../lib/api';

type CoinMarketProps = {
  readonly onSuccess: (message: string) => void;
  readonly onError: (error: Error) => void;
};

type FillDialogState = {
  readonly kind: 'fill';
  readonly offer: CoinOffer;
  readonly lots: string;
};

export function CoinMarket({ onSuccess, onError }: CoinMarketProps): JSX.Element {
  const queryClient = useQueryClient();
  const [formSide, setFormSide] = useState<'sell' | 'buy'>('sell');
  const [formLots, setFormLots] = useState<string>('1');
  const [formPrice, setFormPrice] = useState<string>('');
  const [fillDialog, setFillDialog] = useState<FillDialogState | null>(null);

  const query = useQuery({
    queryKey: ['market', 'coins'],
    queryFn: getCoinMarket,
  });

  const postMutation = useMutation({
    mutationFn: (args: { side: 'sell' | 'buy'; lots: number; pricePerLot: number }) =>
      postCoinOffer(args),
    onSuccess: () => {
      onSuccess('Offer posted successfully.');
      setFormLots('1');
      setFormPrice('');
      queryClient.invalidateQueries({ queryKey: ['market', 'coins'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'credits'] });
    },
    onError,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelCoinOffer(id),
    onSuccess: () => {
      onSuccess('Offer canceled.');
      queryClient.invalidateQueries({ queryKey: ['market', 'coins'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'credits'] });
    },
    onError,
  });

  const fillMutation = useMutation({
    mutationFn: ({ id, lots }: { id: string; lots: number }) => fillCoinOffer(id, lots),
    onSuccess: () => {
      onSuccess('Offer filled!');
      setFillDialog(null);
      queryClient.invalidateQueries({ queryKey: ['market', 'coins'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'credits'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['market', 'coins'] });
        onError(new Error('This offer was just taken or cancelled — refreshing.'));
      } else if (error instanceof ApiError && error.status === 402) {
        onError(new Error('Insufficient funds.'));
      } else if (error instanceof ApiError && error.status === 400 && (error.code === 'cannot-fill-own-offer' || error.message.includes('own'))) {
        onError(new Error('Cannot fill your own offer.'));
      } else {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  if (query.isPending) {
    return <div className="gridempty">Loading Coin Market...</div>;
  }
  if (query.isError || !query.data) {
    return <div className="gridempty">Failed to load Coin Market.</div>;
  }

  const { lotSize, sellOffers, buyOffers, myOffers, wallet, lastPrice } = query.data;

  const bestAsk = sellOffers.length > 0 ? (sellOffers[0]?.pricePerLot ?? null) : null;
  const bestBid = buyOffers.length > 0 ? (buyOffers[0]?.pricePerLot ?? null) : null;

  const parsedLots = parseInt(formLots, 10);
  const parsedPrice = parseInt(formPrice, 10);
  const validLots = Number.isInteger(parsedLots) && parsedLots >= 1;
  const validPrice = Number.isInteger(parsedPrice) && parsedPrice >= 1;
  const canSubmitPost = validLots && validPrice && !postMutation.isPending;

  const totalCredits = validLots ? parsedLots * lotSize : 0;
  const totalNetcore = validLots && validPrice ? parsedLots * parsedPrice : 0;
  
  let escrowText = '';
  if (canSubmitPost) {
    if (formSide === 'sell') {
      escrowText = `Posting this offer will immediately escrow ${totalCredits} Credits from your wallet.`;
    } else {
      escrowText = `Posting this offer will immediately escrow ${totalNetcore} NetCore from your wallet.`;
    }
  }

  const handleFill = () => {
    if (!fillDialog) return;
    const lotsToFill = parseInt(fillDialog.lots, 10);
    if (!Number.isInteger(lotsToFill) || lotsToFill < 1 || lotsToFill > fillDialog.offer.lotsRemaining) {
      return;
    }
    fillMutation.mutate({ id: fillDialog.offer.id, lots: lotsToFill });
  };

  const busy = postMutation.isPending || cancelMutation.isPending || fillMutation.isPending;

  return (
    <div className="gridwrap" style={{ gridColumn: '1 / -1', padding: '0 24px 26px' }}>
      <div className="coin-market-header">
        <div className="cm-hints">
          <div className="cm-hint-box">
            <div className="cm-hint-label">Last Price</div>
            <div className="cm-hint-val">{lastPrice !== null ? `${lastPrice.toLocaleString()} NTC` : '—'}</div>
          </div>
          <div className="cm-hint-box">
            <div className="cm-hint-label">Best Ask (Sell)</div>
            <div className="cm-hint-val">{bestAsk !== null ? `${bestAsk.toLocaleString()} NTC` : '—'}</div>
          </div>
          <div className="cm-hint-box">
            <div className="cm-hint-label">Best Bid (Buy)</div>
            <div className="cm-hint-val">{bestBid !== null ? `${bestBid.toLocaleString()} NTC` : '—'}</div>
          </div>
        </div>
      </div>

      <div className="coin-market-layout">
        <div className="cm-col">
          <div className="cm-col-head">Sell Offers <span>(Players selling Credits)</span></div>
          <div className="cm-book">
            {sellOffers.length === 0 && <div className="cm-empty">No sell offers.</div>}
            {sellOffers.map((offer) => (
              <div key={offer.id} className={`cm-row ${offer.isMine ? 'mine' : ''}`}>
                <div className="cm-row-info">
                  <div className="cm-row-seller">{offer.sellerName} {offer.isMine && <b>(You)</b>}</div>
                  <div className="cm-row-lots">{offer.lotsRemaining} lot{offer.lotsRemaining === 1 ? '' : 's'} remaining</div>
                </div>
                <div className="cm-row-price">
                  <div className="cm-price-per">{offer.pricePerLot.toLocaleString()} NTC/lot</div>
                  <div className="cm-price-tot">Total: {offer.totalNetcore.toLocaleString()} NTC</div>
                </div>
                <button
                  className="cm-fill-btn"
                  disabled={offer.isMine || busy}
                  onClick={() => setFillDialog({ kind: 'fill', offer, lots: '1' })}
                >
                  Buy
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="cm-col">
          <div className="cm-col-head">Buy Offers <span>(Players buying Credits)</span></div>
          <div className="cm-book">
            {buyOffers.length === 0 && <div className="cm-empty">No buy offers.</div>}
            {buyOffers.map((offer) => (
              <div key={offer.id} className={`cm-row ${offer.isMine ? 'mine' : ''}`}>
                <div className="cm-row-info">
                  <div className="cm-row-seller">{offer.sellerName} {offer.isMine && <b>(You)</b>}</div>
                  <div className="cm-row-lots">{offer.lotsRemaining} lot{offer.lotsRemaining === 1 ? '' : 's'} remaining</div>
                </div>
                <div className="cm-row-price">
                  <div className="cm-price-per">{offer.pricePerLot.toLocaleString()} NTC/lot</div>
                  <div className="cm-price-tot">Total: {offer.totalNetcore.toLocaleString()} NTC</div>
                </div>
                <button
                  className="cm-fill-btn"
                  disabled={offer.isMine || busy}
                  onClick={() => setFillDialog({ kind: 'fill', offer, lots: '1' })}
                >
                  Sell
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="cm-col cm-sidebar">
          <div className="cm-post-form card">
            <div className="chead" style={{ gridTemplateColumns: '1fr' }}>
              <div className="nm">Post an Offer</div>
              <div className="sub">1 Lot = {lotSize} Credits</div>
            </div>
            
            <div className="cm-form-tabs">
              <button 
                className={`cm-form-tab ${formSide === 'sell' ? 'on' : ''}`}
                onClick={() => setFormSide('sell')}
              >
                Sell Credits
              </button>
              <button 
                className={`cm-form-tab ${formSide === 'buy' ? 'on' : ''}`}
                onClick={() => setFormSide('buy')}
              >
                Buy Credits
              </button>
            </div>

            <div className="cm-field">
              <label>Number of Lots</label>
              <input 
                type="number" 
                min="1" 
                value={formLots} 
                onChange={(e) => setFormLots(e.target.value)} 
                className="fnum" 
              />
              {validLots && <div className="cm-field-hint">= {totalCredits.toLocaleString()} Credits</div>}
            </div>

            <div className="cm-field">
              <label>Price per Lot (NTC)</label>
              <input 
                type="number" 
                min="1" 
                value={formPrice} 
                onChange={(e) => setFormPrice(e.target.value)} 
                className="fnum" 
                placeholder="e.g. 500"
              />
            </div>

            {validLots && validPrice && (
              <div className="cm-summary">
                <div>Total Exchange:</div>
                <div className="cm-summary-val">{totalCredits.toLocaleString()} CR ⇄ {totalNetcore.toLocaleString()} NTC</div>
                <div className="cm-escrow-warn">{escrowText}</div>
              </div>
            )}

            <button 
              className="buybtn" 
              disabled={!canSubmitPost}
              onClick={() => postMutation.mutate({ side: formSide, lots: parsedLots, pricePerLot: parsedPrice })}
            >
              Post Offer
            </button>
          </div>

          <div className="cm-my-offers card">
            <div className="chead" style={{ gridTemplateColumns: '1fr' }}>
              <div className="nm">My Open Offers</div>
              <div className="sub">Cancelling returns unfilled escrow</div>
            </div>
            {myOffers.length === 0 && <div className="cm-empty-mine">No active offers.</div>}
            <div className="cm-my-offers-list">
              {myOffers.map((offer) => (
                <div key={offer.id} className="cm-my-offer-row">
                  <div className="cm-my-offer-side">{offer.side === 'sell' ? 'Selling CR' : 'Buying CR'}</div>
                  <div className="cm-my-offer-det">
                    {offer.lotsRemaining} lot{offer.lotsRemaining !== 1 && 's'} @ {offer.pricePerLot.toLocaleString()} NTC
                  </div>
                  <button 
                    className="cancelbtn" 
                    disabled={busy}
                    onClick={() => cancelMutation.mutate(offer.id)}
                    style={{ padding: '6px', fontSize: '9px' }}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {fillDialog && (
        <div className="drawer open" role="dialog" aria-modal="true" aria-labelledby="fill-drawer-title">
          <div className="scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) setFillDialog(null); }} />
          <div className="dpanel">
            <div className="dhead">
              <div>
                <div className="dk">Fill Offer</div>
                <h2 id="fill-drawer-title">{fillDialog.offer.side === 'sell' ? 'Buy Credits' : 'Sell Credits'}</h2>
              </div>
              <button className="dclose" type="button" aria-label="Close" onClick={() => setFillDialog(null)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
            <div className="dbody">
              <div className="cm-fill-info">
                <div className="cm-fill-seller">Offer from <b>{fillDialog.offer.sellerName}</b></div>
                <div className="cm-fill-price">{fillDialog.offer.pricePerLot.toLocaleString()} NTC per lot</div>
                <div className="cm-fill-rem">{fillDialog.offer.lotsRemaining} lot(s) available</div>
              </div>
              
              <div className="field">
                <div className="flabel"><span>Lots to Fill</span><b>max {fillDialog.offer.lotsRemaining}</b></div>
                <label className="priceinput">
                  <input
                    type="number"
                    min="1"
                    max={fillDialog.offer.lotsRemaining}
                    value={fillDialog.lots}
                    onChange={(e) => setFillDialog({ ...fillDialog, lots: e.target.value })}
                  />
                </label>
              </div>

              {(() => {
                const flots = parseInt(fillDialog.lots, 10);
                const fok = Number.isInteger(flots) && flots >= 1 && flots <= fillDialog.offer.lotsRemaining;
                if (!fok) return null;
                
                const cTransfer = flots * lotSize;
                const nTransfer = flots * fillDialog.offer.pricePerLot;
                
                return (
                  <div className="cm-fill-exchange">
                    <div className="cm-fill-pays">
                      You will pay:
                      {fillDialog.offer.side === 'sell' ? (
                        <div style={{ marginTop: '8px' }}><NetCore value={nTransfer} /></div>
                      ) : (
                        <div style={{ marginTop: '8px' }}><Credits value={cTransfer} /></div>
                      )}
                    </div>
                    <div className="cm-fill-gets">
                      You will receive:
                      {fillDialog.offer.side === 'sell' ? (
                        <div style={{ marginTop: '8px' }}><Credits value={cTransfer} /></div>
                      ) : (
                        <div style={{ marginTop: '8px' }}><NetCore value={nTransfer} /></div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="dfoot">
              <span className="dhint">
                {(() => {
                  const flots = parseInt(fillDialog.lots, 10);
                  if (!Number.isInteger(flots) || flots < 1) return 'Enter a valid number of lots.';
                  if (flots > fillDialog.offer.lotsRemaining) return 'Not enough lots available.';
                  return 'This transaction is final and immediate.';
                })()}
              </span>
              <button 
                className="btn" 
                type="button" 
                disabled={
                  busy || 
                  !Number.isInteger(parseInt(fillDialog.lots, 10)) || 
                  parseInt(fillDialog.lots, 10) < 1 || 
                  parseInt(fillDialog.lots, 10) > fillDialog.offer.lotsRemaining
                } 
                onClick={handleFill}
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}