import { useEffect, useRef } from 'react';
import type { BattleView } from '@digiworld/shared/battle';

export function renderEventText(event: BattleView['log'][number], battle: BattleView): string {
  if (event.type === 'action') {
    const cue = event.cue ?? '';
    const target = event.targetId ? (battle.friendly.find((u) => u.id === event.targetId)?.name ?? battle.enemy.find((u) => u.id === event.targetId)?.name ?? event.targetId) : '';
    const damage = event.damage !== undefined ? ` ${event.damage}` : '';
    return `${event.actor ?? '?'} → ${target}${damage} ${cue}`.trim();
  }
  if (event.type === 'round-start') return `Round ${event.round}`;
  if (event.type === 'end') return `Match ended: ${event.outcome}`;
  return event.type;
}

export function BattleFeed({ events, battle }: { readonly events: readonly BattleView['log'][number][]; readonly battle: BattleView }): JSX.Element {
  const logBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logBodyRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <aside className="feed" aria-label="Battle feed">
      <h4>Battle Feed</h4>
      <div className="feedbody" role="log" aria-live="polite" aria-relevant="additions" ref={logBodyRef}>
        {events.slice(-30).map((event, idx) => (
          <div key={`log-${idx}-${event.at}`} className="mrow">
            <span className="rd">R{event.type === 'round-start' ? event.round : (battle.round)}</span>
            <span className="men">{renderEventText(event, battle)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}