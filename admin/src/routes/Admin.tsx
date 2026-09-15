import { Link, useSearchParams } from 'react-router';


import { AdminGuard } from '../components/admin/AdminGuard';
import { CatalogTable } from '../components/admin/CatalogTable';
import { DialoguesAdmin } from '../components/admin/DialoguesAdmin';
import { GameSettingsAdmin } from '../components/admin/GameSettingsAdmin';
import { NpcsAdmin } from '../components/admin/NpcsAdmin';
import { OnboardingAdmin } from '../components/admin/OnboardingAdmin';
import { OverviewTab } from '../components/admin/OverviewTab';
import { QuestsAdmin } from '../components/admin/QuestsAdmin';
import { SceneSettingsAdmin } from '../components/admin/SceneSettingsAdmin';
import { ScrapedTable } from '../components/admin/ScrapedTable';
import { SeasonsAdmin } from '../components/admin/SeasonsAdmin';
import { ShopAdmin } from '../components/admin/ShopAdmin';
import { SkillsAdmin } from '../components/admin/SkillsAdmin';
import { TilesetsAdmin } from '../components/admin/tilesets/TilesetsAdmin';
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
  { id: 'npcs', label: 'NPCs' },
  { id: 'dialogues', label: 'Dialogues' },
  { id: 'shop', label: 'Shop Admin' },
  { id: 'quests', label: 'Quests' },
  { id: 'tilesets', label: 'Tilesets' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'scene', label: 'Scene' },
  { id: 'settings', label: 'Settings' },
] as const;

// Standalone admin routes registered in App.tsx that live outside the tab shell
// (each is a full-viewport editor with its own layout).
const ADMIN_EXTERNAL_LINKS = [
  { to: '/world', label: 'World Editor' },
  { to: '/particles', label: 'Particles' },
  { to: '/skill-vfx', label: 'Skill VFX' },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]['id'];

export function Admin(): JSX.Element {
  const { user, logout } = useAuth();
  void user;
  void logout;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = toAdminTab(searchParams.get('tab'));

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
        <div className="admin-body">
          <nav className="admin-sidebar-left" aria-label="Admin sections">
            {ADMIN_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-nav-item${tab.id === activeTab ? ' is-active' : ''}`}
                aria-current={tab.id === activeTab ? 'page' : undefined}
                onClick={() => setSearchParams({ tab: tab.id })}
              >
                {tab.label}
              </button>
            ))}
            <hr className="admin-nav-divider" role="separator" />
            {ADMIN_EXTERNAL_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="admin-nav-item">
                {link.label}
              </Link>
            ))}
          </nav>
          <section className="admin-content" aria-live="polite">
            <AdminTabPanel tab={activeTab} />
          </section>
        </div>
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
    case 'npcs':
      return <NpcsAdmin />;
    case 'dialogues':
      return <DialoguesAdmin />;
    case 'shop':
      return <ShopAdmin />;
    case 'quests':
      return <QuestsAdmin />;
    case 'tilesets':
      return <TilesetsAdmin />;
    case 'onboarding':
      return <OnboardingAdmin />;
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
