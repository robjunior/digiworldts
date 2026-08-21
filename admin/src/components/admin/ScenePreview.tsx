import { useEffect, useRef } from 'react';

import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { ARENA_MODEL_BY_KEY, getArenaUrl } from '@digiworld/scene3d/arena-urls';
import { SceneManager, type SceneSettings } from '@digiworld/scene3d/scene';

type ScenePreviewProps = {
  readonly arenaKey: string;
  readonly settings: SceneSettings;
  readonly weather?: WeatherConfig | null;
  readonly timeOfDay?: TimeOfDayConfig | null;
};

const PLACEHOLDER_UNITS = [
  { unitId: 'preview:you:0', side: 'you' as const, slotIndex: 0, textureUrl: '/assets/digimon/skb-1/dot.gif', onClick: undefined },
  { unitId: 'preview:you:1', side: 'you' as const, slotIndex: 1, textureUrl: '/assets/digimon/skb-2/dot.gif', onClick: undefined },
  { unitId: 'preview:you:2', side: 'you' as const, slotIndex: 2, textureUrl: '/assets/digimon/skb-3/dot.gif', onClick: undefined },
  { unitId: 'preview:opp:0', side: 'opp' as const, slotIndex: 0, textureUrl: '/assets/digimon/skb-10/dot.gif', onClick: undefined },
  { unitId: 'preview:opp:1', side: 'opp' as const, slotIndex: 1, textureUrl: '/assets/digimon/skb-12/dot.gif', onClick: undefined },
];

export function ScenePreview({ arenaKey, settings, weather, timeOfDay }: ScenePreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<SceneManager | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    let manager: SceneManager | null = null;
    try {
      manager = new SceneManager(canvas);
    } catch {
      return;
    }
    managerRef.current = manager;
    const rect = container.getBoundingClientRect();
    manager.resize(rect.width, rect.height);
    manager.startLoop();
    manager.runEntrance();
    for (const unit of PLACEHOLDER_UNITS) {
      manager.addSprite(unit);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        managerRef.current?.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      manager?.dispose();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    if (manager === null) return;
    manager.clearArenaModel();
    const picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
    const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
    if (url === undefined) return;
    void manager.loadArenaModelWithAtmosphere(url, arenaKey).catch(() => {});
  }, [arenaKey, settings.modelFile]);

  useEffect(() => {
    managerRef.current?.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    managerRef.current?.setWeather(weather ?? null);
  }, [weather]);

  useEffect(() => {
    managerRef.current?.setTimeOfDay(timeOfDay ?? null);
  }, [timeOfDay]);

  return (
    <div ref={containerRef} className="scene-admin-preview">
      <canvas ref={canvasRef} className="scene-admin-preview-canvas" aria-label="Live scene preview" />
    </div>
  );
}
