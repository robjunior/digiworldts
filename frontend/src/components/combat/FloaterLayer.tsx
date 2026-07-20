import type { ActionCue, UnitId } from '@digiworld/shared/battle';

export type Floater = {
  readonly id: string;
  readonly targetId: UnitId;
  readonly amount: number;
  readonly cue: ActionCue;
  readonly x: number;
  readonly y: number;
};

type FloaterLayerProps = {
  readonly floaters: readonly Floater[];
};

export function FloaterLayer({ floaters }: FloaterLayerProps): JSX.Element {
  return (
    <div className="floater-layer" id="floater-layer" aria-hidden="true">
      {floaters.map((floater) => (
        <FloaterNode key={floater.id} floater={floater} />
      ))}
    </div>
  );
}

function FloaterNode({ floater }: { readonly floater: Floater }): JSX.Element {
  const cueClass = floater.cue === null || floater.cue === 'analyzed' || floater.cue === 'chain' || floater.cue === 'capture-hit' || floater.cue === 'capture-miss' ? '' : ` is-${floater.cue}`;
  return <div className={`dmg-floater${cueClass}`} style={{ left: `${floater.x}px`, top: `${floater.y}px` }}>{floaterText(floater)}</div>;
}

function floaterText(floater: Floater): string {
  switch (floater.cue) {
    case 'miss':
      return 'Miss';
    case 'immune':
      return 'Immune';
    case 'crit':
    case 'weak':
    case 'attr-advantage':
      return `${floater.amount} !`;
    case 'item-heal':
    case 'item-revive':
      return `+${floater.amount} HP`;
    case 'item-en':
      return `+${floater.amount} EN`;
    case 'item-cure':
      return 'Cured';
    case 'item-buff':
      return `+${floater.amount}`;
    case 'resist':
    case 'attr-disadvantage':
    case 'chain':
    case 'analyzed':
    case 'capture-hit':
    case 'capture-miss':
    case null:
      return String(floater.amount);
    default:
      floater.cue satisfies never;
      return String(floater.amount);
  }
}
