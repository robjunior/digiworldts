import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { ArenaIcon, BackIcon, ShopIcon } from "./common/icons";
import { TopBar } from "./topbar/TopBar";
import "../styles/topbar.css";
import { SocialRail, type SocialPartySlot } from "./social/SocialRail";
import "../styles/social-rail.css";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../hooks/useLocale";
import { getRoster } from "../lib/api";

type NavEntry = {
  readonly to: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly svg: ReactNode;
};

type AdminNavEntry = NavEntry & {
  readonly tab?: string;
  readonly route?: string;
};

const PAGE_LABEL_KEYS: Readonly<Record<string, string>> = {
  "/": "lobby.title",
  "/account": "account.title",
  "/lobby": "lobby.title",
  "/combat": "combat.your_team",
  "/roster": "roster.title",
  "/factory": "nav.factory",
  "/farm": "farm.title",
  "/adventure": "adventure.title",
  "/nursery": "nursery.title",
  "/training": "nav.training",
  "/market": "nav.market",
  "/digdex": "nav.digidex",
  "/admin": "hud.admin",
  "/intro": "auth.enter_arena",
};

const PAGE_SCOPE: Readonly<Record<string, string>> = {
  "/lobby": "lobby-layout",
  "/combat": "",
  "/account": "account-page",
  "/roster": "roster-layout",
  "/factory": "factory-page",
  "/farm": "farm-page",
  "/adventure": "adv-page",
  "/nursery": "nursery-page",
  "/training": "training-page",
  "/market": "market-page",
  "/shop": "shop-page",
  "/items": "inventory-page",
  "/digdex": "digdex-container",
  "/admin": "admin-layout",
};

function pageLabelKeyFor(pathname: string): string | null {
  if (PAGE_LABEL_KEYS[pathname]) return PAGE_LABEL_KEYS[pathname];
  return null;
}

function pageScopeFor(pathname: string): string {
  const exact = PAGE_SCOPE[pathname];
  if (exact !== undefined) return exact;
  if (pathname.startsWith("/admin/particles")) return "admin-layout";
  return "";
}

const ICON_ARENA: ReactNode = <ArenaIcon />;
const ICON_BACK: ReactNode = <BackIcon />;
const ICON_SHOP: ReactNode = <ShopIcon />;

const TOWN: readonly NavEntry[] = [
  { to: "/factory", label: "Factory", labelKey: "nav.factory", svg: ICON_SHOP },
  { to: "/farm", label: "Farm", labelKey: "nav.farm", svg: ICON_SHOP },
  {
    to: "/adventure",
    label: "Adventure",
    labelKey: "nav.adventure",
    svg: ICON_BACK,
  },
  { to: "/nursery", label: "Nursery", labelKey: "nav.nursery", svg: ICON_BACK },
  {
    to: "/training",
    label: "Training",
    labelKey: "nav.training",
    svg: ICON_BACK,
  },
  { to: "/shop", label: "Shop", labelKey: "nav.shop", svg: ICON_SHOP },
];

const BEYOND: readonly NavEntry[] = [
  {
    to: "/market",
    label: "The Market",
    labelKey: "nav.market",
    svg: ICON_SHOP,
  },
  {
    to: "/items",
    label: "Inventory",
    labelKey: "nav.inventory",
    svg: ICON_SHOP,
  },
  { to: "/digdex", label: "DigiDex", labelKey: "nav.digidex", svg: ICON_ARENA },
  { to: "/roster", label: "Roster", labelKey: "nav.roster", svg: ICON_ARENA },
  { to: "/lobby", label: "The Arena", labelKey: "nav.arena", svg: ICON_ARENA },
];

const ADMIN_NAV_OVERVIEW: AdminNavEntry = {
  to: "/admin?tab=overview",
  label: "Overview",
  svg: ICON_ARENA,
  tab: "overview",
};

type AdminNavGroup = {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly AdminNavEntry[];
};

