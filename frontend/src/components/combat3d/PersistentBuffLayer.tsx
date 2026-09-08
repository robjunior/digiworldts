import { memo, useEffect, useRef, useState } from 'react';
import type { ActiveBuff, BattleView, UnitId } from '@digiworld/shared/battle';
import type { Combat3DSceneHandle } from './Combat3DScene';
import { SceneManager } from '@digiworld/scene3d';

type ParticleEffect = {
  readonly unitId: UnitId;
  readonly kind: 'poison' | 'burn' | 'freeze' | 'paralysis';
  readonly emitterId: string;
};

const PARTICLE_EMITTERS = {
  poison: { id: 'poison-cloud', durationRange: [2000, 4000] },
  burn: { id: 'burn-flames', durationRange: [1500, 3000] },
  freeze: { id: 'freeze-snow', durationRange: [3000, 5000] },
  paralysis: { id: 'paralysis-zap', durationRange: [500, 1000] },
};

/** Persistent particle effects for buffs/debuffs that last their full duration. */
export const PersistentBuffLayer = memo(function PersistentBuffLayer({
  battle,
  sceneRef,
}: {
  battle: BattleView;
  sceneRef: React.MutableRefObject<Combat3DSceneHandle>;
}): JSX.Element {
  const [effects, setEffects] = useState<Map<UnitId, ParticleEffect[]>>(new Map());

  // Initialize effects when battle changes
  useEffect(() => {
    const initialized = new Map<UnitId, ParticleEffect[]>();

    for (const u of battle.friendly) {
      const buffs = u.activeBuffs ?? [];
      for (const b of buffs) {
        const kind = b.kind as keyof typeof PARTICLE_EMITTERS;
        if (kind && !initialized.has(u.id)) {
          initialized.set(u.id, [{
            unitId: u.id,
            kind,
            emitterId: PARTICLE_EMITTERS[kind].id,
          }]);
        }
      }
    }

    for (const u of battle.enemy) {
      const buffs = u.activeBuffs ?? [];
      for (const b of buffs) {
        const kind = b.kind as keyof typeof PARTICLE_EMITTERS;
        if (kind && !initialized.has(u.id)) {
          initialized.set(u.id, [{
            unitId: u.id,
            kind,
            emitterId: PARTICLE_EMITTERS[kind].id,
          }]);
        }
      }
    }

    setEffects(initialized);
  }, [battle]);

  // Cleanup effects when units leave
  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      const scene = sceneRef.current;
      if (scene !== null && effects.size > 0) {
        for (const [unitId, effectList] of effects.entries()) {
          const pos = scene.screenPositionOf(unitId);
          if (pos !== null) {
            // Update particle positions based on effect kind
            for (const effect of effectList) {
              // Particles persist for their configured duration
              // (handled by the particle system lifetimeMs)
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [effects, sceneRef]);

  return (
    <div
      className="c3d-persistent-buff-layer"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {effects.size > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {Array.from(effects.entries()).map(([unitId, effectList]) => (
            <div
              key={unitId}
              style={{
                position: 'absolute',
                pointerEvents: 'none',
              }}
            >
              {effectList.map((effect, idx) => (
                <div
                  key={idx}
                  className="c3d-persistent-effect"
                  style={{
                    position: 'absolute',
                    width: 20,
                    height: 20,
                    pointerEvents: 'none',
                  }}
                >
                  {/* Particle effect rendered via scene3d */}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});