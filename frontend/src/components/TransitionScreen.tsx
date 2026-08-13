import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BattleView } from '@digiworld/shared/battle';
import { BIOME_LABEL, type Biome } from '@digiworld/shared/world';

import { getDungeon } from '../lib/api-dungeon';
import {
  preloadCombatAssets,
  preloadDungeonAssets,
  promiseWithMinDuration,
  unitPortraitUrl,
} from '../lib/asset-preload';
import '../styles/extensions-transition.css';

const DEFAULT_MIN_MS = 1800;

type TransitionScreenProps = {
  readonly mode: 'dungeon' | 'combat';
  readonly dungeonId?: string;
  readonly battle?: BattleView;
  /** Minimum visible time in ms. Default 1800 (1.8 s). */
  readonly minMs?: number;
  readonly onComplete?: () => void;
};

function dungeonSubtitle(biome: Biome | 'null', biomeRegion: string | null): string | null {
  if (biomeRegion !== null && biomeRegion.length > 0) return biomeRegion;
  if (biome !== 'null') return BIOME_LABEL[biome];
  return null;
}

export function TransitionScreen({ mode, dungeonId, battle, minMs = DEFAULT_MIN_MS, onComplete }: TransitionScreenProps): JSX.Element {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const dungeonQuery = useQuery({
    queryKey: ['dungeon', dungeonId],
    queryFn: () => getDungeon(dungeonId as string),
    enabled: mode === 'dungeon' && typeof dungeonId === 'string' && dungeonId.length > 0,
    staleTime: 0,
  });

  const dungeon = dungeonQuery.data ?? null;
  const dungeonName = dungeon?.dungeon.name ?? null;
  const subtitle = useMemo(() => {
    if (dungeon === null) return null;
    return dungeonSubtitle(dungeon.dungeon.biome, dungeon.dungeon.biomeRegion);
  }, [dungeon]);

  const enemies = useMemo(() => (mode === 'combat' ? battle?.enemy ?? [] : []), [mode, battle]);

  useEffect(() => {
    let cancelled = false;

    // Warm the lazy destination chunk (Combat) during the splash — best effort,
    // never awaited. Dungeon is imported eagerly, so no chunk to warm for W→D.
    if (mode === 'combat') {
      void import('../routes/Combat').catch((err) => { console.warn('transition.chunk.preload.fail', err); });
    }

    const preload =
      mode === 'combat' && battle !== undefined
        ? preloadCombatAssets(battle)
        : mode === 'dungeon' && typeof dungeonId === 'string' && dungeonId.length > 0
          ? preloadDungeonAssets(dungeonId)
          : Promise.resolve();

    // Preload helpers never throw; the defensive catch guarantees onComplete
    // fires even if a future refactor lets a rejection through.
    void promiseWithMinDuration(preload.catch(() => {}), minMs).then(() => {
      if (!cancelled) onCompleteRef.current?.();
    });

    return () => { cancelled = true; };
  }, [mode, battle, dungeonId, minMs]);

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
        ) : (
          <>
            <h1 className="tr-title">{dungeonName ?? 'Entering Dungeon…'}</h1>
            <p className="tr-sub">{subtitle ?? 'Descending into the unknown…'}</p>
          </>
        )}
        <div className="tr-progress" aria-hidden="true">
          <div className="tr-progress-bar" style={{ animationDuration: `${minMs}ms` }} />
        </div>
        <div className="tr-hint">Loading assets…</div>
      </div>
    </div>
  );
}
