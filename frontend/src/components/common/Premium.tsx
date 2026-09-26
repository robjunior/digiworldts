import type { JSX, ReactNode } from 'react';

/**
 * A reusable premium "+50%" indicator. Pass the base gain and the bonus amount;
 * renders `base` in gold when premium is active and appends a separate "+bonus"
 * plus a "PREMIUM" tag. When non-premium renders nothing/simple base (no gold).
 */
export function PremiumGain({
  active,
  base,
  bonus,
  format = (n: number) => n.toLocaleString('en-US'),
}: {
  readonly active: boolean;
  readonly base: number;
  readonly bonus: number;
  readonly format?: (n: number) => string;
}): JSX.Element {
  if (!active || bonus <= 0) {
    return <>{format(base)}</>;
  }
  return (
    <>
      <span className="prem-amt">{format(base)}</span>
      <span className="prem-plus">{format(bonus)}</span>
    </>
  );
}

/** A small inline "+50% PREMIUM" tag. */
export function PremiumTag({ label = '+50%' }: { readonly label?: string }): JSX.Element {
  return (
    <span className="prem-tag">
      <span className="star">&#9733;</span>
      {label} PREMIUM
    </span>
  );
}

/** Full-page banner shown when the user is premium. */
export function PremiumBanner({ children, until }: { readonly children?: ReactNode; readonly until?: number | null }): JSX.Element | null {
  return (
    <div className="prem-banner" role="status">
      <span className="ico">&#9733;</span>
      <span>
        <b>Premium ativo</b>
        {until ? ` — até ${new Date(until).toLocaleDateString('pt-BR')}.` : ''}{' '}
        {children ?? '+50% em produção, XP e recompensas de quests.'}
      </span>
    </div>
  );
}