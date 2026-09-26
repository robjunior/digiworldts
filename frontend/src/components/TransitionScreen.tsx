import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BattleView } from '@digiworld/shared/battle';

import {
  preloadCombatAssets,
  promiseWithMinDuration,
  unitPortraitUrl,
} from '../lib/asset-preload';
import '../styles/extensions-transition.css';

const DEFAULT_MIN_MS = 1800;

type TransitionScreenProps = {
  readonly mode: 'combat';
  readonly battle?: BattleView;
  readonly minMs?: number;
  readonly onComplete?: () => void;
};

export function TransitionScreen({ mode, battle, minMs = DEFAULT_MIN_MS, onComplete }: TransitionScreenProps): JSX.Element {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const enemies = useMemo(() => (mode === 'combat' ? battle?.enemy ?? [] : []), [mode, battle]);

  useEffect(() => {
    let cancelled = false;

    if (mode === 'combat') {
      void import('../routes/Combat').catch((err) => { console.warn('transition.chunk.preload.fail', err); });
    }

    const preload =
      mode === 'combat' && battle !== undefined
        ? preloadCombatAssets(battle)
        : Promise.resolve();

    void promiseWithMinDuration(preload.catch(() => {}), minMs).then(() => {
      if (!cancelled) onCompleteRef.current?.();
    });

    return () => { cancelled = true; };
  }, [mode, battle, minMs]);

  const vs = useCallback(() => {
    if (enemies.length === 0) return null;
    return (
      <div className="tr-enemy-row" role="list">
        {enemies.map((enemy, index) => (
          <div className="tr-enemy" role="listitem" key={enemy.id}>
            <div className="tr-portrait-frame">
              <img
                className="tr-portrait"
                src={unitPortraitUrl(enemy.templateId)}
                alt={enemy.name}
                loading="eager"
                draggable={false}
              />
              <span className="tr-level">Lv {enemy.level}</span>
            </div>
            <span className="tr-enemy-name">{enemy.name}</span>
            {index < enemies.length - 1 ? <span className="tr-vs" aria-hidden="true">VS</span> : null}
          </div>
        ))}
      </div>
    );
  }, [enemies]);

  return (
    <div className="transition-screen" data-mode={mode} role="status" aria-live="polite">
      <div className="tr-card">
        <div className="tr-kicker">DigiWorld</div>
        {mode === 'combat' ? (
          <>
            <h1 className="tr-title">Wild Encounter</h1>
            <p className="tr-sub">Enemies spotted — bracing for battle.</p>
            {vs()}
          </>
        ) : null}
        <div className="tr-progress" aria-hidden="true">
          <div className="tr-progress-bar" style={{ animationDuration: `${minMs}ms` }} />
        </div>
        <div className="tr-hint">Loading assets…</div>
      </div>
    </div>
  );
}
