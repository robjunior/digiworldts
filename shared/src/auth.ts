/**
 * DigiWorld — Auth wire types (source of truth for backend + frontend).
 *
 * Every /api/auth/* response the browser observes is one of the shapes below.
 * Both backend/src/auth/routes.ts and frontend/src/lib/api.ts import from here.
 */

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: number;
  /** ms epoch, or null on the very first request before login. */
  lastLoginAt: number | null;
  /** True once the user completes the onboarding flow. */
  onboardingCompleted: boolean;
  mmr: number;
  /** ms epoch when premium expires, or null if never activated / expired. */
  premiumUntil: number | null;
  /** 'en' | 'pt', or null when user has never explicitly picked (browser detection applies). */
  localePref: 'en' | 'pt' | null;
  /** Given name, null on accounts created before the signup form collected it. */
  firstName: string | null;
  /** Family name, null on accounts created before the signup form collected it. */
  lastName: string | null;
  /** Contact email (lower-cased), null on accounts created before the signup form collected it. */
  email: string | null;
};

/** GET /api/auth/status — no auth required. */
export type AuthStatusResponse = {
  userCount: number;
  registrationOpen: boolean;
};

/** GET /api/auth/me — requires cookie; 401 { error } when missing. */
export type AuthMeResponse = {
  user: PublicUser;
  registrationOpen: boolean;
  flags?: readonly string[];
};

/** POST /api/auth/{login,register} — sets cookie on 200/201. */
export type AuthSessionResponse = {
  user: PublicUser;
};

/** POST /api/auth/logout — always 200. */
export type AuthLogoutResponse = {
  ok: true;
};

export type AuthErrorResponse = {
  error: string;
  details?: unknown;
};

export type RegisterBody = {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  displayName?: string;
};

export type LoginBody = {
  username: string;
  password: string;
};
