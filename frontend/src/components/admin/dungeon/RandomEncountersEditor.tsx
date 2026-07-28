import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Dungeon, DungeonView } from '@digiworld/shared';
import { ELEMENTS, STAGES, type Element } from '@digiworld/shared/digimon';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { clamp, toFloat, toPositiveInt, toStage } from './utils';
import { updateAdminDungeon } from '../../../lib/api-dungeon-admin';

export function RandomEncountersEditor({
  dungeonId,
  dungeon,
}: {
  readonly dungeonId: string;
  readonly dungeon: Dungeon;
}): JSX.Element {
  const queryClient = useQueryClient();
  const updateMut = useMutation({
    mutationFn: (
      body: Pick<
        Dungeon,
        | 'randomEncountersEnabled'
        | 'randomEncounterRate'
        | 'randomMinLevel'
        | 'randomMaxLevel'
        | 'randomMaxStage'
        | 'randomMinPartySize'
        | 'randomMaxPartySize'
        | 'randomAllowedElements'
      >,
    ) => updateAdminDungeon(dungeonId, body),
    onSuccess: ({ dungeon: updated }) =>
      queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeonId), (old) =>
        old ? { ...old, dungeon: updated } : old,
      ),
  });

  const [enabled, setEnabled] = useState(dungeon.randomEncountersEnabled);
  const [allowedElements, setAllowedElements] = useState<readonly Element[]>(
    dungeon.randomAllowedElements ?? [],
  );

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const minLevel = toPositiveInt(form.get('randomMinLevel'), 1);
    const maxLevel = Math.max(minLevel, toPositiveInt(form.get('randomMaxLevel'), 5));
    const minPartySize = clamp(toPositiveInt(form.get('randomMinPartySize'), 1), 1, 3);
    const maxPartySize = clamp(Math.max(minPartySize, toPositiveInt(form.get('randomMaxPartySize'), 1)), 1, 3);
    updateMut.mutate({
      randomEncountersEnabled: enabled,
      randomEncounterRate: clamp(toFloat(form.get('randomEncounterRate'), 0.12), 0, 1),
      randomMinLevel: minLevel,
      randomMaxLevel: maxLevel,
      randomMaxStage: toStage(form.get('randomMaxStage')),
      randomMinPartySize: minPartySize,
      randomMaxPartySize: maxPartySize,
      randomAllowedElements: allowedElements.length > 0 ? allowedElements : null,
    });
  };

  const toggleElement = (element: Element): void => {
    setAllowedElements((current) =>
      current.includes(element) ? current.filter((entry) => entry !== element) : [...current, element],
    );
  };

  return (
    <div className="admin-editor-panel random-encounter-editor">
      <h3>Random encounters</h3>
      <p className="muted">
        Dungeon-wide wild rolls. Static encounters, warps, and locked doors still take priority.
      </p>
      <form onSubmit={submit}>
        <label className="random-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled{' '}
          <b>{enabled ? 'ON' : 'OFF'}</b>
        </label>
        <label>
          Encounter rate
          <input
            name="randomEncounterRate"
            type="number"
            min="0"
            max="1"
            step="0.01"
            defaultValue={dungeon.randomEncounterRate}
          />
        </label>
        <div className="random-range-grid">
          <label>
            Min level
            <input name="randomMinLevel" type="number" min="1" max="999" defaultValue={dungeon.randomMinLevel} />
          </label>
          <label>
            Max level
            <input name="randomMaxLevel" type="number" min="1" max="999" defaultValue={dungeon.randomMaxLevel} />
          </label>
        </div>
        <label>
          Max stage
          <select name="randomMaxStage" defaultValue={dungeon.randomMaxStage}>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <div className="random-range-grid">
          <label>
            Min party
            <input name="randomMinPartySize" type="number" min="1" max="3" defaultValue={dungeon.randomMinPartySize} />
          </label>
          <label>
            Max party
            <input name="randomMaxPartySize" type="number" min="1" max="3" defaultValue={dungeon.randomMaxPartySize} />
          </label>
        </div>
        <fieldset className="random-elements">
          <legend>Allowed elements</legend>
          <p className="muted">None selected means all elements.</p>
          <div>
            {ELEMENTS.map((element) => (
              <button
                key={element}
                type="button"
                className={allowedElements.includes(element) ? 'is-active' : ''}
                onClick={() => toggleElement(element)}
              >
                {element}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="admin-poi-actions">
          <button type="submit" disabled={updateMut.isPending}>
            {updateMut.isPending ? 'Saving...' : 'Save random settings'}
          </button>
          {updateMut.isSuccess ? <span className="muted">Saved.</span> : null}
        </div>
      </form>
    </div>
  );
}
