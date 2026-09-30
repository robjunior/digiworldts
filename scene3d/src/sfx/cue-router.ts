import type { SfxHandle } from './types';

/**
 * CueRouter — a small typed event router that translates game events into
 * SFX *plays* without the game code ever calling the audio engine directly.
 * The game emits CueEvents; the router maps the emit to one or more cues.
 * The engine's `play` is injected through a narrow `PlayFn`, so the router is
 * framework-agnostic (frontend, dungeon HUD, tests).
 *
 * Drives two useful patterns:
 *  - sequential cues with per-cue `delay` offsets (swing, then impact),
 *  - looping travel sounds that the router tracks and `cancelLoops()` stops
 *    when a projectile lands (animation skip-safe via `group`).
 */

/** A named game event, decoupled from any particular engine. */
export type CueEvent =
  | { type: 'tile:hover'; x?: number; y?: number }
  | { type: 'tile:select'; x?: number; y?: number }
  | { type: 'tile:invalid' }
  | { type: 'unit:select'; unitId: string }
  | { type: 'unit:step'; unitId: string; surface: 'grass' | 'stone' | 'wood' | 'water' }
  | { type: 'ability:cast'; skillId?: string; element?: string }
  | { type: 'ability:projectile:start' }
  | { type: 'ability:projectile:stop' }
  | { type: 'ability:hit'; damage: number; crit?: boolean; material: 'flesh' | 'armor' | 'stone' | 'wood'; position?: { screenX: number; viewportWidth: number; onScreen: boolean } }
  | { type: 'ability:miss' }
  | { type: 'ability:block' }
  | { type: 'unit:death' }
  | { type: 'status:apply'; debuff: boolean }
  | { type: 'status:dot'; damage?: number }
  | { type: 'status:heal'; amount?: number }
  | { type: 'turn:start' }
  | { type: 'turn:end' }
  | { type: 'ui:*' };

/** The sound ids playable via cues (the combat + UI + board subset). */
export type CueSoundId =
  | 'tile_hover' | 'tile_select' | 'tile_invalid' | 'unit_select'
  | 'combat_swing' | 'combat_impact' | 'combat_impact_flesh' | 'combat_impact_armor'
  | 'combat_impact_stone' | 'combat_impact_wood' | 'combat_impact_heavy'
  | 'combat_impact_crit' | 'combat_cast' | 'combat_projectile' | 'combat_miss'
  | 'combat_block' | 'combat_fizzle' | 'combat_footstep_grass' | 'combat_footstep_stone'
  | 'combat_footstep_wood' | 'combat_footstep_water'
  | 'status_buff' | 'status_debuff' | 'status_dot' | 'status_heal' | 'status_death'
  | 'turn_start' | 'turn_end'
  | 'ui_hover' | 'ui_click' | 'ui_confirm' | 'ui_back' | 'ui_error' | 'ui_open' | 'ui_close';

/** Options the router passes for one cue play — a subset of SfxPlayOptions. */
export type CueOpts = {
  delay?: number;
  gain?: number;
  pitch?: number;
  loop?: boolean;
  group?: string;
  position?: { screenX: number; viewportWidth: number; onScreen: boolean };
};

/** A cue: the sound + how to play it. */
export type CueStep = { soundId: CueSoundId } & CueOpts;

/** The narrow engine seam the router plays through. */
export type PlayFn = (soundId: CueSoundId, opts: CueOpts) => SfxHandle;

/** The default cue map — data, not code per event. */
export function defaultCues(cue: CueEvent): readonly CueStep[] {
  switch (cue.type) {
    case 'tile:hover': return [{ soundId: 'tile_hover' }];
    case 'tile:select': return [{ soundId: 'tile_select' }];
    case 'tile:invalid': return [{ soundId: 'tile_invalid' }];
    case 'unit:select': return [{ soundId: 'unit_select' }];
    case 'unit:step': return [{ soundId: `combat_footstep_${cue.surface}` as CueSoundId, gain: 0.7 }];
    case 'ability:cast':
      return [
        { soundId: 'combat_cast', gain: 0.9 },
        { soundId: 'combat_projectile', loop: true, group: 'cast', delay: 0.12 },
      ];
    case 'ability:projectile:start':
      return [{ soundId: 'combat_projectile', loop: true, group: 'cast' }];
    case 'ability:projectile:stop':
      return [];
    case 'ability:hit': {
      // Layered impact: base + material; damage scales weight, crit highlights.
      const pos = cue.position;
      const steps: CueStep[] = [
        { soundId: 'combat_impact', gain: 0.8, ...(pos ? { position: pos } : {}) },
        { soundId: `combat_impact_${cue.material}` as CueSoundId, gain: 0.9, ...(pos ? { position: pos } : {}) },
      ];
      if (cue.damage >= 60) steps.push({ soundId: 'combat_impact_heavy', gain: 0.8, delay: 0.02, ...(pos ? { position: pos } : {}) });
      if (cue.crit === true) steps.push({ soundId: 'combat_impact_crit', gain: 1, delay: 0.04, ...(pos ? { position: pos } : {}) });
      return steps;
    }
    case 'ability:miss': return [{ soundId: 'combat_miss' }];
    case 'ability:block': return [{ soundId: 'combat_block' }];
    case 'unit:death': return [{ soundId: 'status_death' }];
    case 'status:apply': return [{ soundId: cue.debuff ? 'status_debuff' : 'status_buff' }];
    case 'status:dot': return [{ soundId: 'status_dot', gain: 0.5 }];
    case 'status:heal': return [{ soundId: 'status_heal' }];
    case 'turn:start': return [{ soundId: 'turn_start' }];
    case 'turn:end': return [{ soundId: 'turn_end' }];
    case 'ui:*': return [{ soundId: 'ui_click' }];
    default: return [];
  }
}

