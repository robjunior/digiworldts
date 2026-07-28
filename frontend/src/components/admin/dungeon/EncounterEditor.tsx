import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonEncounter, DungeonView, EncounterDigimon, EncounterLoot } from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';
import type { ShopItemView } from '../../../lib/api-admin';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import type { Difficulty } from './types';
import { replaceAt, toDifficulty, toOptionalText } from './utils';
import { createAdminEncounter, deleteAdminEncounter, updateAdminEncounter } from '../../../lib/api-dungeon-admin';

export function EncounterEditor({
  dungeonId,
  x,
  y,
  encounter,
  catalog,
  shopItems,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly encounter?: DungeonEncounter;
  readonly catalog: readonly TemplateDigimon[];
  readonly shopItems: readonly ShopItemView[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly digimon: readonly EncounterDigimon[]; readonly loots: readonly EncounterLoot[] }) =>
      createAdminEncounter(dungeonId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const updateMut = useMutation({
    mutationFn: ({
      encounterId,
      body,
    }: {
      readonly encounterId: string;
      readonly body: {
        readonly label?: string | null;
        readonly difficulty: Difficulty;
        readonly digimon: readonly EncounterDigimon[];
        readonly loots: readonly EncounterLoot[];
      };
    }) => updateAdminEncounter(dungeonId, encounterId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const deleteMut = useMutation({
    mutationFn: (encounterId: string) => deleteAdminEncounter(dungeonId, encounterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const [digimonList, setDigimonList] = useState<readonly EncounterDigimon[]>(encounter?.digimon ? [...encounter.digimon] : []);
  const [loots, setLoots] = useState<readonly EncounterLoot[]>(() => {
    if (encounter?.loots && encounter.loots.length > 0) return [...encounter.loots];
    if (encounter?.rewardItemId) return [{ itemId: encounter.rewardItemId, qty: 1, chance: 1 }];
    return [];
  });
  const fallbackCatalogId = catalog[0]?.id ?? 'agumon';

  if (!encounter && !createMut.isPending) {
    return (
      <div>
        <h3>No Encounter at {x},{y}</h3>
        <button
          type="button"
          onClick={() => createMut.mutate({ x, y, digimon: [{ catalogId: fallbackCatalogId, level: 1 }], loots: [] })}
        >
          Add Encounter
        </button>
      </div>
    );
  }
  if (!encounter) return <div>Creating...</div>;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const difficulty = toDifficulty(form.get('difficulty'));
    const label = toOptionalText(form.get('label'));
    updateMut.mutate({
      encounterId: encounter.id,
      body: { ...(label === null ? {} : { label }), difficulty, digimon: digimonList, loots },
    });
  };

  const itemOptions = shopItems.filter((i) => !i.isQuestItem);

  return (
    <div className="admin-editor-panel">
      <h3>Edit Encounter</h3>
      <form onSubmit={submit}>
        <label>
          Label <input name="label" defaultValue={encounter.label ?? ''} />
        </label>
        <label>
          Difficulty
          <select name="difficulty" defaultValue={encounter.difficulty}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="elite">Elite</option>
            <option value="boss">Boss</option>
          </select>
        </label>
        <h4>Digimon</h4>
        {digimonList.map((entry, index) => (
          <div key={`${entry.catalogId}-${index}`} className="editor-sub-panel">
            <select
              value={entry.catalogId}
              onChange={(event) => setDigimonList(replaceAt(digimonList, index, { ...entry, catalogId: event.target.value }))}
            >
              {catalog.map((catalogEntry) => (
                <option key={catalogEntry.id} value={catalogEntry.id}>
                  {catalogEntry.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={entry.level}
              onChange={(event) =>
                setDigimonList(replaceAt(digimonList, index, { ...entry, level: Number.parseInt(event.target.value, 10) || 1 }))
              }
            />
            <button type="button" onClick={() => setDigimonList(digimonList.filter((_, entryIndex) => entryIndex !== index))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setDigimonList([...digimonList, { catalogId: fallbackCatalogId, level: 1 }])}>
          Add Digimon
        </button>

        <h4>Items</h4>
        {loots.map((l, index) => (
          <div key={`${l.itemId}-${index}`} className="editor-sub-panel admin-boss-loot-row">
            <select
              value={l.itemId}
              onChange={(e) => setLoots(replaceAt(loots, index, { ...l, itemId: e.target.value }))}
            >
              {itemOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
              ))}
            </select>
            <label>
              Qty
              <input
                type="number"
                min="1"
                max="99"
                value={l.qty}
                onChange={(e) => setLoots(replaceAt(loots, index, { ...l, qty: Number.parseInt(e.target.value, 10) || 1 }))}
              />
            </label>
            <label className="admin-boss-chance-slider">
              Chance: {l.chance.toFixed(2)}
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={l.chance}
                onChange={(e) => setLoots(replaceAt(loots, index, { ...l, chance: Number.parseFloat(e.target.value) || 0 }))}
              />
            </label>
            <button type="button" onClick={() => setLoots(loots.filter((_, idx) => idx !== index))}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const opt = itemOptions[0];
            if (opt) {
              setLoots([...loots, { itemId: opt.id, qty: 1, chance: 1 }]);
            }
          }}
        >
          Add Item
        </button>

        <div className="admin-poi-actions">
          <button type="submit" disabled={updateMut.isPending}>
            Save
          </button>
          <button type="button" onClick={() => deleteMut.mutate(encounter.id)}>
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}

export type { DungeonView };
