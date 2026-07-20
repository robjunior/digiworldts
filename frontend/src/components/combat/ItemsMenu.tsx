import type { FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getItems } from '../../lib/api-shop';

const INVENTORY_QUERY_KEY = ['items'] as const;

type ItemsMenuProps = {
  readonly actor: FriendlyUnitView;
  readonly friendly: readonly FriendlyUnitView[];
  readonly onUseItem: (itemId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
};

export function ItemsMenu({ actor, friendly, onUseItem, onBack }: ItemsMenuProps): JSX.Element {
  const query = useQuery({ queryKey: INVENTORY_QUERY_KEY, queryFn: getItems, staleTime: 0 });
  const items = (query.data?.items ?? []).filter((i) => i.qty > 0);
  const [selectedTargetId, setSelectedTargetId] = useState<UnitId>(actor.id);

  useEffect(() => {
    if (!friendly.some((u) => u.id === selectedTargetId)) {
      setSelectedTargetId(actor.id);
    }
  }, [actor.id, friendly, selectedTargetId]);

  const target = friendly.find((u) => u.id === selectedTargetId) ?? actor;

  return (
    <>
      <div className="skill-menu" role="menu" data-od-id="item-menu">
        {query.isPending ? (
          <div className="item-menu-empty">Loading inventory…</div>
        ) : items.length === 0 ? (
          <div className="item-menu-empty">No usable items. Earn drops from PVE or craft at the farm.</div>
        ) : (
          items.map((item) => (
            <ItemRow
              key={item.itemId}
              itemId={item.itemId}
              name={item.name}
              qty={item.qty}
              description={item.description}
              onClick={() => onUseItem(item.itemId, target.id)}
            />
          ))
        )}
      </div>
      <div className="item-targets" role="radiogroup" aria-label="Target">
        {friendly.map((unit) => {
          const active = unit.id === selectedTargetId;
          return (
            <button
              key={unit.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`item-target${active ? ' is-selected' : ''}${unit.down ? ' is-down' : ''}`}
              onClick={() => setSelectedTargetId(unit.id)}
              title={`Target ${unit.name} — HP ${unit.hp}/${unit.hpMax}`}
            >
              <span className="it-name">{unit.name}</span>
              <span className="it-hp">{unit.hp}/{unit.hpMax}</span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ gap: '8px' }}>
        <button className="btn btn--secondary btn--sm" type="button" onClick={onBack}>Back</button>
        <span className="target-hint">Target: {target.name}</span>
      </div>
    </>
  );
}

function ItemRow({ itemId, name, qty, description, onClick }: {
  readonly itemId: string;
  readonly name: string;
  readonly qty: number;
  readonly description: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button className="skill-row" type="button" role="menuitem" onClick={onClick} data-od-id={`item-${itemId}`}>
      <span className="stack" style={{ gap: '2px' }}>
        <span className="s-name">{name}</span>
        <span className="s-desc">{description}</span>
      </span>
      <span className="s-cost">×{qty}</span>
    </button>
  );
}
