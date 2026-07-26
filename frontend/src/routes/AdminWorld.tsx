import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { getWorldRegions } from '../lib/api-world';
import { listAdminDungeons, updateAdminDungeon } from '../lib/api-dungeon-admin';
import { AdminGuard } from '../components/admin/AdminGuard';
import type { WorldRegion, Dungeon } from '@digiworld/shared';
import '../styles/extensions-admin.css';

export function AdminWorld(): JSX.Element {
  const queryClient = useQueryClient();

  const regionsQuery = useQuery({ queryKey: ['admin-world-regions'], queryFn: getWorldRegions });
  const dungeonsQuery = useQuery({ queryKey: ['admin-dungeons'], queryFn: listAdminDungeons });

  const regions = useMemo(() => {
    if (!regionsQuery.data) return [];
    return [...regionsQuery.data].sort((a, b) => b.danger - a.danger);
  }, [regionsQuery.data]);

  const dungeons = dungeonsQuery.data?.dungeons ?? [];

  const updateDungeonMut = useMutation({
    mutationFn: async ({ dungeonId, biomeRegion }: { dungeonId: string, biomeRegion: string | null }) => {
      return updateAdminDungeon(dungeonId, { biomeRegion });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-world-regions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dungeons'] });
      setToast({ message: 'Region linked successfully!', type: 'success' });
    },
    onError: (err: any) => {
      if (err.status === 409) {
        setToast({ message: 'Conflict: Dungeon already linked to another region!', type: 'error' });
      } else {
        setToast({ message: 'Failed to link region', type: 'error' });
      }
    }
  });

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [selectedDungeons, setSelectedDungeons] = useState<Record<string, string>>({});

  const handleSelectChange = (biome: string, val: string) => {
    setSelectedDungeons(prev => ({ ...prev, [biome]: val }));
    setToast(null);
  };

  const handleSave = async (region: WorldRegion) => {
    const newDungeonId = selectedDungeons[region.biome] ?? '';
    const oldDungeonId = region.dungeonId;

    if (newDungeonId === oldDungeonId) return;

    try {
      if (oldDungeonId) {
        await updateDungeonMut.mutateAsync({ dungeonId: oldDungeonId, biomeRegion: null });
      }
      if (newDungeonId) {
        await updateDungeonMut.mutateAsync({ dungeonId: newDungeonId, biomeRegion: region.biome });
      } else {
        queryClient.invalidateQueries({ queryKey: ['admin-world-regions'] });
        queryClient.invalidateQueries({ queryKey: ['admin-dungeons'] });
        setToast({ message: 'Region unlinked successfully!', type: 'success' });
      }
      
      setSelectedDungeons(prev => {
        const next = { ...prev };
        delete next[region.biome];
        return next;
      });
    } catch (e) {
    }
  };

  return (
    <AdminGuard>
      <main className="main admin-world-layout">
        <div className="admin-world-header">
          <div className="admin-world-header-text">
            <h2>World Regions</h2>
            <p>Link each region to a dungeon. One dungeon per region.</p>
          </div>
          <Link to="/admin" className="admin-world-nav">Back to Admin</Link>
        </div>

        {toast && (
          <div className={`admin-message is-${toast.type}`}>
            {toast.message}
          </div>
        )}

        <div className="admin-region-table-wrapper">
          <table className="admin-region-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Region</th>
                <th>Linked Dungeon</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {regions.map(region => {
                const currentDungeonId = region.dungeonId ?? '';
                const localDungeonId = selectedDungeons[region.biome];
                const displayedDungeonId = localDungeonId !== undefined ? localDungeonId : currentDungeonId;
                const isChanged = localDungeonId !== undefined && localDungeonId !== currentDungeonId;

                return (
                  <tr key={region.biome} className="admin-region-row">
                    <td>
                      <div className="region-tier-badge" data-danger={region.danger}>
                        D{region.danger}
                      </div>
                    </td>
                    <td>
                      <div className="region-label-cell">
                        <strong>{region.label}</strong>
                        <span>{region.element} · {region.biome}</span>
                      </div>
                    </td>
                    <td>
                      <select 
                        className="region-select"
                        value={displayedDungeonId}
                        onChange={(e) => handleSelectChange(region.biome, e.target.value)}
                      >
                        <option value="">— None —</option>
                        {dungeons.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className={`region-scout-status ${region.scouted ? 'is-scouted' : 'is-unscouted'}`}>
                        {region.scouted ? 'Scouted' : 'Unscouted'}
                      </div>
                    </td>
                    <td>
                      <div className="region-actions-cell">
                        <button 
                          className="region-save-btn" 
                          disabled={!isChanged || updateDungeonMut.isPending}
                          onClick={() => handleSave(region)}
                        >
                          {updateDungeonMut.isPending ? 'Saving...' : 'Save'}
                        </button>
                        {currentDungeonId && (
                          <Link to={`/admin/dungeons/${currentDungeonId}`} className="region-edit-link">
                            Edit Dungeon
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </AdminGuard>
  );
}