/**
 * A router instance. `playStep` is injected so the router never imports the
 * engine — it just forwards `(soundId, opts)`; looping handles are tracked so
 * `cancelLoops()` can stop travel loops without leaking voices.
 */
export class CueRouter {
  private readonly playStep: PlayFn;
  private readonly map: (cue: CueEvent) => readonly CueStep[];
  private readonly holds = new Set<SfxHandle>();

  constructor(playStep: PlayFn, map: (cue: CueEvent) => readonly CueStep[] = defaultCues) {
    this.playStep = playStep;
    this.map = map;
  }

  /** Feed a game event in; the router translates it to cues and plays them. */
  emit(cue: CueEvent): void {
    for (const step of this.map(cue)) {
      const { soundId, ...opts } = step;
      const handle = this.playStep(soundId, opts);
      if (opts.loop === true) this.holds.add(handle);
    }
  }

  /** Stop every looping cue (projectiles, travel) this router started. */
  cancelLoops(fadeMs = 50): void {
    for (const h of this.holds) { h.stop(fadeMs); this.holds.delete(h); }
  }
}

// ── DOM delegation for UI/board sounds ───────────────────────────────────
// Any element with `data-sfx="ui_click"` plays that sound on pointerup;
// `data-sfx-hover` (a sound id) plays on pointerenter, throttled to ~50 ms so
// sweeping across a tile grid doesn't fire a soundstorm. One document-level
// listener; new widgets need zero wiring.

const HOVER_THROTTLE_MS = 50;

function closestAttr(el: EventTarget | null, attr: string): string | null {
  if (!(el instanceof Element)) return null;
  const node = el.closest(`[${attr}]`);
  if (node === null) return null;
  const v = node.getAttribute(attr);
  return v !== null && v !== '' ? v : null;
}

/** Build a document-scoped delegated handler. `play` receives the trusted
 *  sound id (validated against the cue set) + empty opts. */
export function createDomSfxHandler(play: (soundId: CueSoundId) => void): (e: Event) => void {
  let lastHoverAt = 0;
  return (e: Event): void => {
    const target = e.target;
    const id = closestAttr(target, 'data-sfx');
    if (id !== null) {
      e.preventDefault?.();
      play(id as CueSoundId);
      return;
    }
    const hoverId = closestAttr(target, 'data-sfx-hover');
    if (hoverId !== null) {
      const now = Date.now();
      if (now - lastHoverAt < HOVER_THROTTLE_MS) return;
      lastHoverAt = now;
      play(hoverId as CueSoundId);
    }
  };
}

/** Attach the delegation listener to a root (default document), returning a
 *  detach function. Listen on pointerup for taps and pointerenter for hover. */
export function bindDomSfx(play: (soundId: CueSoundId) => void, root: Document | HTMLElement = document): () => void {
  const handler = createDomSfxHandler(play);
  root.addEventListener('pointerup', handler);
  return () => root.removeEventListener('pointerup', handler);
}

/** Semantic UI click helpers mapping a component intent to a sound id. */
export function uiSoundId(kind: 'hover' | 'click' | 'confirm' | 'back' | 'error' | 'open' | 'close'): CueSoundId {
  switch (kind) {
    case 'hover': return 'ui_hover';
    case 'confirm': return 'ui_confirm';
    case 'back': return 'ui_back';
    case 'error': return 'ui_error';
    case 'open': return 'ui_open';
    case 'close': return 'ui_close';
    case 'click': default: return 'ui_click';
  }
}