import type { BattleView } from '@digiworld/shared/battle';
import { TurnOrderStrip } from './TurnOrderStrip';

export function TurnOrderRail({ battle }: { readonly battle: BattleView }): JSX.Element {
  return (
    <aside className="turn-order-rail" aria-label="Turn order">
      <span className="turn-order-rail__label">Order</span>
      <TurnOrderStrip battle={battle} />
    </aside>
  );
}
