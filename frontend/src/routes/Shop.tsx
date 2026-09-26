import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { ApplyDialog } from '../components/shop/ApplyDialog';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../hooks/useLocale';
import { getRoster } from '../lib/api';
import { applyShopItem, buyShopItem, buyBundle, coinClass, getShop } from '../lib/api-shop';
import type { InventoryItemView, ShopItemView, BundleView } from '../lib/api-shop';
import { ApiError } from '../lib/api';
import '../styles/extensions-shop.css';
import '../styles/extensions-premium.css';

const SHOP_QUERY_KEY = ['shop'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function Thumb({ item }: { readonly item: ShopItemView }): JSX.Element {
  if (item.sprite) {
    return (
      <div className="thumb">
        <img 
          src={`https://api.skullbot.fr/img/digimon/dot/${item.sprite}.png`} 
          alt="" 
          onError={(e) => {
            const target = e.currentTarget;
            const span = document.createElement('span');
            span.className = 'mono';
            span.textContent = item.mono || item.name[0] || '?';
            target.replaceWith(span);
          }} 
        />
      </div>
    );
  }
  return <div className="thumb"><span className="mono">{item.mono || item.name[0]}</span></div>;
}

function PriceLine({ item }: { readonly item: ShopItemView }): JSX.Element {
  return (
    <span className={`price ${coinClass(item.currency)}`}>
      <span className="coin" />{fmt(item.price)}
    </span>
  );
}

function BundleThumb({ bundle }: { readonly bundle: BundleView }): JSX.Element {
  const firstItem = bundle.items[0];
  if (firstItem?.sprite) {
    return (
      <div className="thumb">
        <img 
          src={`https://api.skullbot.fr/img/digimon/dot/${firstItem.sprite}.png`} 
          alt="" 
          onError={(e) => {
            const target = e.currentTarget;
            const span = document.createElement('span');
            span.className = 'mono';
            span.textContent = firstItem.mono || bundle.name[0] || '?';
            target.replaceWith(span);
          }} 
        />
      </div>
    );
  }
  return <div className="thumb"><span className="mono">{firstItem?.mono || bundle.name[0]}</span></div>;
}

export function Shop(): JSX.Element {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const shopQuery = useQuery({ queryKey: SHOP_QUERY_KEY, queryFn: getShop });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster, enabled: false });
  
  const [activeCat, setActiveCat] = useState<string>('all');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<ShopItemView | null>(null);
  const [successItem, setSuccessItem] = useState<ShopItemView | null>(null);
  const [confirmBundle, setConfirmBundle] = useState<BundleView | null>(null);
  const [successBundle, setSuccessBundle] = useState<BundleView | null>(null);
  const [applyingItem, setApplyingItem] = useState<InventoryItemView | null>(null);

  const data = shopQuery.data;
  const featured = data?.featured ?? null;
  const quickOffers = data?.quick ?? [];
  const catalog = data?.catalog ?? [];
  const bundles = data?.bundles ?? [];
  const categories = data?.categories ?? [];
  const wallet = data?.wallet ?? { credits: 0, netcore: 0, premiumUntil: null };
  const inventory = data?.inventory ?? [];
  const premiumActive = (wallet.premiumUntil ?? 0) > Date.now();

  const filteredCatalog = useMemo(() => {
    if (activeCat === 'all') return catalog;
    return catalog.filter((item) => item.shopCategory === activeCat);
  }, [activeCat, catalog]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (toastMsg) {
      t = setTimeout(() => setToastMsg(null), 2200);
    }
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmItem(null);
        setSuccessItem(null);
        setConfirmBundle(null);
        setSuccessBundle(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const invalidateShop = (): void => {
    void queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY });
  };

  const buyMutation = useMutation({
    mutationFn: ({ itemId, qty }: { readonly itemId: string; readonly qty: number }) => buyShopItem(itemId, qty),
    onSuccess: (_result, variables) => {
      invalidateShop();
      setConfirmItem(null);
      const item = catalog.find(i => i.id === variables.itemId) || (featured?.id === variables.itemId ? featured : quickOffers.find(i => i.id === variables.itemId));
      if (item) {
        setSuccessItem(item);
        setToastMsg(`${item.name} comprado ✓`);
      }
    },
    onError: (err: unknown) => {
      setConfirmItem(null);
      if (err instanceof ApiError) {
        if (err.status === 402) setToastMsg('Saldo insuficiente');
        else if (err.status === 403) setToastMsg('Item não disponível para compra');
        else if (err.status === 404) setToastMsg('Item não encontrado');
        else if (err.status === 409) setToastMsg('Você já possui este item');
        else setToastMsg(`Erro: ${err.message}`);
      } else {
        setToastMsg('Erro desconhecido');
      }
    }
  });

  const buyBundleMutation = useMutation({
    mutationFn: ({ bundleId }: { readonly bundleId: string }) => buyBundle(bundleId),
    onSuccess: (_result, variables) => {
      invalidateShop();
      setConfirmBundle(null);
      const bundle = bundles.find(b => b.id === variables.bundleId);
      if (bundle) {
        setSuccessBundle(bundle);
        setToastMsg(`${bundle.name} comprado ✓`);
      }
    },
    onError: (err: unknown) => {
      setConfirmBundle(null);
      if (err instanceof ApiError) {
        if (err.status === 402) setToastMsg('Saldo insuficiente');
        else if (err.status === 404) setToastMsg('Pacote não encontrado');
        else if (err.status === 409) setToastMsg('Conflito na compra — tente novamente');
        else setToastMsg(`Erro: ${err.message}`);
      } else {
        setToastMsg('Erro desconhecido');
      }
    }
  });

  const applyMutation = useMutation({
    mutationFn: ({ itemId, monId }: { readonly itemId: string; readonly monId?: string }) => applyShopItem(itemId, monId),
    onSuccess: () => {
      setToastMsg('Item aplicado com sucesso ✓');
      setApplyingItem(null);
      invalidateShop();
    },
    onError: (err) => {
      if (err instanceof ApiError) setToastMsg(`Erro: ${err.message}`);
    }
  });

  const openApply = (itemId: string): void => {
    const item = inventory.find((entry) => entry.itemId === itemId) ?? null;
    setApplyingItem(item);
    void rosterQuery.refetch();
  };

  const attemptBuy = (item: ShopItemView) => {
    if (item.owned) return;
    const balance = item.currency === 'credits' ? wallet.credits : wallet.netcore;
    if (balance < item.price) {
      const curName = item.currency === 'credits' ? t('currency.credits') : t('currency.netcore');
      setToastMsg(`Saldo insuficiente · faltam ${fmt(item.price - balance)} ${curName}`);
      return;
    }
    setConfirmItem(item);
  };

  const attemptBuyBundle = (bundle: BundleView) => {
    const balance = bundle.currency === 'credits' ? wallet.credits : wallet.netcore;
    if (balance < bundle.discountedPrice) {
      const curName = bundle.currency === 'credits' ? t('currency.credits') : t('currency.netcore');
      setToastMsg(`Saldo insuficiente · faltam ${fmt(bundle.discountedPrice - balance)} ${curName}`);
      return;
    }
    setConfirmBundle(bundle);
  };

  return (
    <>
      <div className="mbar" data-od-id="shop-bar">
        <span className="mtitle">Tamer's Exchange</span>
        <div className="tabs" id="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={activeCat === 'all'} onClick={() => setActiveCat('all')}>{t('shop.category_all')}</button>
          {categories.map(cat => (
            <button key={cat} className="tab" role="tab" aria-selected={activeCat === cat} onClick={() => setActiveCat(cat)}>{cat}</button>
          ))}
        </div>
        <div className="wallet">
          <span className="bal">
            <span className="coin cred" />
            <span className="k">{t('currency.netcore')}</span>
            <span>{fmt(wallet.netcore)}</span>
          </span>
          <span className="bal">
            <span className="coin gem" />
            <span className="k">{t('currency.credits')}</span>
            <span>{fmt(wallet.credits)}</span>
          </span>
        </div>
      </div>

      {premiumActive && (
        <div className="prem-banner" style={{ margin: '14px 24px 0' }} role="status">
          <span className="ico">&#9733;</span>
          <span>
            <b>Premium ativo</b> — até {new Date((wallet.premiumUntil ?? 0)).toLocaleDateString('pt-BR')}. Seu bônus de{' '}
            <b>+50% em produção, XP e quests</b> está valendo. Não renovar na loja encerra os ganhos extras.
          </span>
        </div>
      )}

      <div className="feature" data-od-id="shop-feature">
        {featured ? (
          <article className="hero" data-od-id="shop-hero">
            <span className="ribbon">{t('shop.featured')}</span>
            <div className="htx">
              <span className="kick">{t('shop.featured')} · {featured.shopCategory || t('shop.special')}</span>
              <h2>{featured.name}</h2>
              <div className="perks">
                <div className="perk">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6L9 17l-5-5"/></svg>
                  {featured.description}
                </div>
              </div>
              <div className="cta">
                <PriceLine item={featured} />
                {inventory.find(i => i.itemId === featured.id && i.qty > 0) ? (
                  <button 
                    className="buy"
                    onClick={() => openApply(featured.id)}
                  >
                    {t('shop.apply_qty', { qty: String(inventory.find(i => i.itemId === featured.id)?.qty ?? 0) })}
                  </button>
                ) : (
                  <button 
                    className={`buy ${featured.owned ? 'owned' : ''}`} 
                    disabled={featured.owned || buyMutation.isPending}
                    onClick={() => attemptBuy(featured)}
                  >
                    {featured.owned ? t('shop.owned') : t('shop.buy')}
                  </button>
                )}
              </div>
            </div>
            <div className="hart">
              <Thumb item={featured} />
            </div>
          </article>
        ) : <div />}

        <div className="qside" data-od-id="shop-quick">
          <div className="qhd">{t('shop.quick_offers')}</div>
          {quickOffers.map(item => (
            <div className="qrow" key={item.id}>
              <Thumb item={item} />
              <div>
                <div className="nm">{item.name}</div>
                <div className="sub">{item.description}</div>
              </div>
              {inventory.find(i => i.itemId === item.id && i.qty > 0) ? (
                <button 
                  className="buy ghost"
                  onClick={() => openApply(item.id)}
                >
                  {t('shop.apply_qty', { qty: String(inventory.find(i => i.itemId === item.id)?.qty ?? 0) })}
                </button>
              ) : (
                <button 
                  className={`buy ghost ${item.owned ? 'owned' : ''}`} 
                  disabled={item.owned || buyMutation.isPending}
                  onClick={() => attemptBuy(item)}
                >
                  {item.owned ? t('shop.owned') : <PriceLine item={item} />}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {bundles.length > 0 && (
        <div className="bundle-section" data-od-id="shop-bundles">
          <div className="sechd">
            <h3>Pacotes</h3>
            <span className="cnt">{bundles.length} {bundles.length === 1 ? 'pacote' : 'pacotes'}</span>
          </div>
          {bundles.map(bundle => (
            <article className="bundle-card" key={bundle.id}>
              <BundleThumb bundle={bundle} />
              <div className="cinfo">
                <div className="cnm">{bundle.name}</div>
                <div className="csub">{bundle.description}</div>
                <div className="bundle-items">
                  {bundle.items.map(i => `${i.qty}× ${i.name}`).join(' · ')}
                </div>
              </div>
              <div className="foot">
                <div className="bundle-price-line">
                  <span className="bundle-price-strike">
                    <span className={`coin ${coinClass(bundle.currency)}`} />
                    {fmt(bundle.originalPrice)}
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 12, height: 12, color: 'var(--muted)' }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  <span className={`bundle-price-final ${coinClass(bundle.currency)}`}>
                    <span className="coin" />
                    {fmt(bundle.discountedPrice)}
                    <span className="discount-badge">-{bundle.discountPct}%</span>
                  </span>
                </div>
                <button 
                  className="buy" 
                  disabled={buyBundleMutation.isPending}
                  onClick={() => attemptBuyBundle(bundle)}
                >
                  Comprar Pacote
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="sechd">
        <h3>{t('shop.catalog')}</h3>
        <span className="cnt" id="cat-count">{filteredCatalog.length} {t('shop.items')}</span>
      </div>
      
      <div className="scroll" data-od-id="shop-scroll">
        <div className="grid" id="grid" data-od-id="shop-grid">
          {filteredCatalog.map(item => (
            <article className={`card${item.kind === 'premium' ? ' premium-card' : ''}`} key={item.id} data-od-id={`shop-card-${item.id}`}>
              <Thumb item={item} />
              <div className="cnm">{item.name}<span className="csub">{item.description}</span></div>
              <span className="tagpill">{item.kind === 'premium' ? '\u2605 Premium' : (item.shopCategory || 'Item')}</span>
              <div className="foot">
                <PriceLine item={item} />
                {inventory.find(i => i.itemId === item.id && i.qty > 0) ? (
                  <button 
                    className="buy ghost"
                    onClick={() => openApply(item.id)}
                  >
                    {t('shop.apply_qty', { qty: String(inventory.find(i => i.itemId === item.id)?.qty ?? 0) })}
                  </button>
                ) : (
                  <button 
                    className={`buy ghost ${item.owned ? 'owned' : ''}${item.kind === 'premium' ? ' premium-buy' : ''}`} 
                    disabled={item.owned || buyMutation.isPending}
                    onClick={() => attemptBuy(item)}
                  >
                    {item.owned ? t('shop.owned') : t('shop.buy')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className={`toast ${toastMsg ? 'show' : ''}`} role="status" aria-live="polite">
        {toastMsg}
      </div>

      {confirmItem && (
        <div className="cov show" role="dialog" aria-modal="true" aria-labelledby="cvTitle" onClick={(e) => { if (e.target === e.currentTarget) setConfirmItem(null); }}>
          <div className="cmodal">
            <div className="ek">Confirmar compra</div>
            <h3 id="cvTitle">{confirmItem.name}</h3>
            <div className="cline">
              <Thumb item={confirmItem} />
              <div className="cinfo">
                <div className="n">{confirmItem.name}</div>
                <div className="s">{confirmItem.description}</div>
              </div>
              <PriceLine item={confirmItem} />
            </div>
            <div className="cwallet">
              <div className="wr">
                <span>Saldo atual</span>
                <b>{fmt(confirmItem.currency === 'credits' ? wallet.credits : wallet.netcore)} {confirmItem.currency === 'credits' ? t('currency.credits') : t('currency.netcore')}</b>
              </div>
              <div className="wr">
                <span>Custo</span>
                <b>−{fmt(confirmItem.price)}</b>
              </div>
              <div className="wr after">
                <span>Saldo após compra</span>
                <b>{fmt((confirmItem.currency === 'credits' ? wallet.credits : wallet.netcore) - confirmItem.price)}</b>
              </div>
            </div>
            <div className="cactions">
              <button className="buy ghost" onClick={() => setConfirmItem(null)}>Cancelar</button>
              <button className="buy" onClick={() => buyMutation.mutate({ itemId: confirmItem.id, qty: 1 })} disabled={buyMutation.isPending}>
                {buyMutation.isPending ? 'Comprando...' : 'Confirmar compra'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBundle && (
        <div className="cov show" role="dialog" aria-modal="true" aria-labelledby="cbTitle" onClick={(e) => { if (e.target === e.currentTarget) setConfirmBundle(null); }}>
          <div className="cmodal">
            <div className="ek">Confirmar compra de pacote</div>
            <h3 id="cbTitle">{confirmBundle.name}</h3>
            <div className="cline">
              <BundleThumb bundle={confirmBundle} />
              <div className="cinfo">
                <div className="n">{confirmBundle.name}</div>
                <div className="s">{confirmBundle.items.map(i => `${i.qty}× ${i.name}`).join(' · ')}</div>
              </div>
              <span className={`price ${coinClass(confirmBundle.currency)}`}>
                <span className="coin" />{fmt(confirmBundle.discountedPrice)}
              </span>
            </div>
            <div className="cwallet">
              <div className="wr">
                <span>Saldo atual</span>
                <b>{fmt(confirmBundle.currency === 'credits' ? wallet.credits : wallet.netcore)} {confirmBundle.currency === 'credits' ? t('currency.credits') : t('currency.netcore')}</b>
              </div>
              <div className="wr">
                <span>Custo</span>
                <b>−{fmt(confirmBundle.discountedPrice)}</b>
              </div>
              <div className="wr after">
                <span>Saldo após compra</span>
                <b>{fmt((confirmBundle.currency === 'credits' ? wallet.credits : wallet.netcore) - confirmBundle.discountedPrice)}</b>
              </div>
            </div>
            <div className="cactions">
              <button className="buy ghost" onClick={() => setConfirmBundle(null)}>Cancelar</button>
              <button className="buy" onClick={() => buyBundleMutation.mutate({ bundleId: confirmBundle.id })} disabled={buyBundleMutation.isPending}>
                {buyBundleMutation.isPending ? 'Comprando...' : 'Confirmar compra'}
              </button>
            </div>
          </div>
        </div>
      )}

      {successItem && (
        <div className="cov show" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setSuccessItem(null); }}>
          <div className="cmodal">
            <div className="csuccess">
              <div className="badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h3>Compra concluída</h3>
              <p>{successItem.name} · {fmt(successItem.price)} {successItem.currency === 'credits' ? t('currency.credits') : t('currency.netcore')}<br/>{t('shop.acquired')}</p>
              <div className="cactions">
                <button className="buy" onClick={() => setSuccessItem(null)}>Continuar comprando</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {successBundle && (
        <div className="cov show" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setSuccessBundle(null); }}>
          <div className="cmodal">
            <div className="csuccess">
              <div className="badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h3>Pacote comprado</h3>
              <p>{successBundle.name} · {fmt(successBundle.discountedPrice)} {successBundle.currency === 'credits' ? t('currency.credits') : t('currency.netcore')}<br/>{t('shop.acquired')}</p>
              <div className="cactions">
                <button className="buy" onClick={() => setSuccessBundle(null)}>Continuar comprando</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {applyingItem && (
        <ApplyDialog 
          item={applyingItem} 
          roster={rosterQuery.data?.roster ?? []} 
          loading={rosterQuery.isFetching} 
          onClose={() => setApplyingItem(null)} 
          onApply={(monId) => { applyMutation.mutate({ itemId: applyingItem.itemId, monId }); }} 
        />
      )}
    </>
  );
}
