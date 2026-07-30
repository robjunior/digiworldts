import { useSearchParams } from 'react-router';


import { AdminGuard } from '../components/admin/AdminGuard';
import { CatalogTable } from '../components/admin/CatalogTable';
import { DungeonsAdmin } from '../components/admin/DungeonsAdmin';
import { GameSettingsAdmin } from '../components/admin/GameSettingsAdmin';
import { OverviewTab } from '../components/admin/OverviewTab';
import { QuestsAdmin } from '../components/admin/QuestsAdmin';
import { SceneSettingsAdmin } from '../components/admin/SceneSettingsAdmin';
import { ScrapedTable } from '../components/admin/ScrapedTable';
import { SeasonsAdmin } from '../components/admin/SeasonsAdmin';
import { ShopAdmin } from '../components/admin/ShopAdmin';
import { SkillsAdmin } from '../components/admin/SkillsAdmin';
import { UserTable } from '../components/admin/UserTable';
import { PageStrip } from '../components/common/PageStrip';
import { useAuth } from '../hooks/useAuth';
import '../styles/extensions-admin.css';
import '../styles/extensions-combat3d.css';

const ADMIN_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'scraped', label: 'Scraped' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'skills', label: 'Skills' },
  { id: 'shop', label: 'Shop Admin' },
  { id: 'quests', label: 'Quests' },
  { id: 'dungeons', label: 'Dungeons' },
  { id: 'scene', label: 'Scene' },
  { id: 'settings', label: 'Settings' },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]['id'];

export function Admin(): JSX.Element {
  const { user, logout } = useAuth();
  void user;
  void logout;
  const [searchParams] = useSearchParams();
  const activeTab = toAdminTab(searchParams.get('tab'));

  if (activeTab === 'scene') {
    return (
      <AdminGuard>
        <SceneSettingsAdmin />
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <>
        <PageStrip
          name="Admin"
          tone="action"
          metrics={[
            { label: <>catalog, users, scraped data &amp; shop ops</>, className: 'muted' },
            { label: <><b>{activeTab}</b> tab</> },
          ]}
        />
        <section className="admin-content" aria-live="polite">
          <AdminTabPanel tab={activeTab} />
        </section>
      </>
    </AdminGuard>
  );
}

function toAdminTab(value: string | null): AdminTab {
  const found = ADMIN_TABS.find((tab) => tab.id === value);
  return found?.id ?? 'overview';
}

function AdminTabPanel({ tab }: { readonly tab: AdminTab }): JSX.Element {
  switch (tab) {
    case 'overview':
      return <OverviewTab />;
    case 'users':
      return <UserTable />;
    case 'seasons':
      return <SeasonsAdmin />;
    case 'scraped':
      return <ScrapedTable />;
    case 'catalog':
      return <CatalogTable />;
    case 'skills':
      return <SkillsAdmin />;
    case 'shop':
      return <ShopAdmin />;
    case 'quests':
      return <QuestsAdmin />;
    case 'dungeons':
      return <DungeonsAdmin />;
    case 'scene':
      return <SceneSettingsAdmin />;
    case 'settings':
      return <GameSettingsAdmin />;
    default:
      return assertNever(tab);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled admin tab: ${value}`);
}
