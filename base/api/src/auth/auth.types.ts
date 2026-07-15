/**
 * Public shapes of the `/auth/*` responses (TASK-5, R-2).
 *
 * These are the SECOND public API contract in the project (after `HealthStatus`),
 * so — like `health.types.ts` — they are written as explicit exported types other
 * code depends on. TASK-6's SPA keeps a LOCAL mirror of these to type its auth
 * client, exactly as the web `/health` consumer mirrors `HealthStatus`; keep them
 * in lock-step. Per invariant 5 (additive/versioned, never a silent break) fields
 * may be ADDED in later slices but existing ones must not change meaning or vanish.
 *
 * CRITICAL (task constraint / invariant 3 groundwork): none of these expose
 * `passwordHash`. The stored bcrypt hash is server-internal and never crosses the
 * API boundary — the register/login/me handlers project only these fields.
 */

/**
 * `POST /auth/register` success body (HTTP 201).
 *
 * Returns just the durable identity of the newly-created account — deliberately
 * NOT a token: registration proves the account exists; obtaining a session is a
 * separate `login` step (this keeps the two concerns, and their failure modes,
 * independent, and mirrors how most clients drive the flow: register then log in).
 */
export interface RegisterResponse {
  id: string;
  email: string;
}

/**
 * `POST /auth/login` success body (HTTP 200).
 *
 * Only a short-lived access token this slice — the "stay logged in across reloads"
 * refresh-token half is carved off to R-2b (A-6), so there is intentionally no
 * `refreshToken` field here yet. The token is an opaque string to clients: they
 * present it verbatim as `Authorization: Bearer <accessToken>`; its JWT structure
 * and claims are a server implementation detail (a future rotation to a different
 * token format must stay additive under invariant 5).
 */
export interface LoginResponse {
  accessToken: string;
}

/**
 * `GET /auth/me` success body (HTTP 200) — the authenticated caller's identity.
 *
 * This is the server-side "protected view you cannot reach signed out": reachable
 * only with a valid Bearer token (401 otherwise). It returns the same identity
 * projection as register, so the SPA can render "logged in as <email>" without a
 * second lookup.
 *
 * TASK-35 (R-14) adds `role` ADDITIVELY (invariant 5): the caller's authorization
 * tier ("user" | "admin"), sourced from the token's `role` claim that JwtAuthGuard
 * already pins onto `request.user.role` (TASK-34). It reaches the wire so the SPA
 * can decide whether to SHOW the admin control (`useAuth().user?.role === 'admin'`)
 * — a UX hint only; the server's AdminGuard (403) is the real gate. No released
 * field changed; a pre-TASK-34 access token whose claim defaulted to 'user' still
 * projects `role: 'user'` here.
 */
export interface MeResponse {
  id: string;
  email: string;
  role: string;
}

/**
 * `POST /auth/refresh` success body (HTTP 200) — the rotated access token (TASK-11,
 * R-2b).
 *
 * Intentionally the SAME shape as {@link LoginResponse}: a caller (the SPA) reads
 * exactly the fresh short-lived access token and nothing else. The NEW refresh
 * token is delivered ONLY as a rotated httpOnly cookie in the response's
 * `Set-Cookie` header — it is never part of any JSON body (the SPA's JS must never
 * be able to read it). Added additively (invariant 5); it does not change
 * `LoginResponse`/`RegisterResponse`/`MeResponse`.
 */
export interface RefreshResponse {
  accessToken: string;
}

/**
 * The verified payload of a REFRESH JWT (TASK-11, R-2b).
 *
 * Deliberately minimal — the subject (the user id) plus a random `jti` nonce. The
 * refresh token's job is to identify whose session to rotate; the email/claims that
 * ride the ACCESS token ({@link AccessTokenPayload}) are NOT carried here, so the
 * refresh token stays a pure, low-surface capability. `jti` (the standard JWT ID
 * claim) is a per-token random UUID: without it, two refresh tokens minted for the
 * SAME user within the same second would be byte-identical (a JWT is fully
 * determined by its payload + `iat`/`exp` whole-second timestamps + secret), so
 * their sha-256 `tokenHash` would collide on the `@unique` column (a real 500 seen
 * under the gate: a login-twice, or login-then-immediate-refresh). The `jti`
 * guarantees every issued token — hence every stored hash — is distinct. Kept
 * internal (not part of any HTTP body): it is the shape `RefreshTokenService` signs
 * into, and reads back out of, the raw refresh JWT stored in the cookie. Signed and
 * verified with the REFRESH secret (a per-call override on the shared `JwtService`),
 * distinct from the access secret.
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

/**
 * The verified JWT payload the auth guard attaches to the request and the
 * controller reads back for `GET /auth/me`.
 *
 * `sub` (subject) is the standard JWT registered claim for the principal's id;
 * `email` is carried too so `/auth/me` needs no DB round-trip to answer (the
 * token is authoritative for the duration of its short TTL). Kept internal (not
 * part of any HTTP body contract) — it is the shape passed from guard to handler
 * via the request object, so it lives here beside the response types it feeds.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  // The authorization tier (TASK-34, R-14) — "user" | "admin". Carried in the JWT
  // so a guard (JwtAuthGuard populates `request.user.role`; AdminGuard gates on it)
  // authorizes with NO DB round-trip. Added ADDITIVELY (invariant 5): access tokens
  // minted BEFORE this claim existed simply omit it, so the guard defaults a missing
  // claim to 'user' (`payload.role ?? 'user'`) — no released session breaks and no
  // pre-existing token silently gains privilege.
  role: string;
}

/**
 * The authenticated principal the guard pins onto the Express request (as
 * `request.user`) after verifying the token, and the controller projects into a
 * {@link MeResponse}. Deliberately minimal — only what the token vouches for.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  // The caller's authorization tier (TASK-34, R-14) — read from the token's `role`
  // claim by JwtAuthGuard (defaulting a missing claim to 'user'). AdminGuard reads
  // this to require `role === 'admin'`. Deliberately still minimal — only what the
  // token vouches for.
  role: string;
}
