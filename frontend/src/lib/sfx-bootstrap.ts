import { bindDomSfx, createBrowserBackend, SfxEngine } from '@digiworld/scene3d/sfx/index';
import type { CueSoundId } from '@digiworld/scene3d/sfx/index';

/**
 * Lazy global audio bootstrap for the frontend: one `SfxEngine` over the
 * browser Web Audio backend, with DOM `data-sfx` / `data-sfx-hover`
 * delegation bound to the document and the whole manifest preload kicked off
 * (progress reported to console.warn until a progress UI accepts a callback).
 *
 * It is intentionally lazy — no AudioContext is created until an actual UI
 * sound is requested (or a screen explicitly calls `ensureSfx()`). This keeps
 * the autoplay gate honest (the first pointerdown resumes the context) and
 * avoids paying the AudioContext cost on screens that never play a sound.
 */

let engine: SfxEngine | null = null;
let unbind: (() => void) | null = null;
let bootAttempted = false;

function ensure(): SfxEngine | null {
  if (engine !== null) return engine;
  const built = createBrowserBackend();
  if (!built.ok) {
    if (!bootAttempted) {
      console.warn('sfx.bootstrap.fail', built.reason);
      bootAttempted = true;
    }
    return null;
  }
  engine = new SfxEngine({ backend: built.backend });
  // DOM delegation: any element with data-sfx / data-sfx-hover plays on tap /
  // (throttled) hover — zero per-widget wiring needed.
  unbind = bindDomSfx((soundId: CueSoundId) => {
    engine?.play(soundId, {});
  });
  // Prime the manifest. Best-effort: failures are silently skipped per-asset.
  void engine.preload((loaded, total, fraction) => {
    if (fraction >= 1) console.info(`sfx.preload.done ${loaded}/${total}`);
  });
  return engine;
}

/** Force-create the engine (call on the combat screen so SFX are ready). */
export function ensureSfx(): SfxEngine | null {
  return ensure();
}

/** Access the engine without force-creating (null before first use). */
export function getSfxEngine(): SfxEngine | null {
  return engine;
}

export function playUiSfx(soundId: CueSoundId): void {
  ensure()?.play(soundId, {});
}

/** Tear down (page-unload / HMR). */
export function disposeSfx(): void {
  unbind?.();
  unbind = null;
  engine?.dispose();
  engine = null;
}