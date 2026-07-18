import type { BattleEvent } from '@digiworld/shared/battle';
import { useEffect, useRef } from 'react';

type TurnLogV2Props = {
  readonly events: readonly BattleEvent[];
};

export function TurnLogV2({ events }: TurnLogV2Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="turn-log turn-log--v2" role="log" aria-label="Battle log" ref={ref}>
      {events.map((event) => (
        <LogLine key={`${event.at}-${event.type}-${event.round}`} event={event} />
      ))}
    </div>
  );
}

function LogLine({ event }: { readonly event: BattleEvent }): JSX.Element {
  const cue = eventCue(event);
  const text = eventText(event);
  return (
    <div className={`log-line log-line-v2${cue ? ` cue-${cue}` : ''}`} title={text}>
      <span className="stripe" aria-hidden="true" />
      <span className="icon" aria-hidden="true"><Icon kind={eventIcon(event)} /></span>
      <span className="rnd">R{event.round}</span>
      <span className="text">{text}</span>
      {cue ? <span className="tag">{cueTag(cue)}</span> : <span />}
    </div>
  );
}

type LogIcon = 'attack' | 'guard' | 'analyse' | 'status' | 'ko' | 'round' | 'flee' | 'system';
type LogCue = 'crit' | 'miss' | 'resist' | 'weak' | 'guard' | 'ko' | 'round';

function eventCue(event: BattleEvent): LogCue | null {
  switch (event.type) {
    case 'action':
      if (event.action.type === 'guard') {
        return 'guard';
      }
      if (event.cue === 'crit' || event.cue === 'miss' || event.cue === 'resist' || event.cue === 'weak') {
        return event.cue;
      }
      return null;
    case 'unit-down':
      return 'ko';
    case 'round-start':
      return 'round';
    case 'ailment-tick':
    case 'ailment-expired':
    case 'turn':
    case 'turn-skip':
    case 'end':
      return null;
    default:
      event satisfies never;
      return null;
  }
}

function eventIcon(event: BattleEvent): LogIcon {
  switch (event.type) {
    case 'action':
      switch (event.action.type) {
        case 'fight':
        case 'skill':
        case 'capture':
          return 'attack';
        case 'guard':
          return 'guard';
        case 'analyze':
          return 'analyse';
        case 'flee':
          return 'flee';
        default:
          event.action satisfies never;
          return 'system';
      }
    case 'ailment-tick':
    case 'ailment-expired':
      return 'status';
    case 'unit-down':
      return 'ko';
    case 'round-start':
      return 'round';
    case 'turn':
    case 'turn-skip':
    case 'end':
      return 'system';
    default:
      event satisfies never;
      return 'system';
  }
}

function eventText(event: BattleEvent): string {
  switch (event.type) {
    case 'action':
      return actionText(event);
    case 'ailment-tick':
      return `${event.unit} took ${event.damage} ${event.kind} damage.`;
    case 'ailment-expired':
      return `${event.kind} expired on ${event.unit}.`;
    case 'unit-down':
      return `${event.unitName} was knocked out.`;
    case 'turn':
      return event.unitName ? `${event.unitName} is ready.` : 'Turn advanced.';
    case 'turn-skip':
      return `${event.unitName} skipped: ${event.reason}.`;
    case 'round-start':
      return `Round ${event.round}.`;
    case 'end':
      return `Battle ended: ${event.outcome}.`;
    default:
      event satisfies never;
      return '';
  }
}

function actionText(event: Extract<BattleEvent, { type: 'action' }>): string {
  const actor = event.actorName ?? event.actor ?? 'System';
  const target = event.targetName ?? event.targetId ?? 'target';
  switch (event.action.type) {
    case 'fight':
      return `${actor} fights ${target}${damageSuffix(event.damage)}.`;
    case 'skill':
      return `${actor} used ${event.skillName ?? event.action.skillId} on ${target}${damageSuffix(event.damage)}.`;
    case 'guard':
      return `${actor} guards — next incoming halved.`;
    case 'analyze':
      return event.analyzedInfo ? `Analysed ${event.analyzedInfo.name} · HP ${event.analyzedInfo.hp}/${event.analyzedInfo.hpMax} · ${event.analyzedInfo.element}.` : `${actor} analysed ${target}.`;
    case 'capture':
      return `${actor} attempted capture on ${target}.`;
    case 'flee':
      return `${actor} fled the battle.`;
    default:
      event.action satisfies never;
      return '';
  }
}

function damageSuffix(damage: number | undefined): string {
  return damage === undefined ? '' : ` · ${damage}`;
}

function cueTag(cue: LogCue): string {
  switch (cue) {
    case 'crit': return 'Crit';
    case 'weak': return 'Weak';
    case 'resist': return 'Resist';
    case 'miss': return 'Miss';
    case 'ko': return 'KO';
    case 'guard': return 'Guard';
    case 'round': return 'Round';
    default:
      cue satisfies never;
      return '';
  }
}

function Icon({ kind }: { readonly kind: LogIcon }): JSX.Element {
  switch (kind) {
    case 'attack':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4l6 6-10 10H4v-6L14 4Z" /></svg>;
    case 'guard':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4Z" /></svg>;
    case 'analyse':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>;
    case 'status':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l6 8a6 6 0 1 1-12 0l6-8Z" /></svg>;
    case 'ko':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M6 18 18 6" /></svg>;
    case 'round':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-3-6" /><path d="M20 4v4h-4" /></svg>;
    case 'flee':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 12h12M12 6l6 6-6 6" /></svg>;
    case 'system':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /></svg>;
    default:
      kind satisfies never;
      return <svg viewBox="0 0 24 24" />;
  }
}
