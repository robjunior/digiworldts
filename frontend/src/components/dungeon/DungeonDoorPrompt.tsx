import type { ReactElement } from 'react';
import type { DungeonDoor } from '@digiworld/shared';

type DungeonDoorPromptProps = {
  readonly pendingDoor: DungeonDoor;
  readonly keyName: string;
  readonly canUnlock: boolean;
  readonly isUnlocking: boolean;
  readonly onUnlock: (doorId: string) => void;
};

export function DungeonDoorPrompt({
  pendingDoor,
  keyName,
  canUnlock,
  isUnlocking,
  onUnlock,
}: DungeonDoorPromptProps): ReactElement {
  return (
    <div className="door-unlock-prompt" role="status" aria-live="polite">
      <div>
        <b>{pendingDoor.label ?? 'Locked door'}</b>
        <span>Requires: {keyName}</span>
      </div>
      <button
        type="button"
        onClick={() => onUnlock(pendingDoor.id)}
        disabled={!canUnlock || isUnlocking}
      >
        {isUnlocking ? 'Unlocking...' : 'Unlock'}
      </button>
      {!canUnlock ? (
        <span className="door-unlock-missing">You need a {keyName}.</span>
      ) : null}
    </div>
  );
}
