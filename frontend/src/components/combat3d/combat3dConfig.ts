import type { BattleEvent, Action, BattleView, EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { isAnimatedElement, DEFAULT_EFFECT_DURATION_S } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import { isRangedEffect, namedEffectDuration } from '@digiworld/scene3d/attack-runners/named';

export const ATTACK_PROPAGATION_MS = 700;
export const TURN_GAP_MS = 3000;
/** Small breathing pause appended AFTER a visual effect completes, so the impact
 *  reads and the next turn doesn't snap in mid-settle. */
export const EFFECT_TAIL_MS = 250;
export const AUTOBATTLE_STORAGE_KEY = 'digiworld.autobattle';
export const AUTOBATTLE_DELAY_MS = 400;
export const FLOATER_Y_OFFSET = 20;

/** One entry in the enemy playback queue. `playVfx` is decided per cast so a
 *  single skill that emits several events (damage + status) only fires one
 *  impact effect rather than one per event. */
export type EnemyPlaybackEntry = {
  readonly event: BattleView['log'][number];
  readonly playVfx: boolean;
};

export type PlayerVfx = {
  readonly sourceId: UnitId;
  readonly targetId: UnitId;
  readonly element: AnimatedElement;
  readonly vfxPresetId?: string;
  /** `basic` = melee dash/slash; `skill` = ranged cast. Derived from the action
   *  type so the scene routes the effect to the right runner family. */
  readonly attackKind: 'basic' | 'skill';
};

export function readAutobattlePref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTOBATTLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAutobattlePref(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTOBATTLE_STORAGE_KEY, on ? '1' : '0');
  } catch {
    return;
  }
}

export function pickAutoAction(actor: FriendlyUnitView, enemies: readonly EnemyUnitView[]): Action | null {
  const alive = enemies.filter((e) => !e.down && e.hp > 0);
  if (alive.length === 0) return null;
  const target = alive.reduce((low, e) => (e.hp < low.hp ? e : low));
  const affordable = actor.skills.filter((s) => s.energyCost <= actor.en);
  if (affordable.length > 0) {
    const best = affordable.reduce((a, b) => (b.power > a.power ? b : a));
    return { type: 'skill', unitId: actor.id, skillId: best.id, targetId: target.id };
  }
  return { type: 'fight', unitId: actor.id, targetId: target.id };
}

export function extractPlayerVfx(actor: FriendlyUnitView | null, action: Action): PlayerVfx | null {
  if (actor === null) return null;
  if (action.type === 'skill') {
    const skill = actor.skills.find((s) => s.id === action.skillId);
    if (skill && isAnimatedElement(skill.element)) {
      return {
        sourceId: actor.id,
        targetId: action.targetId,
        element: skill.element,
        attackKind: 'skill',
        ...(skill.vfxPresetId !== undefined ? { vfxPresetId: skill.vfxPresetId } : {}),
      };
    }
    return null;
  }
  if (action.type === 'fight' && isAnimatedElement(actor.element)) {
    return {
      sourceId: actor.id,
      targetId: action.targetId,
      element: actor.element,
      attackKind: 'basic',
    };
  }
  return null;
}

/**
 * How long a single attack's visual effect runs, mirroring `scene.playEffect`'s
 * duration resolution exactly: a named ranged skill effect keeps its registered
 * duration; every other playable case (melee basic, unresolved/stored preset,
 * element fallback) uses the default effect length. Returns the attack
 * propagation delay when no VFX plays (a no-element or no-action event).
 */
function vfxDurationMs(namedPresetId: string | undefined | null, attackKind: 'basic' | 'skill'): number {
  if (attackKind === 'skill' && namedPresetId !== undefined && isRangedEffect(namedPresetId)) {
    return Math.round(namedEffectDuration(namedPresetId) * 1000);
  }
  return Math.round(DEFAULT_EFFECT_DURATION_S * 1000);
}

/** Duration of the player's own action effect — gates sending the action to the
 *  server until the cast's VFX has fully played. */
export function playerEffectDurationMs(actor: FriendlyUnitView | null, action: Action): number {
  const vfx = extractPlayerVfx(actor, action);
  if (vfx === null) return ATTACK_PROPAGATION_MS;
  return vfxDurationMs(vfx.vfxPresetId, vfx.attackKind);
}

/** Duration an enemy cast's VFX runs, from its battle event. `playVfx === false`
 *  marks a same-cast follow-up event (second floater), which only needs the
 *  short propagation gap. */
export function effectDurationMs(event: BattleEvent, playVfx: boolean): number {
  if (!playVfx || event.type !== 'action') return ATTACK_PROPAGATION_MS;
  const { skillElement, vfxPresetId, action } = event;
  if (!isAnimatedElement(skillElement)) return ATTACK_PROPAGATION_MS;
  const attackKind: 'basic' | 'skill' = action.type === 'fight' ? 'basic' : 'skill';
  return vfxDurationMs(vfxPresetId, attackKind);
}
