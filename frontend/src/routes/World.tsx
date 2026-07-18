import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppNav } from '../components/AppNav';
import { CombatBody } from '../components/combat/CombatBody';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { EncounterModal } from '../components/world/EncounterModal';
import { TileInfoPanel } from '../components/world/TileInfoPanel';
import { WorldDpad } from '../components/world/WorldDpad';
import { WorldHud } from '../components/world/WorldHud';
import { WorldObjectHint } from '../components/world/WorldObjectHint';
import { useAuth } from '../hooks/useAuth';
import { ApiError, getRoster, type RosterView } from '../lib/api';
import { getBattleView } from '../lib/api';
import { getWorldObjects, getWorldState, moveInWorld, type WorldDirection, type WorldEncounter, type WorldObject, type WorldPosition, type WorldState, type WorldTile } from '../lib/api-world';
import { createWorldScene, type WorldScene } from '../lib/world-scene';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat.css';
import '../styles/extensions-world.css';

const KEY_DIRECTIONS: Readonly<Record<string, WorldDirection>> = {
  w: 'up',
  ArrowUp: 'up',
  a: 'left',
  ArrowLeft: 'left',
  s: 'down',
  ArrowDown: 'down',
  d: 'right',
  ArrowRight: 'right',
};

const MOVE_DEBOUNCE_MS = 140;

