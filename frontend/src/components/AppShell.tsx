import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';

export function AppShell() {
  const { user } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const svgs = {
    factory: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 20V10l5 3V10l5 3V6l6 4v10z"/><path d="M7 20v-4M12 20v-4M17 20v-4"/></svg>,
    adventure: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>,
    nursery: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 21c-4-2.5-7-5.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 12c0 3.5-3 6.5-7 9z"/></svg>,
    training: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6.5 6.5l11 11"/><path d="M4 9l-1.5-1.5 2-2L6 7M15 18l1.5 1.5 2-2L17 15"/><path d="M9 4l2 2M18 13l2 2M4 15l2 2M13 6l2 2"/></svg>,
    market: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 7h16l-1.2 4.5H5.2L4 7z"/><path d="M5.2 11.5V19h13.6v-7.5"/><path d="M4 7l1-3h14l1 3"/></svg>,
    digidex: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/></svg>,
    arena: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3l-2 5h4l-4 8 2-5h-4l4-8z"/><circle cx="12" cy="12" r="9"/></svg>
  };

  const navTown = [
    { to: '/factory', label: 'Factory', svg: svgs.factory },
    { to: '/adventure', label: 'Adventure', svg: svgs.adventure },
    { to: '/nursery', label: 'Nursery', svg: svgs.nursery },
    { to: '/training', label: 'Training', svg: svgs.training },
    { to: '/market', label: 'Market', svg: svgs.market },
  ];

  const navBeyond = [
    { to: '/digdex', label: 'DigiDex', svg: svgs.digidex },
    { to: '/lobby', label: 'Lobby', svg: svgs.arena },
    { to: '/combat', label: 'Combat', svg: svgs.arena },
  ];

  return (
    <div className="win">
      <header className="titlebar">
        <div className="lights"><i /><i /><i /></div>
        <div className="app-mark">DIGI<span className="bit">WORLD</span></div>
        <div className="win-meta">{user?.displayName ?? '—'} · Session Active</div>
      </header>
      <div className="body">
        <aside className="side">
          <div className="grp">The Town</div>
          {navTown.map(nav => (
            <Link
              key={nav.to}
              to={nav.to}
              className="navbtn"
              aria-current={isActive(nav.to) ? "page" : undefined}
            >
              {nav.svg}<span>{nav.label}</span>
            </Link>
          ))}
          
          <div className="grp" style={{ marginTop: '6px' }}>Beyond</div>
          {navBeyond.map(nav => (
            <Link
              key={nav.to}
              to={nav.to}
              className="navbtn"
              aria-current={isActive(nav.to) ? "page" : undefined}
            >
              {nav.svg}<span>{nav.label}</span>
            </Link>
          ))}

          <div className="spring">
            <div className="hud">
              <div className="pill"><span>User</span><b>{user?.displayName ?? '—'}</b></div>
              <div className="pill"><span>Credits</span><b>—</b></div>
              <div className="pill"><span>Level</span><b>—</b></div>
            </div>
            {user?.isAdmin ? <Link to="/admin" className="admin-link">Admin</Link> : null}
          </div>
        </aside>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
