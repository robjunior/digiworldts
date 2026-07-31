/**
 * Wallet balance badges.
 *
 * Two currencies exist in DigiWorld:
 *   - Credits (CR)  — the premium currency. Only enters the economy through a
 *                     real-money PIX purchase in the Discord bot, or by trading
 *                     for it on the player-run coin market. Never dropped.
 *   - NetCore (NTC) — the earned currency. Granted by loot, PvE, quests and
 *                     dailies, and used for Digimon listings and in-game goods.
 *
 */
export type CurrencyBadgeProps = {
  readonly value: number;
  readonly title?: string;
};

type Variant = {
  readonly cls: string;
  readonly ticker: string;
  readonly label: string;
};

const CREDITS: Variant = { cls: 'is-credits', ticker: 'CR', label: 'Credits' };
const NETCORE: Variant = { cls: 'is-netcore', ticker: 'NTC', label: 'NetCore' };

function CurrencyBadge({ value, title, variant }: CurrencyBadgeProps & { readonly variant: Variant }): JSX.Element {
  const display = Math.round(value).toLocaleString();
  const text = `${display} ${variant.label}`;
  return (
    <span
      className={`digi-credits ${variant.cls}`}
      role="status"
      aria-label={text}
      title={title ?? text}
      data-od-id={`currency-${variant.ticker.toLowerCase()}`}
    >
      <span className="dc-mark" aria-hidden="true" />
      <b className="dc-val">{display}</b>
      <span className="dc-lbl">{variant.ticker}</span>
    </span>
  );
}

export function Credits({ value, title }: CurrencyBadgeProps): JSX.Element {
  return <CurrencyBadge value={value} {...(title === undefined ? {} : { title })} variant={CREDITS} />;
}

export function NetCore({ value, title }: CurrencyBadgeProps): JSX.Element {
  return <CurrencyBadge value={value} {...(title === undefined ? {} : { title })} variant={NETCORE} />;
}
