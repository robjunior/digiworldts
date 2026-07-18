import type { WorldDirection } from '../../lib/api-world';

type WorldDpadProps = {
  readonly disabled: boolean;
  readonly onMove: (dir: WorldDirection) => void;
};

export function WorldDpad({ disabled, onMove }: WorldDpadProps): JSX.Element {
  return (
    <div className="world-dpad" aria-label="Movement controls">
      <button type="button" disabled={disabled} onClick={() => onMove('up')} aria-label="Move up">↑</button>
      <button type="button" disabled={disabled} onClick={() => onMove('left')} aria-label="Move left">←</button>
      <button type="button" disabled={disabled} onClick={() => onMove('down')} aria-label="Move down">↓</button>
      <button type="button" disabled={disabled} onClick={() => onMove('right')} aria-label="Move right">→</button>
    </div>
  );
}
