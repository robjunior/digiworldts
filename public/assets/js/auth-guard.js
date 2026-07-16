/* ============================================================
   DigiWorld — auth guard.
   Import from any protected page. Resolves the current user via
   /api/auth/me and either:
     - returns { user } on success, or
     - redirects to /  (the login page) on 401 / missing session.
   Sets a `data-user-id` attribute on <html> so pages can bootstrap
   without a second fetch.
   ============================================================ */
import { api } from './api.js';

export async function requireLogin() {
  try {
    const res = await api.get('/api/auth/me');
    document.documentElement.dataset.userId = res.user.id;
    document.documentElement.dataset.displayName = res.user.displayName;
    document.documentElement.dataset.isAdmin = String(res.user.isAdmin);
    document.documentElement.dataset.onboardingCompleted = String(res.user.onboardingCompleted);

    const path = location.pathname;
    const onOnboarding = path === '/onboarding.html';
    if (!res.user.onboardingCompleted && !onOnboarding) {
      location.replace('/onboarding.html');
      throw { status: 0, code: 'needs-onboarding', message: 'onboarding required' };
    }
    if (res.user.onboardingCompleted && onOnboarding) {
      location.replace('/roster.html');
      throw { status: 0, code: 'already-onboarded', message: 'onboarding already completed' };
    }

    return res.user;
  } catch (err) {
    if (err && err.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace('/?next=' + next);
    }
    throw err;
  }
}

/** Same as requireLogin but also enforces admin. Redirects to /lobby.html on 403. */
export async function requireAdmin() {
  const user = await requireLogin();
  if (!user.isAdmin) {
    location.replace('/lobby.html');
    throw { status: 403, code: 'not-admin', message: 'admin only' };
  }
  return user;
}

/** Render the small nav header shared by every logged-in page. */
export function renderNav(container, current) {
  const isAdmin = document.documentElement.dataset.isAdmin === 'true';
  const displayName = document.documentElement.dataset.displayName || '';
  const links = [
    { href: '/lobby.html',    key: 'lobby',    label: 'Lobby' },
    { href: '/world.html',    key: 'world',    label: 'World' },
    { href: '/nursery.html',  key: 'nursery',  label: 'Nursery' },
    { href: '/roster.html',   key: 'roster',   label: 'Roster' },
    { href: '/market.html',   key: 'market',   label: 'Market' },
    { href: '/combat.html',   key: 'combat',   label: 'Battle' },
    { href: '/farm.html',     key: 'farm',     label: 'Farm' },
    { href: '/training.html', key: 'training', label: 'Training' },
    { href: '/shop.html',     key: 'shop',     label: 'Shop' },
  ];
  if (isAdmin) links.push({ href: '/admin.html', key: 'admin', label: 'Admin' });
  container.innerHTML =
    `<div class="brand">Digi<b>World</b></div>` +
    links.map((l) => `<a class="nav-link${current === l.key ? ' is-active' : ''}" href="${l.href}">${l.label}</a>`).join('') +
    `<div class="nav-right">` +
      `<span class="who">Signed in as <b>${escapeHtml(displayName)}</b></span>` +
      `<button class="btn btn--secondary btn--sm" data-logout>Sign out</button>` +
    `</div>`;
  container.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    location.replace('/');
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
