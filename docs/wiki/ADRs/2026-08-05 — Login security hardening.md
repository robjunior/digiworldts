---
tags:
  - digiworld/adr
  - digiworld/architecture
aliases:
  - Login Security Hardening
  - Password Blocklist
  - Register Throttle
  - Absolute Session Cap
  - ADR-005
created: 2026-08-05
updated: 2026-08-05
status: Accepted
grounded-in:
  - backend/src/auth/blocklist.ts
  - backend/src/auth/password.ts
  - backend/src/auth/session.ts
  - backend/src/auth/routes.ts
  - backend/src/auth/oauth/routes.ts
  - backend/src/admin/users.ts
  - backend/src/config.ts
  - backend/src/server.ts
  - backend/test/features-smoke.mts
verified-at-commit: HEAD
---

# 2026-08-05 — Login security hardening (P1 + P2)

> [!info] Status
> **Accepted** and shipped. Landed as one commit closing the two real attack
> surfaces on the auth stack (unlimited register + unlimited OAuth-decide
> password brute-force) and hardening five soft edges (weak-password blocklist,
> username-substring passwords, dummy-hash timing, absolute session cap,
> security headers). All 147 tests in `features-smoke.mts` pass (26 new).

## Context

An audit of the login/register/OAuth stack — see [[Session cookies]] and
[[OAuth]] — surfaced two real attack surfaces despite the existing
argon2id + login-throttle + CSRF-state defences:

1. **`POST /api/auth/register` had NO rate limit.** An attacker could:
   - Enumerate taken usernames by the 409/400/201 response shape.
   - Spam registrations to burn Argon2id CPU (~50 ms per request).
   - Register bot armies at API rate.
2. **`POST /api/auth/oauth/decide` link-branch had NO throttle.** A stolen
   or self-generated pending token gave an attacker an unrated password-
   guess endpoint against any username. This bypassed the login-throttle
   entirely.

Five softer edges also stood out:

3. **Password policy was minimal.** Length + single-repeated-char reject
   only. A user could pick `password123` — argon2 hashes it expensively
   but it's still trivially guessable via credential-stuffing.
4. **Passwords could contain the username.** `alice` could register with
   `alice2024`. Top user-specific weak pattern in every breach corpus.
5. **`/api/auth/oauth/decide` link-branch leaked timing.** Missing user →
   fast 401 (no argon2 call). Existing user + wrong password → slow 401
   (argon2 ran). Cheap username-enumeration oracle.
6. **Sessions renewed indefinitely.** Sliding TTL kept a used cookie
   alive forever — a stolen cookie lived until logout on that device.
7. **No security headers.** Auth responses could be cached by
   intermediaries; no `X-Content-Type-Options` / `Referrer-Policy` /
   `X-Frame-Options` / `Permissions-Policy` defaults.

## Decision

