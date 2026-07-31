import type { FormEvent, JSX } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DungeonEncounter, EncounterDigimon, EncounterLoot } from '@digiworld/shared';
import type { Element, TemplateDigimon } from '@digiworld/shared/digimon';
import type { ShopItemView } from '../../../lib/api-admin';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { replaceAt, toOptionalText } from './utils';
import { createAdminEncounter, deleteAdminEncounter, updateAdminEncounter } from '../../../lib/api-dungeon-admin';
import { getScenes } from '../../../lib/api-scenes';

export function BossEditor({
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
  const scenesQuery = useQuery({
    queryKey: ['admin-scenes'],
    queryFn: () => getScenes(),
    staleTime: 30_000,
  });
  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly difficulty: 'boss'; readonly digimon: readonly EncounterDigimon[]; readonly loots: readonly EncounterLoot[]; readonly sceneId?: string | null }) =>
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
        readonly difficulty: 'boss';
        readonly digimon: readonly EncounterDigimon[];
        readonly loots: readonly EncounterLoot[];
        readonly sceneId?: string | null;
      };
    }) => updateAdminEncounter(dungeonId, encounterId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const deleteMut = useMutation({
    mutationFn: (encounterId: string) => deleteAdminEncounter(dungeonId, encounterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });

  const fallbackCatalogId = catalog[0]?.id ?? 'agumon';

  const [digimonList, setDigimonList] = useState<readonly EncounterDigimon[]>(() => {
    if (encounter?.digimon && encounter.digimon.length > 0) {
      const list = [...encounter.digimon];
      while (list.length < 3) list.push({ catalogId: fallbackCatalogId, level: 1 });
      return list.slice(0, 3);
    }
    return [
      { catalogId: fallbackCatalogId, level: 1 },
      { catalogId: fallbackCatalogId, level: 1 },
      { catalogId: fallbackCatalogId, level: 1 },
    ];
  });

  const [loots, setLoots] = useState<readonly EncounterLoot[]>(encounter?.loots ? [...encounter.loots] : []);
  const [sceneId, setSceneId] = useState<string | null>(encounter?.sceneId ?? null);

  const bossElements = useMemo<readonly Element[]>(() => {
    const set = new Set<Element>();
    for (const entry of digimonList) {
      const tpl = catalog.find((c) => c.id === entry.catalogId);
      if (tpl) set.add(tpl.element as Element);
    }
    return Array.from(set);
  }, [digimonList, catalog]);

  const eligibleScenes = useMemo(() => {
    const scenes = scenesQuery.data ?? [];
    if (bossElements.length === 0) return scenes;
    const elementSet = new Set<Element>(bossElements);
    return scenes.filter((s) => s.elements.length === 0 || s.elements.some((e) => elementSet.has(e as Element)));
  }, [scenesQuery.data, bossElements]);

  if (!encounter && !createMut.isPending) {
    return (
      <div>
        <h3>No Boss at {x},{y}</h3>
        <button
          type="button"
          onClick={() => createMut.mutate({ x, y, difficulty: 'boss', digimon: digimonList, loots, sceneId })}
        >
          Add Boss Encounter
        </button>
      </div>
    );
  }
  if (!encounter) return <div>Creating...</div>;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    updateMut.mutate({
      encounterId: encounter.id,
      body: { ...(label === null ? {} : { label }), difficulty: 'boss', digimon: digimonList, loots, sceneId },
    });
  };

  const itemOptions = shopItems.filter((i) => !i.isQuestItem);
  const questItemOptions = shopItems.filter((i) => i.isQuestItem);

  const renderLootSection = (title: string, options: readonly ShopItemView[], filterCondition: (id: string) => boolean) => {
    const sectionLoots = loots.filter((l) => filterCondition(l.itemId));
    
    return (
      <div className="admin-boss-loot-section">
        <h4>{title}</h4>
        {sectionLoots.map((l, index) => {
          const globalIndex = loots.findIndex((gl) => gl === l);
          return (
            <div key={`${l.itemId}-${index}`} className="admin-boss-loot-row editor-sub-panel">
              <select
                value={l.itemId}
                onChange={(e) => setLoots(replaceAt(loots, globalIndex, { ...l, itemId: e.target.value }))}
              >
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
              <label>
                Qty
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={l.qty}
                  onChange={(e) => setLoots(replaceAt(loots, globalIndex, { ...l, qty: Number.parseInt(e.target.value, 10) || 1 }))}
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
                  onChange={(e) => setLoots(replaceAt(loots, globalIndex, { ...l, chance: Number.parseFloat(e.target.value) || 0 }))}
                />
              </label>
              <button type="button" onClick={() => setLoots(loots.filter((_, idx) => idx !== globalIndex))}>
                Remove
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            const opt = options[0];
            if (opt) {
              setLoots([...loots, { itemId: opt.id, qty: 1, chance: 1 }]);
            }
          }}
        >
          Add {title}
        </button>
      </div>
    );
  };

  return (
    <div className="admin-editor-panel admin-boss-editor">
      <h3>Edit Boss</h3>
      <form onSubmit={submit}>
        <label>
          Label <input name="label" defaultValue={encounter.label ?? ''} />
        </label>
        <h4>Digimon</h4>
        {digimonList.map((entry, index) => (
          <div key={`digimon-${index}`} className="admin-boss-slot editor-sub-panel">
            <strong>{index === 0 ? 'Boss' : `Companion ${index}`}</strong>
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
            <label>
              Level
              <input
                type="number"
                min="1"
                value={entry.level}
                onChange={(event) =>
                  setDigimonList(replaceAt(digimonList, index, { ...entry, level: Number.parseInt(event.target.value, 10) || 1 }))
                }
              />
            </label>
          </div>
        ))}

        <h4>Scene</h4>
        <div className="admin-boss-scene editor-sub-panel">
          <label>
            Battle scene
            <select
              value={sceneId ?? ''}
              onChange={(event) => setSceneId(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">Auto-pick from boss elements</option>
              {eligibleScenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.elements.length > 0 ? ` (${s.elements.join(', ')})` : ' (unassigned)'}
                </option>
              ))}
            </select>
          </label>
          {sceneId !== null && !eligibleScenes.some((s) => s.id === sceneId) ? (
            <p className="admin-boss-scene-hint">Saved scene no longer matches this boss's elements. Choose another or clear.</p>
          ) : null}
        </div>

        {renderLootSection('Items', itemOptions, (id) => !shopItems.find((i) => i.id === id)?.isQuestItem)}
        {renderLootSection('Quest Items', questItemOptions, (id) => !!shopItems.find((i) => i.id === id)?.isQuestItem)}

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
