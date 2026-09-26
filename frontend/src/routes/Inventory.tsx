import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { ApplyDialog } from '../components/shop/ApplyDialog';
import { RarityBadge } from '../components/inventory/RarityBadge';
import { getRoster } from '../lib/api';
import { ApiError } from '../lib/api';
import { applyShopItem, getShop } from '../lib/api-shop';
import type { InventoryItemView } from '../lib/api-shop';
import '../styles/extensions-inventory.css';

const SHOP_QUERY_KEY = ['shop'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;
const SEEN_KEY = 'dw:inv:seen:v1';

type InvCat = 'consumable' | 'chip' | 'egg' | 'cosmetic' | 'material';
type Cat = 'all' | InvCat;
type SortBy = 'cat' | 'qty_desc' | 'qty_asc' | 'name' | 'val_desc';

const CAT_LIST: readonly Cat[] = ['all', 'consumable', 'chip', 'egg', 'cosmetic', 'material'];

const CAT_LBL: Readonly<Record<Cat, string>> = {
  all: 'Todos os itens',
  consumable: 'Consumíveis',
  chip: 'Chips',
  egg: 'Ovos',
  cosmetic: 'Cosméticos',
  material: 'Materiais',
};

const CAT_TAG: Readonly<Record<InvCat, string>> = {
  consumable: 'Consumível',
  chip: 'Chip',
  egg: 'Ovo',
  cosmetic: 'Cosmético',
  material: 'Material',
};

const CAT_ORDER: Readonly<Record<InvCat, number>> = {
  consumable: 0,
  chip: 1,
  egg: 2,
  cosmetic: 3,
  material: 4,
};

// Rail-color tint per category — mirrors ELT{} in the mockup. Uses --signal
// mixed with --ink so we stay inside the registered palette (no new hex).
const CAT_RAIL: Readonly<Record<InvCat, string>> = {
  consumable: 'color-mix(in oklab, var(--signal) 70%, var(--ink))',
  chip: 'color-mix(in oklab, var(--signal) 45%, var(--ink))',
  egg: 'var(--signal)',
  cosmetic: 'color-mix(in oklab, var(--signal) 30%, var(--ink))',
  material: 'color-mix(in oklab, var(--signal) 22%, var(--ink))',
};

/**
 * Classify an inventory item into one of the mockup's five categories.
 * Priority order (load-bearing — reordering changes classification):
 * egg → cosmetic → shop-catalog kind (consumable/revive/xp_mult/evolve)
 * → name+description heuristics → fallback material.
 *
 * Backend has no unified /inventory endpoint, so drop-only items
 * (Energy Drink, Guard Chip, Status Cure, …) don't appear in the shop
 * catalog and shopKind is null for them — the heuristics catch those.
 */
function classify(item: InventoryItemView, shopKind: string | null): InvCat {
  const nameId = `${item.itemId} ${item.name}`.toLowerCase();
  const desc = item.description.toLowerCase();

  if (nameId.includes('egg')) return 'egg';

  if (
    shopKind === 'cosmetic' ||
    nameId.includes('skin') ||
    nameId.includes('badge') ||
    nameId.includes('emblema') ||
    nameId.includes('frame') ||
    desc.includes('cosmetic')
  ) return 'cosmetic';

  if (shopKind === 'consumable' || shopKind === 'revive' || shopKind === 'xp_mult') return 'consumable';

  // Only digivolve chips land in the "chip" bucket. Combat-buff items
  // NAMED "chip" (Guard/Power) are consumables and hit the heuristic below.
  if (shopKind === 'evolve') return 'chip';

  const consumableHints = [
    'heal', 'revive', 'med-kit', 'med kit', 'medkit', 'potion', 'poção',
    'provision', 'boost', 'drink', 'cure', 'wake', 'refill',
  ];
  const combatUseHints = [
    'in combat', 'current match', 'pve only', 'use from',
    'ailment', 'from its recovery',
  ];
  if (consumableHints.some((h) => nameId.includes(h))) return 'consumable';
  if (combatUseHints.some((h) => desc.includes(h))) return 'consumable';

  if (
    nameId.includes('med chip') ||
    nameId.includes('rare chip') ||
    nameId.includes('training chip') ||
    nameId.includes('chip de')
  ) return 'chip';

  return 'material';
}

function iconSvgFor(cat: InvCat, itemId: string): JSX.Element {
  const id = itemId.toLowerCase();
  if (id.includes('revive')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" />
      </svg>
    );
  }
  if (id.includes('heal') || id.includes('potion') || id.includes('cura')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (id.includes('xp') || id.includes('boost')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M12 3l3 6 6 .8-4.5 4.2L18 21l-6-3.4L6 21l1.5-7L3 9.8 9 9z" />
      </svg>
    );
  }
  if (id.includes('provision')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M6 3h12l-1 7H7z" />
        <path d="M7 10v10h10V10" />
      </svg>
    );
  }
  if (cat === 'chip') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <rect x="6" y="6" width="12" height="12" rx="1" />
        <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
      </svg>
    );
  }
  if (cat === 'egg') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M12 3c4 0 7 5 7 10a7 7 0 0 1-14 0c0-5 3-10 7-10z" />
      </svg>
    );
  }
  if (cat === 'cosmetic') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M12 2l2.5 5.5L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M12 12l9-5M12 12v10M12 12L3 7" />
    </svg>
  );
}

