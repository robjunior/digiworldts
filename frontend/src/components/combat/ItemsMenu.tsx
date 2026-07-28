import type { FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useQuery } from '@tanstack/react-query';
import { getItems } from '../../lib/api-shop';

type ItemsMenuProps = {
  readonly actor: FriendlyUnitView;
  readonly friendly: readonly FriendlyUnitView[];
  readonly onUseItem: (itemId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
};

export function ItemsMenu({ actor, friendly, onUseItem, onBack }: ItemsMenuProps): JSX.Element {
  const query = useQuery({ queryKey: ['items'] as const, queryFn: getItems, staleTime: 0 });
  const items = (query.data?.items ?? []).filter((i) => i.qty > 0);

  return (
    <>
      <div className="chelp"><span className="htag">Info</span><span>{query.isPending ? 'Loading...' : 'Select an item.'}</span></div>
      <div className="chead"><span className="sect">Items</span></div>
      <div className="rows">
        <button className="mrow back" type="button" onClick={onBack}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">← Back</div>
        </button>
        {items.length === 0 && !query.isPending ? (
          <div className="mrow disabled"><div className="mnm" style={{color:'var(--muted)'}}>No items.</div></div>
        ) : null}
        {items.map((item) => (
          <button
            key={item.itemId}
            className="mrow"
            type="button"
            onClick={() => onUseItem(item.itemId, actor.id)}
            title={item.description}
          >
            <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
            <div className="mnm">{item.name}</div>
            <div className="men">x{item.qty}</div>
          </button>
        ))}
      </div>
    </>
  );
}
