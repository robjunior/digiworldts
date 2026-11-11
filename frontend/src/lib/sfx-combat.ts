import { CueRouter } from '@digiworld/scene3d/sfx/index';
import type { CueEvent } from '@digiworld/scene3d/sfx/index';
import type { BattleEvent, BattleView, UnitId } from '@digiworld/shared/battle';

import { getSfxEngine } from './sfx-bootstrap';

/**
 * Bridge between the game's battle-event stream (from the WS/store) and the
 * CueRouter. Translates `BattleEvent` records into `CueEvent`s and plays them
 * through the shared engine's `CueRouter`, providing screen positions for
 * isometric spatialization from the scene when available.
 *
 * Game code never calls the audio engine directly — it pushes `BattleEvent`s
 * here (the router owns the sound mapping) — matching the spec's "roteador
 * escuta eventos e traduz em SFX".
 */

export type ScreenPosProvider = (unitId: UnitId) => { x: number; y: number; viewportW: number } | null;

/** Convert a shutdown/box state into an empty CueEvent set when the match is
 *  not active. */
export function battleEventToCue(
  event: BattleEvent,
): CueEvent[] {
  switch (event.type) {
    case 'turn':
      return [{ type: 'turn:start' }];
    case 'turn-skip':
      return [];
    case 'round-start':
      return [{ type: 'turn:end' }];
    case 'unit-down':
      return [{ type: 'unit:death' }];
    case 'ailment-tick':
      return [{ type: 'status:dot', damage: event.damage }];
    case 'ailment-expired':
      return [];
    case 'action': {
      const cue = event.cue;
      if (cue === 'miss') return [{ type: 'ability:miss' }];
      if (cue === 'immune') return [{ type: 'ability:block' }];
      if (event.action?.type === 'fight') {
        return [{ type: 'ability:hit', damage: event.damage ?? 0, crit: cue === 'crit', material: 'flesh' }];
      }
      if (event.damage !== undefined && event.damage > 0) {
        return [{ type: 'ability:hit', damage: event.damage, crit: cue === 'crit', material: 'armor' }];
      }
      // Heal / buffs from a skill action.
      if (event.damage !== undefined && event.damage < 0) {
        return [{ type: 'status:heal', amount: Math.abs(event.damage) }];
      }
      const skillId = typeof event.skillName === 'string' && event.skillName !== '' ? event.skillName : undefined;
      return skillId !== undefined
        ? [{ type: 'ability:cast', skillId }]
        : [{ type: 'ability:cast' }];
    }
    case 'end':
      return [];
    default:
      return [];
  }
}

/**
 * Feed a battle view + new events into the engine's router. `pos` supplies
 * the target's screen projection for spatial audio; `viewportW` feeds pan.
 */
export function playBattleEvents(
  events: readonly BattleEvent[],
  pos: ScreenPosProvider,
  viewportW: number,
): void {
  const engine = getSfxEngine();
  if (engine === null) return; // no audio backend (inert / unsupported)
  const router = new CueRouter((soundId, opts) => engine.play(soundId, opts));
  for (const event of events) {
    for (const cue of battleEventToCue(event)) {
      // Attach a screen position for spatialization when we have a target.
      const p = typeof event === 'object' && event !== null && 'targetId' in event && typeof event.targetId === 'string'
        ? pos(event.targetId as UnitId)
        : null;
      let enriched: CueEvent = cue;
      if (p !== null && cue.type === 'ability:hit') {
        enriched = { ...cue, position: { screenX: p.x, viewportWidth: viewportW, onScreen: true } };
      }
      router.emit(enriched);
    }
  }
}