Ship a single hardening pass covering both real attack surfaces (Priority 1)
and the five softer edges (Priority 2), reusing the cluster-throttle
infrastructure already proven by [[Session cookies#Login throttling]] and
[[OAuth]].

### Priority 1 — real attack surfaces

- **Register throttle: 5 attempts / IP / 15 min.** New
  `checkRegisterThrottle` / `recordRegisterAttempt` in
  [`session.ts`](backend/src/auth/session.ts), keyed at
  `regfail:ip:{ip}`. Counted at the top of
  [`authPlugin.POST('/api/auth/register')`](backend/src/auth/routes.ts:186)
  BEFORE the argon2 hash, so a bot cannot burn CPU indefinitely. 429 with
  `Retry-After: 900` when tripped.
- **OAuth-decide throttle: share the login window.**
  [`POST /api/auth/oauth/decide`](backend/src/auth/oauth/routes.ts:214)
  link-branch now calls the SAME `checkLoginThrottle` / `recordLoginAttempt`
  used by `/api/auth/login`. Same 8/user + 20/IP per 15 min counters. An
  attacker cannot split brute-force between the two endpoints — every
  fail on either counts toward the same cluster keys.

### Priority 2 — hardening

- **Weak-password blocklist.** New
  [`backend/src/auth/blocklist.ts`](backend/src/auth/blocklist.ts) with a
  curated ~300-entry Set of top breach passwords (rockyou / NCSC 100k /
  cross-locale — PT-BR, ES included since the game targets a BR audience).
  Normalizer strips trailing 1-4 digit suffixes and short punctuation runs
  so `password1..9999` and `password!@#` all collapse to the one `password`
  entry. `isCommonPassword()` runs at register + admin reset + user reset.
- **Password cannot contain username.** `passwordContainsUsername(pw, un)`
  case-insensitive, only enforced for `username.length ≥ 3` so trivial
  usernames don't over-reject. Signature-optional context —
  `validatePasswordPolicy(pw, { username })` — so callers without a
  username (OAuth placeholder hashes) skip this check gracefully.
- **Dummy-hash timing defence on `/oauth/decide`.**
  [Same pattern as `/api/auth/login`](backend/src/auth/routes.ts:288) —
  ALWAYS run `verifyPassword` against a fixed argon2 placeholder hash
  when the username misses, so response time doesn't leak account
  existence.
- **Absolute session cap: 30 days.** New env
  `SESSION_ABSOLUTE_CAP_DAYS` (default 30) in
  [`config.ts`](backend/src/config.ts). [`resolveSession`](backend/src/auth/session.ts:82)
  now checks `now - stored.createdAt > ABSOLUTE_CAP_MS` and hard-expires
  the session if so. Sliding renewal is capped to `min(now + TTL,
  createdAt + ABSOLUTE_CAP)`, so the cookie can never outlive its
  absolute deadline even under continuous use.
- **Security headers via `onSend` hook** in
  [`server.ts`](backend/src/server.ts). No new dependency. Every response:
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(),
  payment=()`. `/api/auth/*` also gets `Cache-Control: no-store` +
  `Pragma: no-cache`.

### Non-decisions (deliberate)

- **No CAPTCHA.** UX trade-off; would need to be added per-deploy.
- **No email verification.** No SMTP wired; adding one deferred.
- **No zxcvbn.** ~1MB dep for a check the blocklist already covers 95%
  of. Length + blocklist beats zxcvbn's scoring for this threat model.
- **No hardcoded advisory-lock ID constant.** Cosmetic. Left for later.

## Consequences

### Positive

- **Two real attack surfaces closed.** Register spam + OAuth-decide
  brute-force both share the cluster-throttle now.
- **Cross-node consistent.** All throttle counters live in the cluster
  (KV with TTL), so a multi-node deploy shares them — attacker cannot
  hop between nodes.
- **Cheap CPU floor.** Register throttle fires BEFORE the argon2 hash;
  a hit stays cheap even under attack.
- **Blocklist coverage across locales.** BR-PT (`senha`, `flamengo`,
  `deusefiel`), ES (`contrasena`, `principe`), plus the usual breach top-N.
  Game / anime clusters included since the audience is a Digimon MMO.
- **Backward-compatible.** `validatePasswordPolicy` still accepts a bare
  `(password)` call — the context arg is optional, defaulting to `{}`.
  Every existing caller in the tree keeps working; only the register +
  admin-reset paths pass a username.
- **Absolute cap bounded correctly.** Sliding renewal now uses `min(now +
  TTL, createdAt + ABSOLUTE_CAP)` — a session created 29 days ago and
  used today gets 1 day of remaining life, not another 7. On the SET
  call we compute the actual remaining seconds so the cluster TTL
  matches the logical expiry.
- **Legit users unaffected.** Register 5-per-IP is 5x the realistic
  legit sign-up rate. 30-day absolute cap is 4x the sliding TTL. The
  blocklist rejects `password123` — not `Alice-loves-cats-2026`.
- **Headers are additive.** No conflict with existing headers; the hook
  runs on every response and sets defaults, respected on API and static
  paths alike.

### Negative

- **A user who fails 5 registrations from one IP is locked out for 15
  min.** Rare in practice (successful registration counts too — a busy
  family household with 5 accounts registers them, and any 6th signup
  from that IP within 15 min waits). Trade-off accepted.
- **Absolute session cap surfaces as forced re-login every 30 days.**
  Documented in [[Session cookies#Absolute session cap]]. Configurable
  via env if a specific deploy needs longer.
- **Blocklist adds one file to grep through.** Maintainable — the entries
  are a plain `readonly Set<string>`; extending it is a one-line PR.

### Neutral

- **Config env grew by one var** (`SESSION_ABSOLUTE_CAP_DAYS`). Fully
  optional, defaults to 30. Documented in [[Environments#Session]].
- **A separate `.env`-loading fix landed alongside** — `config.ts` now
  reads the repo-root `.env` as a fallback so the `pnpm dev` workflow
  loads it (previously only docker-compose passed root `.env` values
  through, and local dev silently ran on defaults). Pre-existing bug
  exposed by needing OAuth env vars to land.

## Verification

- All 147 tests in
  [`backend/test/features-smoke.mts`](backend/test/features-smoke.mts)
  pass (26 new for this ADR).
- End-to-end HTTP smoke: `curl /api/auth/oauth/providers` returns
  `["discord"]`; `curl /api/auth/oauth/discord/login` 302s to a real
  Discord authorize URL with the correct `client_id`, `redirect_uri`,
  `scope=identify`, and CSRF `state` token.
- Response headers verified on both `/api/auth/status` (auth) and
  `/api/health` (non-auth) — auth paths carry `Cache-Control: no-store`,
  everything else gets the four security defaults.

## Related

- [[Session cookies]] — updated to document register throttle + absolute
  cap + blocklist
- [[OAuth]] — updated to document decide-link throttle + timing defence
- [[Environments#Session]] — `SESSION_ABSOLUTE_CAP_DAYS` env
- [[2026-07-31 — OAuth hybrid decide]] — the ADR that landed the decide
  flow this hardens
- [[Reset a player password]] — reset flow now inherits the blocklist +
  username-substring rejection through `validatePasswordPolicy`
