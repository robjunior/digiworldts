import type { Action, BattleView, EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { isAnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';

export const ATTACK_PROPAGATION_MS = 700;
export const AUTOBATTLE_STORAGE_KEY = 'digiworld.autobattle';
export const AUTOBATTLE_DELAY_MS = 400;
export const FLOATER_DURATION_MS = 900;
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
        ...(skill.vfxPresetId !== undefined ? { vfxPresetId: skill.vfxPresetId } : {}),
      };
    }
    return null;
  }
  if (action.type === 'fight' && isAnimatedElement(actor.element)) {
    return { sourceId: actor.id, targetId: action.targetId, element: actor.element };
  }
  return null;
}
