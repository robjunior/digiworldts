import { useQuery } from '@tanstack/react-query';

import { getAdminStats } from '../../lib/api-admin';
import { AdminSection, ErrorText, StatTile } from './AdminShared';

const ADMIN_STATS_QUERY_KEY = ['admin', 'stats'] as const;

export function OverviewTab(): JSX.Element {
  const statsQuery = useQuery({ queryKey: ADMIN_STATS_QUERY_KEY, queryFn: getAdminStats, refetchInterval: 15_000 });
  const stats = statsQuery.data;

  return (
    <AdminSection title="Overview" lede="Live operator snapshot for users, catalog content, and active world state.">
      <ErrorText error={statsQuery.error} />
      <div className="admin-stat-grid" id="overview-tiles">
        <StatTile label="Users" value={stats?.users ?? '—'} />
        <StatTile label="Active matches" value={stats?.activeMatches ?? '—'} />
        <StatTile label="Catalog templates" value={stats?.catalogTemplates ?? '—'} />
        <StatTile label="Blueprints" value={stats?.buildingBlueprints ?? '—'} />
        <StatTile label="Player buildings" value={stats?.totalPlayerBuildings ?? '—'} />
        <StatTile label="Player mons" value={stats?.totalPlayerMons ?? '—'} />
      </div>
      <p className="stat-refresh-time">Refreshes every 15 seconds while this tab is mounted.</p>
    </AdminSection>
  );
}
