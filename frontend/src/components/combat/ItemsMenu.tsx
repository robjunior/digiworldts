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
  readonly setHelp: (h: string) => void;
};

const IC = {
  cursor: '<path d="M5 4l14 8-14 8z"/>',
};

export function ItemsMenu({ actor, friendly, onUseItem, onBack, setHelp }: ItemsMenuProps): JSX.Element {
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
      <div className="chead"><span className="sect">Items</span><span className="cnt">{items.length}</span></div>
      <div className="rows">
        <button className="mrow back" type="button" onClick={onBack} onMouseEnter={() => setHelp('Return to the command menu.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">‹ Back</span>
        </button>
        {query.isPending ? (
          <div className="mrow disabled" style={{ cursor: 'default' }}><span className="cur"></span><span className="mnm">Loading inventory…</span></div>
        ) : items.length === 0 ? (
          <div className="mrow disabled" style={{ cursor: 'default' }}><span className="cur"></span><span className="mnm">No usable items.</span></div>
        ) : (
          items.map((item) => (
            <ItemRow
              key={item.itemId}
              itemId={item.itemId}
              name={item.name}
              qty={item.qty}
              description={item.description}
              onClick={() => onUseItem(item.itemId, target.id)}
              setHelp={setHelp}
              targetName={target.name}
            />
          ))
        )}
      </div>
      <div className="chead" style={{ marginTop: '8px' }}><span className="sect">Target: {target.name}</span></div>
      <div className="rows" style={{ maxHeight: '100px' }}>
        {friendly.map((unit) => {
          const active = unit.id === selectedTargetId;
          return (
            <button
              key={unit.id}
              type="button"
              className={`mrow ${active ? 'sel' : ''} ${unit.down ? 'disabled' : ''}`}
              onClick={() => setSelectedTargetId(unit.id)}
              onMouseEnter={() => setHelp(`Select ${unit.name} as target.`)}
            >
              <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
              <span className="mnm">{unit.name}</span>
              <span className="mtag">HP</span>
              <span className="men">{unit.hp}/{unit.hpMax}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ItemRow({ itemId, name, qty, description, onClick, setHelp, targetName }: {
  readonly itemId: string;
  readonly name: string;
  readonly qty: number;
  readonly description: string;
  readonly onClick: () => void;
  readonly setHelp: (h: string) => void;
  readonly targetName: string;
}): JSX.Element {
  return (
    <button className="mrow" type="button" onClick={onClick} onMouseEnter={() => setHelp(`Use on ${targetName}: ${description}`)}>
      <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
      <span className="mnm">{name}</span>
      <span className="mtag">Item</span>
      <span className="men">×{qty}</span>
    </button>
  );
}