type EnrichedItem = InventoryItemView & {
  readonly cat: InvCat;
  readonly val: number;
  readonly sprite: string | null;
  readonly kind: string | null;
};

function describeEffect(it: EnrichedItem): string {
  const nameId = `${it.itemId} ${it.name}`.toLowerCase();
  const desc = it.description.toLowerCase();

  if (it.kind === 'revive' || nameId.includes('revive')) return 'Revive · alvo único';
  if (it.kind === 'xp_mult' || nameId.includes('xp mult') || nameId.includes('boost')) return 'XP multiplicado · party';

  if (it.cat === 'consumable') {
    if (nameId.includes('heal') || nameId.includes('cura') || nameId.includes('potion') || nameId.includes('med-kit') || nameId.includes('medkit')) return 'Restaura HP · alvo único';
    if (nameId.includes('energy') || nameId.includes('en drink') || nameId.includes('refill')) return 'Restaura EN · alvo único';
    if (nameId.includes('provision')) return 'Recurso de expedição';
    if (nameId.includes('cure') || desc.includes('ailment')) return 'Remove ailments · alvo único';
    if (nameId.includes('guard') || desc.includes('def for')) return '+15 DEF por partida';
    if (nameId.includes('power') || desc.includes('atk for')) return '+15 ATK por partida';
    return 'Efeito de combate';
  }
  if (it.cat === 'cosmetic') return 'Item cosmético';
  if (it.cat === 'chip') return it.kind === 'evolve' ? 'Requisito de digivolução' : 'Chip de crafting';
  if (it.cat === 'egg') return 'Choca na Nursery';
  if (it.cat === 'material') return 'Material de craft';
  return '—';
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

// ---------------------------------------------------------------------------
// "Seen" tracking — drives the NEW badge. An item is NEW until the player has
// acknowledged it (hover / long-press / open detail). Persisted in localStorage
// so items added between sessions surface as new on next visit.
// ---------------------------------------------------------------------------
function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

type PopoverAnchor = {
  id: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
};

const POP_W = 268;
const POP_EST_H = 250;

export function Inventory(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shopQuery = useQuery({ queryKey: SHOP_QUERY_KEY, queryFn: getShop });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster, enabled: false });

  const [cat, setCat] = useState<Cat>('all');
  const [sortBy, setSortBy] = useState<SortBy>('cat');
  const [query, setQuery] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [applyingItem, setApplyingItem] = useState<InventoryItemView | null>(null);
  const [popover, setPopover] = useState<PopoverAnchor | null>(null);

  const seenRef = useRef<Set<string>>(readSeen());
  const hideTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const inventory = shopQuery.data?.inventory ?? [];
  const catalog = shopQuery.data?.catalog ?? [];
  const wallet = shopQuery.data?.wallet ?? { credits: 0, netcore: 0 };

  const enriched: readonly EnrichedItem[] = useMemo(() => {
    const rows: EnrichedItem[] = [];
    for (const item of inventory) {
      if (item.qty <= 0) continue;
      const shopMatch = catalog.find((c) => c.id === item.itemId) ?? null;
      const shopKind = shopMatch?.kind ?? null;
      rows.push({
        ...item,
        cat: classify(item, shopKind),
        val: shopMatch?.price ?? 0,
        sprite: shopMatch?.sprite ?? null,
        kind: shopKind,
      });
    }
    return rows;
  }, [inventory, catalog]);

  // Items present in the inventory but never acknowledged → NEW badge.
  const newIds = useMemo(() => {
    const s = seenRef.current;
    const set = new Set<string>();
    for (const it of enriched) if (!s.has(it.itemId)) set.add(it.itemId);
    return set;
  }, [enriched]);

  const counts: Readonly<Record<Cat, number>> = useMemo(() => {
    const map: Record<Cat, number> = {
      all: enriched.length,
      consumable: 0,
      chip: 0,
      egg: 0,
      cosmetic: 0,
      material: 0,
    };
    for (const it of enriched) map[it.cat] += 1;
    return map;
  }, [enriched]);

  const filtered: readonly EnrichedItem[] = useMemo(() => {
    let rows = enriched;
    if (cat !== 'all') rows = rows.filter((i) => i.cat === cat);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((i) => (i.name + ' ' + i.description).toLowerCase().includes(q));
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortBy === 'qty_desc') return b.qty - a.qty;
      if (sortBy === 'qty_asc') return a.qty - b.qty;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'val_desc') return b.val - a.val;
      return (CAT_ORDER[a.cat] - CAT_ORDER[b.cat]) || a.name.localeCompare(b.name);
    });
    return sorted;
  }, [enriched, cat, query, sortBy]);

  const anyFilter = cat !== 'all' || query.length > 0 || sortBy !== 'cat';

  useEffect(() => {
    if (!toastMsg) return undefined;
    const t = setTimeout(() => setToastMsg(null), 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setDetailId(null);
        setPopover(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Close the hover card when the grid scrolls under it (anchored by rect).
  useEffect(() => {
    if (!popover) return undefined;
    const close = (): void => setPopover(null);
    const scroller = document.querySelector('[data-od-id="inventory-scroll"]');
    scroller?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      scroller?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [popover]);

  const markSeen = useCallback((id: string): void => {
    if (seenRef.current.has(id)) return;
    seenRef.current.add(id);
    persistSeen(seenRef.current);
  }, []);

  const applyMutation = useMutation({
    mutationFn: ({ itemId, monId }: { readonly itemId: string; readonly monId?: string }) =>
      applyShopItem(itemId, monId),
    onSuccess: (_res, vars) => {
      const it = enriched.find((i) => i.itemId === vars.itemId);
      setToastMsg(it ? `${it.name} usado ✓` : 'Item usado ✓');
      setApplyingItem(null);
      setDetailId(null);
      setPopover(null);
      void queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY });
    },
    onError: (err: unknown) => {
      setApplyingItem(null);
      if (err instanceof ApiError) setToastMsg(`Erro: ${err.message}`);
      else setToastMsg('Erro ao usar item');
    },
  });

  const openUse = (item: EnrichedItem): void => {
    if (item.cat !== 'consumable') return;
    // xp_mult is player-wide, no mon selection needed. Everything else needs a target.
    if (item.kind === 'xp_mult') {
      applyMutation.mutate({ itemId: item.itemId });
      return;
    }
    setApplyingItem(item);
    void rosterQuery.refetch();
  };

  const openSell = (item: EnrichedItem): void => {
    setToastMsg(`Abrindo o Market para vender ${item.name}…`);
    setTimeout(() => navigate('/market'), 700);
  };

  const clearFilters = (): void => {
    setCat('all');
    setQuery('');
    setSortBy('cat');
  };

  // --- Hover / long-press item card -----------------------------------------
  const clearHideTimer = (): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = (): void => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => setPopover(null), 140);
  };
  const showPopover = (id: string, el: HTMLElement): void => {
    clearHideTimer();
    markSeen(id);
    const r = el.getBoundingClientRect();
    setPopover({ id, top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width });
  };

  useEffect(() => () => {
    clearHideTimer();
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
  }, []);

  const detailItem = detailId ? enriched.find((i) => i.itemId === detailId) ?? null : null;
  const popItem = popover ? enriched.find((i) => i.itemId === popover.id) ?? null : null;

  // Position the popover above (or below, if no room) the anchor cell.
  const popStyle: CSSProperties | undefined = (() => {
    if (!popover) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const anchorX = popover.left + popover.width / 2;
    let left = anchorX - POP_W / 2;
    left = Math.max(8, Math.min(left, vw - POP_W - 8));
    const above = popover.top - POP_EST_H - 12 > 8;
    const pos: CSSProperties = { left, width: POP_W };
    if (above) pos.bottom = vh - popover.top + 12;
    else pos.top = popover.bottom + 12;
    return pos;
  })();
  const popArrowX = popover
    ? Math.max(14, Math.min(POP_W - 14, popover.left + popover.width / 2 - (popStyle?.left as number ?? 0)))
    : 0;

  return (
    <>
      <div className="mbar" data-od-id="inventory-bar">
        <span className="mtitle">Inventário</span>
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Buscar item…"
            autoComplete="off"
            aria-label="Buscar item"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="sel"
          aria-label="Ordenar"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="cat">Categoria</option>
          <option value="qty_desc">Quantidade ↓</option>
          <option value="qty_asc">Quantidade ↑</option>
          <option value="name">Nome A–Z</option>
          <option value="val_desc">Valor ↓</option>
        </select>
        {anyFilter && (
          <button type="button" className="clearf" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
        <div className="wallet">
          <span className="bal">
            <span className="coin cred" />
            <span className="k">Créditos</span>
            <span>{fmt(wallet.credits)}</span>
          </span>
          <span className="bal">
            <span className="coin net" />
            <span className="k">NetCore</span>
            <span>{fmt(wallet.netcore)}</span>
          </span>
        </div>
      </div>

      <div className="cats" role="tablist" data-od-id="inventory-cats">
        {CAT_LIST.map((c) => (
          <button
            key={c}
            type="button"
            className="cat"
            role="tab"
            aria-selected={c === cat}
            onClick={() => setCat(c)}
          >
            {CAT_LBL[c]}
            <span className="c-n">{counts[c]}</span>
          </button>
        ))}
      </div>

      <div className="sechd">
        <h3>{CAT_LBL[cat]}</h3>
        <span className="cnt">
          {filtered.length} {filtered.length === 1 ? 'item' : 'itens'}
        </span>
      </div>

      <div className="scroll" data-od-id="inventory-scroll">
        {shopQuery.isPending ? (
          <div className="empty-line">Carregando inventário…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-line">
            {enriched.length === 0 ? (
              <>
                Sem itens no inventário.
                <br />
                Ganhe drops em combate, colha na Farm ou compre na Loja.
              </>
            ) : (
              <>
                Nenhum item corresponde a estes filtros.
                <br />
                Ajuste a busca ou limpe os filtros.
              </>
            )}
          </div>
        ) : (
          <div className="inv-grid" role="grid" data-od-id="inventory-grid">
            {filtered.map((it) => {
              const usable = it.cat === 'consumable';
              const isNew = newIds.has(it.itemId);
              const style: CSSProperties = { ['--el' as string]: CAT_RAIL[it.cat] };
              return (
                <button
                  key={it.itemId}
                  type="button"
                  className={`inv-cell${isNew ? ' is-new' : ''}`}
                  style={style}
                  data-od-id={`inv-${it.itemId}`}
                  aria-label={`${it.name} ×${fmt(it.qty)}${isNew ? ' (novo)' : ''}`}
                  onClick={(e) => {
                    if (longPressedRef.current) {
                      longPressedRef.current = false;
                      e.preventDefault();
                      return;
                    }
                    setDetailId(it.itemId);
                  }}
                  onMouseEnter={(e) => showPopover(it.itemId, e.currentTarget)}
                  onMouseLeave={scheduleHide}
                  onFocus={(e) => showPopover(it.itemId, e.currentTarget)}
                  onBlur={scheduleHide}
                  onTouchStart={(e) => {
                    longPressedRef.current = false;
                    const el = e.currentTarget;
                    holdTimer.current = window.setTimeout(
                      () => {
                        longPressedRef.current = true;
                        showPopover(it.itemId, el);
                      },
                      380,
                    );
                  }}
                  onTouchEnd={() => {
                    if (holdTimer.current !== null) {
                      window.clearTimeout(holdTimer.current);
                      holdTimer.current = null;
                    }
                  }}
                  onTouchMove={() => {
                    if (holdTimer.current !== null) {
                      window.clearTimeout(holdTimer.current);
                      holdTimer.current = null;
                    }
                  }}
                >
                  {isNew && <span className="inv-new">NOVO</span>}
                  <span className="inv-cat">{CAT_TAG[it.cat]}</span>
                  <span className="inv-ico" aria-hidden="true">
                    {it.sprite ? (
                      <img
                        src={`https://api.skullbot.fr/img/digimon/dot/${it.sprite}.png`}
                        alt=""
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.replaceWith(document.createTextNode(''));
                        }}
                      />
                    ) : (
                      iconSvgFor(it.cat, it.itemId)
                    )}
                  </span>
                  <span className="inv-name">
                    {it.name}
                    <RarityBadge rarity={it.rarity} />
                  </span>
                  <span className="inv-qty">
                    <span className="x">×</span>
                    {fmt(it.qty)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={`toast ${toastMsg ? 'show' : ''}`} role="status" aria-live="polite">
        {toastMsg}
      </div>

      {popItem && popStyle && (
        <div
          className="inv-pop"
          role="dialog"
          aria-label={`${popItem.name} — cartão do item`}
          style={popStyle}
          data-od-id="inv-popover"
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
        >
          <span className="inv-pop-arrow" style={{ ['--ax' as string]: `${popArrowX}px` }} aria-hidden="true" />
          <div
            className="inv-pop-head"
            style={{ ['--el' as string]: CAT_RAIL[popItem.cat] } as CSSProperties}
          >
            <span className="inv-pop-ico">
              {popItem.sprite ? (
                <img
                  src={`https://api.skullbot.fr/img/digimon/dot/${popItem.sprite}.png`}
                  alt=""
                  onError={(e) => {
                    const t = e.currentTarget;
                    t.replaceWith(document.createTextNode(''));
                  }}
                />
              ) : (
                iconSvgFor(popItem.cat, popItem.itemId)
              )}
            </span>
            <div className="inv-pop-t">
              <div className="inv-pop-name">
                {popItem.name}
                <RarityBadge rarity={popItem.rarity} />
              </div>
              <div className="inv-pop-sub">
                {CAT_TAG[popItem.cat]} · ×{fmt(popItem.qty)} em posse
              </div>
            </div>
          </div>
          <div className="inv-pop-effect">{describeEffect(popItem)}</div>
          <div className="inv-pop-desc">{popItem.description}</div>
          <div className="inv-pop-meta">
            <span>
              <b>{fmt(popItem.val)}</b> Créditos/un.
            </span>
            <span>
              Total <b>{fmt(popItem.qty * popItem.val)}</b>
            </span>
          </div>
          <div className="inv-pop-actions">
            {popItem.cat === 'consumable' && (
              <button type="button" className="abtn use" onClick={() => { setPopover(null); openUse(popItem); }}>
                Usar
              </button>
            )}
            <button type="button" className="abtn" onClick={() => { setPopover(null); openSell(popItem); }}>
              Vender
            </button>
            <button type="button" className="abtn" onClick={() => { setPopover(null); setDetailId(popItem.itemId); }}>
              Detalhes
            </button>
          </div>
        </div>
      )}

      {detailItem && (
        <div
          className="cov show"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cvTitle"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailId(null);
          }}
        >
          <div className="cmodal">
            <div className="ek">{CAT_TAG[detailItem.cat]} · Inventário</div>
            <h3 id="cvTitle">{detailItem.name}</h3>
            <div
              className="cline"
              style={{ ['--el' as string]: CAT_RAIL[detailItem.cat] } as CSSProperties}
            >
              <span className="ico">
                {detailItem.sprite ? (
                  <img
                    src={`https://api.skullbot.fr/img/digimon/dot/${detailItem.sprite}.png`}
                    alt=""
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.replaceWith(document.createTextNode(''));
                    }}
                  />
                ) : (
                  iconSvgFor(detailItem.cat, detailItem.itemId)
                )}
              </span>
              <div className="ci">
                <div className="t">{detailItem.name}</div>
                <div className="s">Você possui ×{fmt(detailItem.qty)}</div>
              </div>
            </div>
            <div className="cmeta">
              <div className="mr">
                <span>Efeito</span>
                <b>{describeEffect(detailItem)}</b>
              </div>
              <div className="mr">
                <span>Valor unitário</span>
                <b>{fmt(detailItem.val)} Créditos</b>
              </div>
              <div className="mr">
                <span>Categoria</span>
                <b>{CAT_TAG[detailItem.cat]}</b>
              </div>
              <div className="mr">
                <span>Total em posse</span>
                <b>{fmt(detailItem.qty * detailItem.val)} Créditos</b>
              </div>
            </div>
            <div className="cdesc">{detailItem.description}</div>
            <div className="cactions">
              <button type="button" className="abtn" onClick={() => setDetailId(null)}>
                Fechar
              </button>
              <button
                type="button"
                className="abtn"
                onClick={() => {
                  setDetailId(null);
                  openSell(detailItem);
                }}
              >
                Vender no Market
              </button>
              {detailItem.cat === 'consumable' && (
                <button
                  type="button"
                  className="abtn use"
                  onClick={() => openUse(detailItem)}
                >
                  Usar item
                </button>
              )}
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
          onApply={(monId) => applyMutation.mutate({ itemId: applyingItem.itemId, monId })}
        />
      )}
    </>
  );
}
