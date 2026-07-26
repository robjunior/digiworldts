import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { getWorldState, moveInWorld, getWorldObjects, type WorldDirection, type WorldState, type WorldTile } from '../lib/api-world';
import { listAdminWorldObjects, createAdminWorldObject, updateAdminWorldObject, deleteAdminWorldObject, listAdminDungeons } from '../lib/api-dungeon-admin';
import { createWorldScene, type WorldScene } from '../lib/world-scene';
import { useAuth } from '../hooks/useAuth';
import type { WorldObject, WorldObjectKind } from '@digiworld/shared/quest';

import { AdminGuard } from '../components/admin/AdminGuard';
import '../styles/extensions-admin.css';

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

const KINDS: WorldObjectKind[] = ['mountain', 'tower', 'city', 'ruin', 'shrine', 'obelisk'];

export function AdminWorld(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const movingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);

  const [worldState, setWorldState] = useState<WorldState | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ x: number, y: number, isObject: boolean, objectId?: string | undefined } | null>(null);

  const objectsQuery = useQuery({ queryKey: ['admin-world-objects'], queryFn: listAdminWorldObjects });
  const dungeonsQuery = useQuery({ queryKey: ['admin-dungeons'], queryFn: listAdminDungeons });
  // We need /api/admin/quests to link quests, but we can use fetch for it if needed or create an api-quest function.
  // Actually, we can just fetch it directly.
  const questsQuery = useQuery({ queryKey: ['admin-quests'], queryFn: async () => {
    const res = await fetch('/api/admin/quests');
    if (!res.ok) throw new Error('Failed to fetch quests');
    return res.json() as Promise<{ quests: any[] }>;
  }});

  const objects = objectsQuery.data?.objects ?? [];

  useEffect(() => {
    let cancelled = false;
    void getWorldState().then((state) => {
      if (!cancelled) setWorldState(state);
    });
    return () => { cancelled = true; };
  }, []);

  const handleCanvasClick = useCallback((x: number, y: number, isObject: boolean, objectId?: string) => {
    setSelectedLocation({ x, y, isObject, ...(objectId ? { objectId } : {}) });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: WorldScene | null = null;
    try {
      scene = createWorldScene(canvas, {
        sphereRadius: 48,
        borderDarken: 1.0,
        onClick: handleCanvasClick,
        ...(worldState ? { viewRadius: worldState.viewRadius } : {}),
      });
      sceneRef.current = scene;
      if (worldState) {
        scene.moveTo(worldState.position.tiles);
      }
      scene.setWorldObjects(objects);
    } catch (error) {
      console.warn('world.webgl.unavailable', error);
    }
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [worldState?.viewRadius, handleCanvasClick]);

  useEffect(() => {
    if (worldState) {
      sceneRef.current?.moveTo(worldState.position.tiles);
    }
  }, [worldState]);

  useEffect(() => {
    sceneRef.current?.setWorldObjects(objects);
  }, [objects]);

  const attemptMove = useCallback((dir: WorldDirection): void => {
    if (movingRef.current) return;
    movingRef.current = true;
    void moveInWorld(dir).then((response) => {
      setWorldState({
        position: response.position,
        partyRating: response.partyRating,
        steps: response.steps,
        viewRadius: worldState?.viewRadius ?? 18,
        battleActive: response.battle !== null,
      });
    }).catch(console.error).finally(() => {
      movingRef.current = false;
    });
  }, [worldState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (selectedLocation) return; // Don't move while dialog is open
      const dir = KEY_DIRECTIONS[event.key];
      if (!dir) return;
      if (debounceRef.current !== null) return;
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
  }, [attemptMove, selectedLocation]);

  const createMut = useMutation({
    mutationFn: createAdminWorldObject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-world-objects'] });
      setSelectedLocation(null);
    }
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string, body: any }) => updateAdminWorldObject(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-world-objects'] });
      setSelectedLocation(null);
    }
  });

  const deleteMut = useMutation({
    mutationFn: deleteAdminWorldObject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-world-objects'] });
      setSelectedLocation(null);
    }
  });

  const createDungeonMut = useMutation({
    mutationFn: async (worldObjectId: string) => {
      const res = await fetch('/api/admin/dungeons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Dungeon',
          biome: 'null',
          width: 10,
          height: 10,
          worldObjectId,
        })
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-dungeons'] });
    }
  });

  const selectedObj = useMemo(() => {
    if (!selectedLocation?.objectId) return null;
    return objects.find(o => o.id === selectedLocation.objectId) ?? null;
  }, [selectedLocation, objects]);

  const renderDialog = () => {
    if (!selectedLocation) return null;

    if (!selectedLocation.isObject || !selectedObj) {
      return (
        <div className="admin-poi-dialog">
          <h3>Create POI at {selectedLocation.x}, {selectedLocation.y}</h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const label = fd.get('label') as string;
            createMut.mutate({
              x: selectedLocation.x,
              y: selectedLocation.y,
              kind: fd.get('kind') as WorldObjectKind,
              scale: 1,
              passable: fd.get('passable') === 'on',
              ...(label ? { label } : {}),
            });
          }}>
            <label>Kind <select name="kind">{KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
            <label>Label <input name="label" type="text" /></label>
            <label><input name="passable" type="checkbox" /> Passable?</label>
            <div className="admin-poi-actions">
              <button type="submit" disabled={createMut.isPending}>Create</button>
              <button type="button" onClick={() => setSelectedLocation(null)}>Cancel</button>
            </div>
          </form>
        </div>
      );
    }

    return (
      <div className="admin-poi-dialog">
        <h3>Edit POI {selectedObj.label || selectedObj.kind}</h3>
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const label = fd.get('label') as string;
          const questId = fd.get('questId') as string;
          const dungeonId = fd.get('dungeonId') as string;
          updateMut.mutate({
            id: selectedObj.id,
            body: {
              kind: fd.get('kind') as WorldObjectKind,
              passable: fd.get('passable') === 'on',
              ...(label ? { label } : {}),
              ...(questId ? { questId } : {}),
              ...(dungeonId ? { dungeonId } : {}),
            }
          });
        }}>
          <label>Kind <select name="kind" defaultValue={selectedObj.kind}>{KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Label <input name="label" type="text" defaultValue={selectedObj.label} /></label>
          <label><input name="passable" type="checkbox" defaultChecked={selectedObj.passable} /> Passable?</label>
          <label>Quest Link 
            <select name="questId" defaultValue={selectedObj.questId ?? ''}>
              <option value="">None</option>
              {questsQuery.data?.quests.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </label>
          <label>Dungeon Link
            <select name="dungeonId" defaultValue={selectedObj.dungeonId ?? ''}>
              <option value="">None</option>
              {dungeonsQuery.data?.dungeons.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {!selectedObj.dungeonId && <button type="button" onClick={() => createDungeonMut.mutate(selectedObj.id)}>Create New Dungeon</button>}
          </label>
          <div className="admin-poi-actions">
            <button type="submit" disabled={updateMut.isPending}>Save</button>
            <button type="button" onClick={() => deleteMut.mutate(selectedObj.id)}>Delete</button>
            <button type="button" onClick={() => setSelectedLocation(null)}>Close</button>
          </div>
        </form>
      </div>
    );
  };

  return (
    <AdminGuard>
      <>
        <header className="admin-world-header">
          <h2>Admin World Editor</h2>
          <p>Use WASD to move. Click to place or edit POIs.</p>
          <button onClick={() => navigate('/admin')}>Back to Admin</button>
        </header>
        <div className="admin-world-view">
          <canvas ref={canvasRef} className="world-canvas" style={{ background: '#111' }} />
          {renderDialog()}
        </div>
      </>
    </AdminGuard>
  );
}