export function World(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const activeBattle = useWsStore((state) => state.activeBattle);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const movingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const [worldState, setWorldState] = useState<WorldState | null>(null);
  const [focusedTile, setFocusedTile] = useState<WorldTile | null>(null);
  const [encounter, setEncounter] = useState<WorldEncounter | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [facingRight, setFacingRight] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rosterQuery = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster, staleTime: 30_000 });
  const worldObjectsQuery = useQuery({ queryKey: ['world-objects'] as const, queryFn: getWorldObjects, staleTime: 30_000 });
  const worldObjects = worldObjectsQuery.data?.objects ?? [];
  const battleOverlayVisible = activeBattle !== null && activeBattle.mode === 'pve' && activeBattle.status !== 'ended';
  const partyMons = useMemo(() => {
    const roster: readonly RosterView[] = rosterQuery.data?.roster ?? [];
    const now = Date.now();
    const alive = [0, 1, 2]
      .map((slot) => roster.find((mon) => mon.status === 'party' && mon.slot === slot))
      .filter((mon): mon is RosterView => mon !== undefined && !(mon.reviveAt !== null && mon.reviveAt > now));
    return [alive[0] ?? null, alive[1] ?? null, alive[2] ?? null];
  }, [rosterQuery.data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let scene: WorldScene | null = null;
    let unsubscribe: (() => void) | null = null;
    try {
      scene = createWorldScene(canvas, {
        sphereRadius: 48,
        borderDarken: 1.0,
        ...(worldState ? { viewRadius: worldState.viewRadius } : {}),
      });
      sceneRef.current = scene;
      unsubscribe = scene.subscribe((snapshot) => setFocusedTile(snapshot.tile));
      if (worldState) {
        scene.moveTo(worldState.position.tiles);
      }
      scene.setWorldObjects(worldObjects);
    } catch (error) {
      console.warn('world.webgl.unavailable', error instanceof Error ? error.message : String(error));
    }
    return () => {
      unsubscribe?.();
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [worldState?.viewRadius]);

  useEffect(() => {
    if (worldState) {
      sceneRef.current?.moveTo(worldState.position.tiles);
    }
  }, [worldState]);

  useEffect(() => {
    if (activeBattle?.mode !== 'pve' || activeBattle.status !== 'ended') {
      return;
    }
    let cancelled = false;
    void getWorldState().then((state) => {
      if (!cancelled) {
        setWorldState(state);
      }
    }).catch(() => {
      if (!cancelled) {
        setWorldState((prev) => (prev ? { ...prev, battleActive: false } : prev));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeBattle]);

  useEffect(() => {
    sceneRef.current?.setWorldObjects(worldObjects);
  }, [worldObjects]);

  useEffect(() => {
    let cancelled = false;
    void getWorldState().then((state) => {
      if (cancelled) {
        return;
      }
      setWorldState(state);
      setLoadError(null);
      if (state.battleActive) {
        void getBattleView().then((battle) => {
          if (!cancelled) {
            handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
          }
        }).catch((error: unknown) => {
          if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
            return;
          }
          if (error instanceof Error) {
            setNotice(error.message);
            return;
          }
          throw error;
        });
      }
    }).catch((error: unknown) => {
      if (error instanceof Error && !cancelled) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
    return () => {
      cancelled = true;
    };
  }, [handleServerMessage]);

  const attemptMove = useCallback((dir: WorldDirection): void => {
    if (movingRef.current || worldState?.battleActive) {
      return;
    }
    movingRef.current = true;
    setFacingRight(dir === 'right' ? true : dir === 'left' ? false : facingRight);
    void moveInWorld(dir).then((response) => {
      setWorldState({
        position: response.position,
        partyRating: response.partyRating,
        steps: response.steps,
        viewRadius: worldState?.viewRadius ?? inferViewRadius(response.position),
        battleActive: response.battle !== null,
      });
      setEncounter(response.encounter);
      setNotice(response.battleStartError);
      if (response.battle) {
        handleServerMessage({ type: 'match', matchId: response.battle.id, view: response.battle });
      }
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        return;
      }
      if (error instanceof Error) {
        setNotice(error.message);
        return;
      }
      throw error;
    }).finally(() => {
      movingRef.current = false;
    });
  }, [facingRight, handleServerMessage, worldState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!worldState?.battleActive) {
          navigate('/lobby');
        }
        return;
      }
      if (worldState?.battleActive || debounceRef.current !== null) {
        return;
      }
      const dir = KEY_DIRECTIONS[event.key];
      if (!dir) {
        return;
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
      }, MOVE_DEBOUNCE_MS);
      attemptMove(dir);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [attemptMove, navigate, worldState?.battleActive]);

  const position = worldState?.position ?? null;
  const adjacentObject = useMemo(() => findAdjacentQuestObject(worldObjects, position), [position, worldObjects]);

  return (
    <div className="world-page" style={{ backgroundColor: position?.biome.color ?? 'var(--bg)' }}>
      <AppNav />
      <div className="world-scene-wrap">
        <canvas ref={canvasRef} className="world-canvas" aria-label="World biome map" />
        <div className={facingRight ? 'world-player is-facing-right' : 'world-player'} aria-hidden="true">
          {partyMons[2] != null ? <PlayerMon mon={partyMons[2]} slot="tail" /> : null}
          {partyMons[1] != null ? <PlayerMon mon={partyMons[1]} slot="mid" /> : null}
          <PlayerMon mon={partyMons[0] ?? null} slot="leader" />
        </div>
      </div>
      <div className="world-vignette" />
      <WorldHud biome={position?.biome ?? null} partyRating={worldState?.partyRating ?? null} steps={worldState?.steps ?? null} onNavigateLobby={() => navigate('/lobby')} />
      <WorldObjectHint object={adjacentObject} />
      <TileInfoPanel position={position} focusedTile={focusedTile} />
      <WorldDpad disabled={worldState?.battleActive ?? false} onMove={attemptMove} />
      <EncounterModal encounter={encounter} message={notice ?? loadError} onDismiss={() => { setEncounter(null); setNotice(null); setLoadError(null); }} />
      {battleOverlayVisible ? (
        <div className="world-pve-overlay" role="dialog" aria-modal="true" aria-label="Wild encounter">
          <div className="world-pve-vignette" aria-hidden="true" />
          <div className="world-pve-frame">
            <CombatBody showPageStrip />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function findAdjacentQuestObject(objects: readonly WorldObject[], position: WorldPosition | null): WorldObject | null {
  if (position === null) {
    return null;
  }
  return objects.find((object) => object.questId !== undefined && Math.abs(object.x - position.x) + Math.abs(object.y - position.y) <= 1) ?? null;
}

function inferViewRadius(position: WorldPosition): number {
  const side = Math.sqrt(position.tiles.length);
  return Number.isInteger(side) ? (side - 1) / 2 : 18;
}

function PlayerMon({ mon, slot }: { readonly mon: RosterView | null; readonly slot: 'leader' | 'mid' | 'tail' }): JSX.Element {
  const dotUrl = mon?.template?.assets.dot ?? (mon !== null ? `/assets/digimon/${mon.catalogId}/dot.gif` : '/assets/digimon/skb-50/dot.gif');
  const name = mon?.nickname ?? '';
  return (
    <img
      className={`world-player__mon world-player__mon--${slot}`}
      src={dotUrl}
      alt={name}
      data-slot={slot}
    />
  );
}
