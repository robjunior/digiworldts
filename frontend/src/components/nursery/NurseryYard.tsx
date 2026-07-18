import { useEffect, useMemo, useRef, useState } from 'react';

import type { NurseryMon, PendingHatchEntry } from '../../lib/api-nursery';
import { createWorldScene, type BendedTile } from '../../lib/world-scene';
import { PendingEgg } from './PendingEgg';

const YARD_TILES = 25;
const YARD_VIEW_RADIUS = 12;
const YARD_SPHERE_RADIUS = 48;
const SPRITE_SIZE = 64;
const SPEED_PX_PER_FRAME = 0.64;

export type NurseryFeedback = {
  readonly monId: string;
  readonly kind: 'pet' | 'feed';
  readonly nonce: number;
};

type SpriteState = {
  readonly mon: NurseryMon;
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
  readonly nextTargetAt: number;
  readonly nextJumpAt: number;
  readonly jumpingUntil: number;
  readonly pettingUntil: number;
  readonly facingRight: boolean;
};

export function NurseryYard({ mons, feedback, pending, busyHatchId, onCollect }: { readonly mons: readonly NurseryMon[]; readonly feedback: NurseryFeedback | null; readonly pending: readonly PendingHatchEntry[]; readonly busyHatchId: string | null; readonly onCollect: (entry: PendingHatchEntry) => void }): JSX.Element {
  const yardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sprites, setSprites] = useState<readonly SpriteState[]>([]);
  const [yardSize, setYardSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const tiles = useMemo(() => generateYardTiles(0x9e3779b1), []);
  const signature = useMemo(() => mons.map((mon) => mon.id).sort().join(','), [mons]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    let scene: ReturnType<typeof createWorldScene<BendedTile>> | null = null;
    try {
      scene = createWorldScene<BendedTile>(canvas, {
        viewRadius: YARD_VIEW_RADIUS,
        sphereRadius: YARD_SPHERE_RADIUS,
        borderDarken: 1.0,
      });
      scene.moveTo(tiles.map((color) => ({ color })));
    } catch (error) {
      console.warn('nursery.webgl.unavailable', error instanceof Error ? error.message : String(error));
    }
    return () => {
      scene?.dispose();
    };
  }, [tiles]);

  useEffect(() => {
    const yard = yardRef.current;
    if (yard === null) {
      return;
    }
    setSprites((prev) => {
      const fresh = seedSpritePositions(mons, yard.clientWidth, yard.clientHeight);
      return fresh.map((next) => {
        const existing = prev.find((item) => item.mon.id === next.mon.id);
        if (existing === undefined) {
          return next;
        }
        return {
          ...next,
          x: existing.x,
          y: existing.y,
          tx: existing.tx,
          ty: existing.ty,
          nextTargetAt: existing.nextTargetAt,
          nextJumpAt: existing.nextJumpAt,
          jumpingUntil: existing.jumpingUntil,
          pettingUntil: existing.pettingUntil,
          facingRight: existing.facingRight,
        };
      });
    });
  }, [signature]);

  useEffect(() => {
    if (feedback === null) {
      return;
    }
    const now = performance.now();
    setSprites((items) => items.map((item) => item.mon.id === feedback.monId ? { ...item, pettingUntil: feedback.kind === 'pet' ? now + 560 : item.pettingUntil } : item));
  }, [feedback]);

  useEffect(() => {
    let frame = 0;
    const tick = (time: number): void => {
      const yard = yardRef.current;
      if (yard !== null) {
        setSprites((items) => stepSprites(items, time, yard.clientWidth, yard.clientHeight));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const yard = yardRef.current;
    if (yard === null) return;
    const update = (): void => setYardSize({ width: yard.clientWidth, height: yard.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(yard);
    return () => observer.disconnect();
  }, []);

  const eggPositions = useMemo(() => positionEggs(pending, yardSize.width, yardSize.height), [pending, yardSize.width, yardSize.height]);

  return (
    <div className="yard" id="yard" ref={yardRef}>
      <canvas id="yard-canvas" ref={canvasRef} />
      <div className="yard-header">Nursery</div>
      {sprites.map((sprite) => <NurserySprite key={sprite.mon.id} sprite={sprite} feedback={feedback} />)}
      {pending.map((entry) => {
        const pos = eggPositions.get(entry.id);
        if (pos === undefined) return null;
        return (
          <PendingEgg
            key={entry.id}
            entry={entry}
            x={pos.x}
            y={pos.y}
            busy={busyHatchId === entry.id}
            onCollect={onCollect}
          />
        );
      })}
    </div>
  );
}

function NurserySprite({ sprite, feedback }: { readonly sprite: SpriteState; readonly feedback: NurseryFeedback | null }): JSX.Element {
  const classes = ['mon-sprite'];
  if (sprite.facingRight) classes.push('is-facing-right');
  if (performance.now() < sprite.jumpingUntil) classes.push('is-jumping');
  if (performance.now() < sprite.pettingUntil) classes.push('is-petting');
  const showFeedback = feedback !== null && feedback.monId === sprite.mon.id;

  return (
    <div className={classes.join(' ')} data-id={sprite.mon.id} style={{ transform: `translate(${sprite.x - SPRITE_SIZE / 2}px, ${sprite.y - SPRITE_SIZE / 2}px)` }}>
      <img src={`/assets/digimon/${sprite.mon.catalogId}/dot.gif`} alt={sprite.mon.nickname} onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} />
      <div className="label">{sprite.mon.nickname}</div>
      {showFeedback && feedback.kind === 'pet' ? <div key={feedback.nonce} className="heart" aria-hidden="true" /> : null}
      {showFeedback && feedback.kind === 'feed' ? <div key={feedback.nonce} className="food" aria-hidden="true" /> : null}
    </div>
  );
}

function seedSpritePositions(mons: readonly NurseryMon[], width: number, height: number): readonly SpriteState[] {
  const marginX = width * 0.15;
  const marginY = height * 0.25;
  return mons.map((mon, index) => {
    const x = marginX + seededFraction(index + 11) * Math.max(1, width - 2 * marginX);
    const y = marginY + seededFraction(index + 29) * Math.max(1, height - 2 * marginY);
    const now = performance.now();
    return { mon, x, y, tx: x, ty: y, nextTargetAt: now + 300 + seededFraction(index + 43) * 1200, nextJumpAt: now + 2000 + seededFraction(index + 71) * 6000, jumpingUntil: 0, pettingUntil: 0, facingRight: false };
  });
}

function stepSprites(items: readonly SpriteState[], time: number, width: number, height: number): readonly SpriteState[] {
  return items.map((item) => stepSprite(item, time, width, height));
}

function stepSprite(item: SpriteState, time: number, width: number, height: number): SpriteState {
  if (time < item.pettingUntil) {
    return item;
  }
  const dx = item.tx - item.x;
  const dy = item.ty - item.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2 || time > item.nextTargetAt) {
    return retarget(item, time, width, height);
  }
  const move = Math.min(SPEED_PX_PER_FRAME, dist);
  const jumpingUntil = time > item.nextJumpAt ? time + 550 : item.jumpingUntil;
  const nextJumpAt = time > item.nextJumpAt ? time + 3000 + Math.random() * 8000 : item.nextJumpAt;
  return { ...item, x: item.x + (dx / dist) * move, y: item.y + (dy / dist) * move, facingRight: dx > 0, jumpingUntil, nextJumpAt };
}

function retarget(item: SpriteState, time: number, width: number, height: number): SpriteState {
  const marginX = width * 0.12;
  const marginY = height * 0.22;
  return { ...item, tx: marginX + Math.random() * Math.max(1, width - 2 * marginX), ty: marginY + Math.random() * Math.max(1, height - 2 * marginY), nextTargetAt: time + 800 + Math.random() * 2500 };
}

function generateYardTiles(seed: number): readonly string[] {
  const palette = ['#3f7d40', '#4a8f4c', '#5aa060', '#3d6b3f', '#66aa6c', '#7a5c3f', '#d4a24a', '#d47a9a'] as const;
  const weights = [22, 30, 22, 12, 10, 2, 1, 1] as const;
  const total = weights.reduce((sum, value) => sum + value, 0);
  let state = seed;
  return Array.from({ length: YARD_TILES * YARD_TILES }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    const roll = (state / 0xffffffff) * total;
    let acc = 0;
    for (let index = 0; index < weights.length; index += 1) {
      acc += weights[index] ?? 0;
      if (roll < acc) {
        return palette[index] ?? palette[1];
      }
    }
    return palette[1];
  });
}

function seededFraction(seed: number): number {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

function positionEggs(pending: readonly PendingHatchEntry[], width: number, height: number): Map<string, { readonly x: number; readonly y: number }> {
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  if (pending.length === 0 || width <= 0 || height <= 0) return positions;
  const marginX = width * 0.14;
  const marginY = height * 0.20;
  const usableW = Math.max(1, width - 2 * marginX);
  const bandTop = marginY;
  const bandBottom = marginY + Math.min(height * 0.30, 120);
  const columns = Math.max(1, Math.min(pending.length, Math.floor(usableW / 96)));
  pending.forEach((entry, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const step = usableW / Math.max(1, columns);
    const jitterSeed = hashString(entry.id);
    const jitterX = (seededFraction(jitterSeed + 3) - 0.5) * step * 0.4;
    const jitterY = (seededFraction(jitterSeed + 7) - 0.5) * 12;
    const x = marginX + step * col + step / 2 + jitterX;
    const yBase = bandTop + row * 72;
    const y = Math.min(bandBottom + row * 72, yBase + jitterY);
    positions.set(entry.id, { x, y });
  });
  return positions;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