const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "community",
    label: "Community",
    entries: [
      { to: "/admin?tab=users", label: "Users", svg: ICON_ARENA, tab: "users" },
      {
        to: "/admin?tab=seasons",
        label: "Seasons",
        svg: ICON_ARENA,
        tab: "seasons",
      },
    ],
  },
  {
    id: "content",
    label: "Content",
    entries: [
      {
        to: "/admin?tab=catalog",
        label: "Catalog",
        svg: ICON_ARENA,
        tab: "catalog",
      },
      {
        to: "/admin?tab=skills",
        label: "Skills",
        svg: ICON_BACK,
        tab: "skills",
      },
      {
        to: "/admin?tab=shop",
        label: "Shop Admin",
        svg: ICON_SHOP,
        tab: "shop",
      },
      {
        to: "/admin?tab=quests",
        label: "Quests",
        svg: ICON_BACK,
        tab: "quests",
      },
      {
        to: "/admin?tab=scraped",
        label: "Scraped",
        svg: ICON_ARENA,
        tab: "scraped",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    entries: [
      {
        to: "/admin?tab=settings",
        label: "Settings",
        svg: ICON_BACK,
        tab: "settings",
      },
    ],
  },
];

const ADMIN_BACK_ENTRY: AdminNavEntry = {
  to: "/lobby",
  label: "Back to game",
  svg: ICON_BACK,
  route: "/lobby",
};

const BEYOND_STYLE: CSSProperties = { marginTop: 6 };

function isActive(pathname: string, target: string): boolean {
  return pathname === target || pathname.startsWith(`${target}/`);
}

function isAdminEntryActive(
  entry: AdminNavEntry,
  pathname: string,
  activeTab: string,
): boolean {
  if (entry.route !== undefined && pathname === entry.route) return true;
  if (pathname === "/admin" && entry.tab === activeTab) return true;
  return false;
}

export function AppShell(): JSX.Element {
  const { user } = useAuth();
  const t = useT();
  const { pathname, search } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, search]);
  const pageLabelKey = pageLabelKeyFor(pathname);
  const pageLabel = pageLabelKey
    ? t(pageLabelKey)
    : (pathname.split("/").filter(Boolean)[0] ?? t("lobby.title"));
  const pageScope = pageScopeFor(pathname);
  const authed = !!user;
  const isAdminMode = pathname.startsWith("/admin");
  const activeAdminTab = new URLSearchParams(search).get("tab") ?? "overview";

  const rosterQuery = useQuery({
    queryKey: ["roster"] as const,
    queryFn: getRoster,
    enabled: authed,
    staleTime: 15_000,
  });

  const roster = rosterQuery.data?.roster ?? [];
  const party = roster.filter((mon) => mon.status === "party");
  const partyMax = 3;
  const tamerLv = user?.mmr ?? null;
  const navigate = useNavigate();
  const isLobby = pathname === "/lobby";
  const lobbyParty = useMemo<readonly (SocialPartySlot | null)[]>(
    () =>
      [0, 1, 2].map((slot) => {
        const m = roster.find((r) => r.slot === slot);
        return m
          ? {
              id: m.id,
              catalogId: m.catalogId,
              nickname: m.nickname,
              level: m.level,
              element: m.template?.element ?? m.template?.attribute ?? "water",
              stage: m.template?.stage ?? "",
            }
          : null;
      }),
    [roster],
  );

  const renderNav = (entry: NavEntry): JSX.Element => {
    const active = isActive(pathname, entry.to);
    const label = entry.labelKey ? t(entry.labelKey) : entry.label;
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={label}
        {...(active ? { "aria-current": "page" as const } : {})}
      >
        {entry.svg}
        <span>{label}</span>
      </Link>
    );
  };

  const renderAdminNav = (entry: AdminNavEntry): JSX.Element => {
    const active = isAdminEntryActive(entry, pathname, activeAdminTab);
    const label = entry.labelKey ? t(entry.labelKey) : entry.label;
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={label}
        {...(active ? { "aria-current": "page" as const } : {})}
      >
        {entry.svg}
        <span>{label}</span>
      </Link>
    );
  };

  const mainClassName = pageScope ? `main ${pageScope}` : "main";

  return (
    <div className={`win win--fill${sidebarOpen ? " has-sidebar-open" : ""}`}>
      <TopBar />
      <div className="body">
        <main className={mainClassName}>
          <Outlet />
        </main>
        <SocialRail
          party={isLobby ? lobbyParty : null}
          onOpenCreature={(id) => navigate(`/creature/${id}`)}
        />
      </div>
    </div>
  );
}
