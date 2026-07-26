import { useState } from 'react';


import { AdminGuard } from '../components/admin/AdminGuard';
import { BiomeSceneEditor } from '../components/admin/BiomeSceneEditor';
import { CatalogTable } from '../components/admin/CatalogTable';
import { GameSettingsAdmin } from '../components/admin/GameSettingsAdmin';
import { OverviewTab } from '../components/admin/OverviewTab';
import { SceneSettingsAdmin } from '../components/admin/SceneSettingsAdmin';
import { ScrapedTable } from '../components/admin/ScrapedTable';
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
  { id: 'scraped', label: 'Scraped' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'skills', label: 'Skills' },
  { id: 'shop', label: 'Shop Admin' },
  { id: 'biomes', label: 'Biome scenes' },
  { id: 'scene', label: 'Scene (per-arena)' },
  { id: 'settings', label: 'Settings' },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]['id'];

export function Admin(): JSX.Element {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  if (activeTab === 'scene') {
    return (
      <AdminGuard>
        <div className="app-shell combat3d-shell">
          <main className="app-main combat3d-main">
            <SceneSettingsAdmin />
          </main>
        </div>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <div className="app-shell admin-shell">
        <main className="app-main admin-main">
          <PageStrip
            name="Admin"
            tone="action"
            metrics={[
              { label: <>catalog, users, scraped data &amp; shop ops</>, className: 'muted' },
              { label: <><b>{activeTab}</b> tab</> },
            ]}
          />
          <div className="admin-layout">
            <aside className="admin-sidebar-left" aria-label="Admin sections">
              {ADMIN_TABS.map((tab) => (
                <button key={tab.id} className={`admin-nav-item${activeTab === tab.id ? ' is-active' : ''}`} type="button" onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
              ))}
            </aside>
            <section className="admin-content" aria-live="polite">
              <AdminTabPanel tab={activeTab} />
            </section>
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}

function AdminTabPanel({ tab }: { readonly tab: AdminTab }): JSX.Element {
  switch (tab) {
    case 'overview':
      return <OverviewTab />;
    case 'users':
      return <UserTable />;
    case 'scraped':
      return <ScrapedTable />;
    case 'catalog':
      return <CatalogTable />;
    case 'skills':
      return <SkillsAdmin />;
    case 'shop':
      return <ShopAdmin />;
    case 'biomes':
      return <BiomeSceneEditor />;
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
