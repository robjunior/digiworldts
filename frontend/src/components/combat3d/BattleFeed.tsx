import { useEffect, useRef } from 'react';
import type { ActionCue, BattleEvent, BattleView, UnitId } from '@digiworld/shared/battle';

type LogTone = 'crit' | 'weak' | 'resist' | 'miss' | 'ko' | 'round' | 'guard' | '';

const CUE_TAG: Readonly<Record<Exclude<ActionCue, null>, string>> = {
  crit: 'critical',
  miss: 'miss',
  resist: 'resisted',
  weak: 'super effective',
  immune: 'immune',
  chain: 'chain',
  'attr-advantage': 'attr edge',
  'attr-disadvantage': 'attr penalty',
  'capture-hit': 'captured',
  'capture-miss': 'broke free',
  'item-heal': 'hp restored',
  'item-en': 'en restored',
  'item-cure': 'cured',
  'item-buff': 'buffed',
  'item-revive': 'revived',
};

const CUE_TONE: Readonly<Record<Exclude<ActionCue, null>, LogTone>> = {
  crit: 'crit',
  miss: 'miss',
  resist: 'resist',
  weak: 'weak',
  immune: 'resist',
  chain: 'crit',
  'attr-advantage': 'weak',
  'attr-disadvantage': 'resist',
  'capture-hit': 'weak',
  'capture-miss': 'miss',
  'item-heal': 'guard',
  'item-en': 'guard',
  'item-cure': 'guard',
  'item-buff': 'guard',
  'item-revive': 'guard',
};

function nameOf(battle: BattleView, id: UnitId | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  return battle.friendly.find((u) => u.id === id)?.name
    ?? battle.enemy.find((u) => u.id === id)?.name
    ?? null;
}

function outcomeText(event: Extract<BattleEvent, { type: 'end' }>, battle: BattleView): string {
  switch (event.outcome) {
    case 'captured_a': return 'Target captured';
    case 'draw': return 'Draw';
    case 'abandoned': return 'Battle abandoned';
    case 'fled_a': return battle.yourSide === 'a' ? 'You fled' : 'Opponent fled';
    case 'fled_b': return battle.yourSide === 'b' ? 'You fled' : 'Opponent fled';
    case 'win_a': return battle.yourSide === 'a' ? 'Victory' : 'Defeat';
    case 'win_b': return battle.yourSide === 'b' ? 'Victory' : 'Defeat';
    default:
      event.outcome satisfies never;
      return 'Battle ended';
  }
}

function actionText(event: Extract<BattleEvent, { type: 'action' }>, battle: BattleView): string {
  const actor = event.actorName ?? nameOf(battle, event.actor) ?? 'Someone';
  const target = event.targetName ?? nameOf(battle, event.targetId) ?? 'the target';
  switch (event.action.type) {
    case 'flee':
      return `${actor} fled the battle`;
    case 'capture': {
      const odds = event.captureChance !== undefined ? ` (${Math.round(event.captureChance * 100)}%)` : '';
      return `${actor} tried to capture ${target}${odds}`;
    }
    case 'use_item':
      return `${actor} used an item on ${target}`;
    case 'skill':
      return `${actor} cast ${event.skillName ?? 'a skill'} on ${target}`;
    case 'guard':
      return `${actor} guarded`;
    case 'fight':
      return `${actor} attacked ${target}`;
    default:
      event.action satisfies never;
      return actor;
  }
}

export function renderEventText(event: BattleEvent, battle: BattleView): string {
  switch (event.type) {
    case 'action': {
      const parts = [actionText(event, battle)];
      if (event.damage !== undefined && event.damage > 0) parts.push(`${event.damage} dmg`);
      if (event.applied !== undefined && event.applied.length > 0) {
        parts.push(event.applied.map((a) => `${a.kind} ${a.turnsLeft}t`).join(', '));
      }
      return parts.join(' · ');
    }
    case 'ailment-tick':
      return `${nameOf(battle, event.unit) ?? 'Unit'} takes ${event.damage} from ${event.kind}`;
    case 'ailment-expired':
      return `${nameOf(battle, event.unit) ?? 'Unit'} shook off ${event.kind}`;
    case 'unit-down':
      return `${event.unitName} is down`;
    case 'turn-skip':
      return `${event.unitName} lost the turn (${event.reason === 'locked' ? 'immobilized' : 'defeated'})`;
    case 'turn':
      return `${event.unitName ?? (event.side === battle.yourSide ? 'Your' : 'Enemy')} turn`;
    case 'round-start':
      return `Round ${event.round}`;
    case 'end':
      return outcomeText(event, battle);
    default:
      event satisfies never;
      return '';
  }
}

function toneFor(event: BattleEvent): LogTone {
  switch (event.type) {
    case 'action':
      return event.cue !== null ? CUE_TONE[event.cue] : '';
    case 'unit-down':
    case 'end':
      return 'ko';
    case 'round-start':
      return 'round';
    case 'ailment-tick':
      return 'miss';
    case 'ailment-expired':
      return 'guard';
    case 'turn':
    case 'turn-skip':
      return '';
    default:
      event satisfies never;
      return '';
  }
}

function tagFor(event: BattleEvent): string | null {
  if (event.type === 'action' && event.cue !== null) return CUE_TAG[event.cue];
  if (event.type === 'unit-down') return 'ko';
  if (event.type === 'turn-skip') return 'skipped';
  return null;
}

function glyphFor(event: BattleEvent): JSX.Element {
  switch (event.type) {
    case 'round-start':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" strokeLinecap="round" /></svg>;
    case 'unit-down':
    case 'end':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" /></svg>;
    case 'ailment-tick':
    case 'ailment-expired':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 13l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
}

export function BattleFeed({ events, battle }: { readonly events: readonly BattleEvent[]; readonly battle: BattleView }): JSX.Element {
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  // 'turn' is bookkeeping only: the actor already names itself in the action line that follows it.
  // Show only the latest 3 events — the feed is a compact always-on strip.
  const shown = events.filter((event) => event.type !== 'turn').slice(-3);

  useEffect(() => {
    const el = logBodyRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <aside className="feed" aria-label="Battle feed">
      <h4>Battle Feed</h4>
      <div className="feedbody" role="log" aria-live="polite" aria-relevant="additions" ref={logBodyRef}>
        {shown.map((event, idx) => {
          const tag = tagFor(event);
          return (
            <div key={`log-${idx}-${event.at}`} className={`lg ${toneFor(event)}`.trim()}>
              <span className="stripe" aria-hidden="true" />
              <span aria-hidden="true">{glyphFor(event)}</span>
              <span className="ltx">
                <b>R{event.round}</b> {renderEventText(event, battle)}
                {tag !== null ? <span className="tag">{tag}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
