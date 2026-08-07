import type { RunStashView } from '@digiworld/shared/dungeon';

import { RarityBadge } from '../inventory/RarityBadge';

export function DungeonStashPanel({
  stash,
  itemCatalog,
}: {
  readonly stash: RunStashView | null;
  readonly itemCatalog?: ReadonlyMap<string, { readonly name: string; readonly rarity?: import('@digiworld/shared/item-rarity').Rarity }>;
}): JSX.Element {
  if (!stash) {
    return (
      <div className="dungeon-stash-panel dungeon-stash-panel--empty">
        <div className="dungeon-stash-panel__title">Stash</div>
        <div className="dungeon-stash-panel__muted">Not in a dungeon.</div>
      </div>
    );
  }

  const hasItems = stash.items.length > 0;
  const hasResources = stash.meat > 0 || stash.bits > 0 || stash.data > 0;

  return (
    <div className="dungeon-stash-panel">
      <div className="dungeon-stash-panel__title">Stash</div>
      {!hasItems && !hasResources ? (
        <div className="dungeon-stash-panel__muted">Empty.</div>
      ) : null}
      {stash.items.map((row) => {
        const catEntry = itemCatalog?.get(row.itemId);
        const name = catEntry?.name ?? row.itemId;
        const rarity = catEntry?.rarity;
        return (
          <div key={`${row.itemId}-${row.origin}`} className="dungeon-stash-panel__row">
            <span className="dungeon-stash-panel__name">{name}</span>
            <RarityBadge rarity={rarity} />
            <span className={`dungeon-stash-panel__origin dungeon-stash-panel__origin--${row.origin}`}>
              {row.origin}
            </span>
            <span className="dungeon-stash-panel__qty">× {row.qty}</span>
          </div>
        );
      })}
      {hasResources ? (
        <div className="dungeon-stash-panel__resources">
          {stash.meat > 0 ? <span>Meat: {stash.meat}</span> : null}
          {stash.bits > 0 ? <span>Bits: {stash.bits}</span> : null}
          {stash.data > 0 ? <span>Data: {stash.data}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
