import type { WorldDirection } from '../../lib/api-world';

type WorldDpadProps = {
  readonly disabled: boolean;
  readonly onMove: (dir: WorldDirection) => void;
};

export function WorldDpad({ disabled, onMove }: WorldDpadProps): JSX.Element {
  return (
    <div className="rtip show" id="rtip" style={{ bottom: 60, left: 16, top: 'auto', transform: 'none' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <div/>
        <button type="button" disabled={disabled} onClick={() => onMove('up')}>↑</button>
        <div/>
        <button type="button" disabled={disabled} onClick={() => onMove('left')}>←</button>
        <button type="button" disabled={disabled} onClick={() => onMove('down')}>↓</button>
        <button type="button" disabled={disabled} onClick={() => onMove('right')}>→</button>
      </div>
      <span className="re" id="rtip-el">D-Pad Controls</span>
    </div>
  );
}
