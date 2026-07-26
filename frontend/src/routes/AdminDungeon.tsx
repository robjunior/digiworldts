import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getAdminDungeon, updateAdminDungeon, putAdminDungeonTiles, createAdminEncounter, updateAdminEncounter, deleteAdminEncounter, createAdminItem, deleteAdminItem } from '../lib/api-dungeon-admin';
import { getCatalog } from '../lib/api-admin';
import type { DungeonEncounter, DungeonItem, EncounterDigimon } from '@digiworld/shared';
import { AdminGuard } from '../components/admin/AdminGuard';
import '../styles/extensions-admin.css';

type Layer = 'PATH' | 'ENCOUNTERS' | 'ITEMS';

export function AdminDungeon(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [layer, setLayer] = useState<Layer>('PATH');
  const [selectedCell, setSelectedCell] = useState<{ x: number, y: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-dungeon', id],
    queryFn: () => getAdminDungeon(id!)
  });

  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: getCatalog });

  const tilesMut = useMutation({
    mutationFn: (tiles: { x: number; y: number }[]) => putAdminDungeonTiles(id!, tiles),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', id] })
  });

  if (isLoading || !data) return <div>Loading...</div>;

  const { dungeon, tiles, encounters, items } = data;

  const tileSet = new Set(tiles.map(t => `${t.x},${t.y}`));

  const handleCellClick = (x: number, y: number) => {
    setSelectedCell({ x, y });
    if (layer === 'PATH') {
      const key = `${x},${y}`;
      let newTiles = [...tiles];
      if (tileSet.has(key)) {
        newTiles = newTiles.filter(t => t.x !== x || t.y !== y);
      } else {
        newTiles.push({ x, y });
      }
      tilesMut.mutate(newTiles);
    }
  };

  const encounterAt = (x: number, y: number) => encounters.find(e => e.x === x && e.y === y);
  const itemAt = (x: number, y: number) => items.find(i => i.x === x && i.y === y);

  return (
    <AdminGuard>
      <>
        <header className="admin-dungeon-header">
            <h2>{dungeon.name} ({dungeon.width}x{dungeon.height}) - {dungeon.biome}</h2>
            <div className="layer-picker">
              <button className={layer === 'PATH' ? 'is-active' : ''} onClick={() => setLayer('PATH')}>PATH</button>
              <button className={layer === 'ENCOUNTERS' ? 'is-active' : ''} onClick={() => setLayer('ENCOUNTERS')}>ENCOUNTERS</button>
              <button className={layer === 'ITEMS' ? 'is-active' : ''} onClick={() => setLayer('ITEMS')}>ITEMS</button>
            </div>
            <button onClick={() => navigate('/admin')}>Leave</button>
          </header>

          <div className="admin-dungeon-body">
            <div className="admin-dungeon-grid-wrapper">
              <div 
                className="admin-dungeon-grid" 
                style={{ 
                  display: 'grid', 
                  gridTemplateColumns: `repeat(${dungeon.width}, 32px)`, 
                  gridTemplateRows: `repeat(${dungeon.height}, 32px)` 
                }}
              >
                {Array.from({ length: dungeon.height }).map((_, y) => 
                  Array.from({ length: dungeon.width }).map((_, x) => {
                    const isWalkable = tileSet.has(`${x},${y}`);
                    const enc = encounterAt(x, y);
                    const it = itemAt(x, y);
                    const isSelected = selectedCell?.x === x && selectedCell?.y === y;
                    return (
                      <button
                        key={`${x},${y}`}
                        className={`dungeon-cell ${isWalkable ? 'is-walkable' : ''} ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleCellClick(x, y)}
                        aria-label={`Cell ${x},${y}`}
                      >
                        {enc && 'E'}
                        {it && 'I'}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            
            <aside className="admin-dungeon-sidebar">
              {selectedCell && layer === 'ENCOUNTERS' && tileSet.has(`${selectedCell.x},${selectedCell.y}`) && (
                <EncounterEditor 
                  dungeonId={id!} 
                  x={selectedCell.x} 
                  y={selectedCell.y} 
                  encounter={encounterAt(selectedCell.x, selectedCell.y)} 
                  catalog={catalogQuery.data?.digimons ?? []} 
                />
              )}
              {selectedCell && layer === 'ITEMS' && tileSet.has(`${selectedCell.x},${selectedCell.y}`) && (
                <ItemEditor 
                  dungeonId={id!} 
                  x={selectedCell.x} 
                  y={selectedCell.y} 
                  item={itemAt(selectedCell.x, selectedCell.y)} 
                />
              )}
              {selectedCell && layer === 'PATH' && (
                <div>Cell {selectedCell.x}, {selectedCell.y}</div>
              )}
              {!selectedCell && <div>Select a cell</div>}
            </aside>
          </div>
      </>
    </AdminGuard>
  );
}

function EncounterEditor({ dungeonId, x, y, encounter, catalog }: { dungeonId: string, x: number, y: number, encounter?: DungeonEncounter | undefined, catalog: readonly any[] }) {
  const queryClient = useQueryClient();
  const createMut = useMutation({
    mutationFn: (body: any) => createAdminEncounter(dungeonId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', dungeonId] })
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string, body: any }) => updateAdminEncounter(dungeonId, id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', dungeonId] })
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminEncounter(dungeonId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', dungeonId] })
  });

  const [digimonList, setDigimonList] = useState<EncounterDigimon[]>(encounter?.digimon ? [...encounter.digimon] : []);

  if (!encounter && !createMut.isPending) {
    return (
      <div>
        <h3>No Encounter at {x},{y}</h3>
        <button onClick={() => createMut.mutate({ x, y, digimon: [{ catalogId: catalog[0]?.id || 'agumon', level: 1 }] })}>Add Encounter</button>
      </div>
    );
  }

  if (!encounter) return <div>Creating...</div>;

  return (
    <div className="admin-editor-panel">
      <h3>Edit Encounter</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        updateMut.mutate({
          id: encounter.id,
          body: {
            label: fd.get('label') as string || undefined,
            difficulty: fd.get('difficulty') as any,
            digimon: digimonList
          }
        });
      }}>
        <label>Label <input name="label" defaultValue={encounter.label ?? ''} /></label>
        <label>Difficulty 
          <select name="difficulty" defaultValue={encounter.difficulty}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="elite">Elite</option>
            <option value="boss">Boss</option>
          </select>
        </label>
        
        <h4>Digimon</h4>
        {digimonList.map((d, i) => (
          <div key={i} className="editor-sub-panel">
            <select value={d.catalogId} onChange={(e) => {
              const newList = [...digimonList];
              newList[i] = { ...d, catalogId: e.target.value };
              setDigimonList(newList);
            }}>
              {catalog.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" value={d.level} onChange={(e) => {
              const newList = [...digimonList];
              newList[i] = { ...d, level: parseInt(e.target.value, 10) };
              setDigimonList(newList);
            }} />
            <button type="button" onClick={() => setDigimonList(digimonList.filter((_, idx) => idx !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" onClick={() => setDigimonList([...digimonList, { catalogId: catalog[0]?.id || 'agumon', level: 1 }])}>Add Digimon</button>
        
        <div className="admin-poi-actions">
          <button type="submit" disabled={updateMut.isPending}>Save</button>
          <button type="button" onClick={() => deleteMut.mutate(encounter.id)}>Delete</button>
        </div>
      </form>
    </div>
  );
}

function ItemEditor({ dungeonId, x, y, item }: { dungeonId: string, x: number, y: number, item?: DungeonItem | undefined }) {
  const queryClient = useQueryClient();
  const createMut = useMutation({
    mutationFn: (body: any) => createAdminItem(dungeonId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', dungeonId] })
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminItem(dungeonId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-dungeon', dungeonId] })
  });

  if (!item && !createMut.isPending) {
    return (
      <div>
        <h3>No Item at {x},{y}</h3>
        <button onClick={() => createMut.mutate({ x, y, itemId: 'hp_potion', qty: 1 })}>Add Item</button>
      </div>
    );
  }

  if (!item) return <div>Creating...</div>;

  return (
    <div className="admin-editor-panel">
      <h3>Item</h3>
      <p>ItemId: {item.itemId}</p>
      <p>Qty: {item.qty}</p>
      <button onClick={() => deleteMut.mutate(item.id)}>Delete</button>
    </div>
  );
}
