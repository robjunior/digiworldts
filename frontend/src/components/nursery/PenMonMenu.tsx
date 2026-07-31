import { useEffect, useState } from 'react';
import type { NurseryPenMon } from '../../lib/api-nursery';

export type PenMonMenuProps = {
  readonly mon: NurseryPenMon;
  readonly screenX: number;
  readonly screenY: number;
  readonly busy: boolean;
  readonly canFeed: boolean;
  readonly feedCost: number;
  readonly onPet: (mon: NurseryPenMon) => void;
  readonly onFeed: (mon: NurseryPenMon) => void;
  readonly onGraduate: (mon: NurseryPenMon) => void;
  readonly onClose: () => void;
};

export function PenMonMenu({
  mon,
  screenX,
  screenY,
  busy,
  canFeed,
  feedCost,
  onPet,
  onFeed,
  onGraduate,
  onClose,
}: PenMonMenuProps): JSX.Element | null {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.pen-menu')) {
        onClose();
      }
    };
    // Delay adding click listener slightly to avoid triggering from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      className="pen-menu"
      style={{
        left: `${screenX}px`,
        top: `${screenY}px`,
        transform: 'translate(-50%, -100%) translateY(-16px)',
      }}
    >
      <div className="pen-menu__hd">
        <strong>{mon.nickname}</strong>
        <span className="pen-menu__stage">{mon.stage}</span>
      </div>

      <div className="pen-menu__btns">
        <button type="button" disabled={!canFeed || busy} onClick={() => onFeed(mon)}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 10h-2V8h2v2zm-2 2h-2v2h2v-2zm-6 0H8v2h2v-2zm4-4h-2V6h2v2zm-2 6h-2v2h2v-2zm4 2h-2v2h2v-2z"/>
          </svg>
          Feed ({feedCost})
        </button>
        <button type="button" disabled={!mon.canPet || busy} onClick={() => onPet(mon)}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.5 2c-.83 0-1.5.67-1.5 1.5V9h-1V4.5c0-.83-.67-1.5-1.5-1.5S8 3.67 8 4.5V9H7V5.5C7 4.67 6.33 4 5.5 4S4 4.67 4 5.5V11L3.3 9.61c-.35-.71-1.25-.99-1.95-.64-.7.35-.98 1.25-.63 1.95l3.22 6.44C5.1 19.5 7.15 21 9.5 21h4c2.76 0 5-2.24 5-5V7.5c0-.83-.67-1.5-1.5-1.5-.66 0-1.21.42-1.42 1H15V3.5c0-.83-.67-1.5-1.5-1.5z"/>
          </svg>
          Pet
        </button>
      </div>

      <div className="pen-menu__timer">
        {mon.stage === 'Rookie' ? (
          <button type="button" className="pen-menu__grad" disabled={busy} onClick={() => onGraduate(mon)}>
            Graduate to roster
          </button>
        ) : (
          <Timer evolutionTime={mon.evolveAt} />
        )}
      </div>
    </div>
  );
}

function Timer({ evolutionTime }: { readonly evolutionTime: number }): JSX.Element {
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const rem = Math.max(0, evolutionTime - now);
  if (rem === 0) return <span>Evolving...</span>;

  const totalS = Math.floor(rem / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');

  const label = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return <span>Evolves in {label}</span>;
}