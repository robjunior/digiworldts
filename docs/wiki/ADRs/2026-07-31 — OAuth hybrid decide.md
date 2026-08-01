---
tags:
  - digiworld/adr
aliases:
  - OAuth Hybrid Decide
  - OAuth Decide Flow
  - ADR-002
created: 2026-07-31
updated: 2026-08-01
status: Accepted
grounded-in:
  - backend/src/auth/oauth/routes.ts
  - backend/src/auth/oauth/types.ts
  - backend/src/auth/oauth/state.ts
verified-at-commit: 4e70621
---

# 2026-07-31 — OAuth hybrid "decide" flow

> [!info] Status
> **Accepted** and shipped. Landed with `7cc60a0 feat(auth): OAuth2 Discord
> login + hybrid decide + responsive auth-shell mobile` and extended by
> `eebfef9 feat(auth): add Google and Facebook OAuth providers`.

## Context

The OAuth callback returns a `providerUserId` we've never seen before.
Three plausible outcomes:

1. **First-time sign-up.** User authorized with Discord/Google/Facebook
   because they want a fresh DigiWorld account.
2. **Linking an existing account.** User already has a password-based
   DigiWorld account and wants to add the OAuth identity so they can log
   in with either from now on.
3. **Same person, different provider.** User signed up years ago with
   Discord; today they're clicking "Continue with Google" on a fresh
   browser and don't remember which OAuth path they picked originally.

The straightforward paths each fail one of these:

- **Auto-create-on-unknown** — case 1 works, case 2 mints a duplicate
  account (now the user has TWO orphan DigiWorld users, no way to merge),
  case 3 mints a duplicate.
- **Auto-link-if-authed / else redirect to login** — case 2 works if the
  user is already logged in, but case 1 forces the user to create a
  password first just to abandon it. Case 3 needs a password reset dance.
- **Show provider chooser first** — forces two extra pageloads on every
  login and doesn't actually help — the provider is already known by the
  time we're at the callback.

## Decision

**Hybrid decide via a short-lived pending token.** When the callback
lands on an unknown identity, we do NOT commit to either outcome:

1. Package the callback data (provider, providerUserId, provider
   username/avatar/email, upstream tokens, `returnTo`) into a
   `oauth:pending:{token}` cluster KV with a 10-minute TTL, single-use.
2. Redirect to the frontend page `/oauth/decide?token=...`.
3. The frontend fetches a preview via `GET /api/auth/oauth/pending/:token`
   — SHOWS the user "Signing in as Alice (Discord). Do you want to…"
   with two buttons.
4. User picks:
   - **"Create a new account"** → `POST /api/auth/oauth/decide { choice:
     'create', pendingToken }`. Backend mints a placeholder-hash user,
     inserts `oauth_tokens`, mirrors `users.discord_id` (if Discord),
     issues a session.
   - **"Log in and link to my existing account"** → `POST … { choice:
     'link', pendingToken, username, password }`. Backend argon2-verifies
     the password, inserts `oauth_tokens` on the existing user_id,
     mirrors, issues a session.
5. Either choice consumes the pending token (DEL from cluster).

The pending token is the KEY move — it's the "we haven't decided yet"
state made explicit. Neither path fires until the user chooses.

## Consequences

### Positive

- **Zero orphaned accounts** from the auto-create path. Case 2 and case
  3 users can always link into their existing account.
- **First-time sign-up stays one click** on the decide page. No password
  friction if they don't want an account tied to a password.
- **Case 3 has an escape hatch** — the user picks "link" with their old
  provider's password (or resets it first) instead of accidentally
  minting a duplicate. If they only remember one provider, the "create"
  option is still there — they may end up with two accounts, but that's
  their explicit choice, not the system's silent decision.
- **Provider-agnostic.** Adding Google + Facebook was one class per
  provider (`GoogleOAuthProvider`, `FacebookOAuthProvider`) — the
  decide flow didn't need any changes. See [[OAuth#Adding Google /
  Facebook / others]].
- **Race-free.** The pending token is single-use — the atomic DEL
  guarantees exactly-once decision even if the user double-clicks.

### Negative

- **One extra page** compared to naive auto-create. First-time OAuth
  sign-in is 2 clicks (provider + decide) instead of 1.
- **The 10-minute TTL is a real deadline.** If the user leaves the decide
  page open for 11 minutes, they get `pending-expired` and have to
  restart the OAuth flow. Fine in practice — 10 minutes is generous.
- **Frontend needs a route** — `/oauth/decide` is a real UI. Not free,
  but small (one component, no state beyond the token).
- **`ADMIN_BOOTSTRAP=closed` interaction.** The "create" branch respects
  the closed-registration gate. This is the RIGHT behavior — OAuth
  shouldn't be a backdoor around closed registration — but it means a
  fresh Discord identity on a production deploy sees "linking only".
  We accept this; see [[OAuth#ADMIN_BOOTSTRAP still gates account
  creation]].

### Neutral

- **The upstream provider's tokens are stored in the pending record.**
  So when the user picks "create", we don't re-hit the provider to
  fetch the same tokens again. Nice for reliability; a small
  short-lived leak surface if the pending storage is compromised
  (bounded by the 10-minute TTL).

## Rejected alternatives

### Auto-create on unknown provider ID

Simpler flow, one fewer page. Rejected because it silently forks a
user's identity on case 2 and case 3 without their knowledge. The
duplicate-account bug is impossible to recover from without operator
intervention (manual DB merge). See "orphaned accounts" above.

### Force login-first

"To link, please log in first with your existing account." Rejected
because it turns case 1 (new user) into "create an account, then link
your Discord to it" — which requires the user to think about linking as
a concept before they've even signed in. High UX friction, low
information gain for the system.

### Auto-link if the provider's email matches an existing user's email

A middle-ground UX. Rejected because email-matching without the user's
explicit consent lets provider email spoofing / typos escalate:
someone typos "victim@gmail.com" as their Discord email, then all their
Discord OAuth signins get autolinked to a stranger's DigiWorld account.
The decide page makes the linkage decision explicit and requires the
user to prove they own both sides (via the linkee's password).

### Redirect to a full "chooser" page BEFORE the OAuth roundtrip

Ask the user "sign up or link?" first, THEN send to Discord. Rejected
because — as noted in Context — the provider is already known; the
question we need to ask can only be answered AFTER the callback.

## Related

- [[OAuth]] — the system reference (endpoints, code paths)
- [[Session cookies]] — the cookie a successful decide sets
- [[Cluster Coordination Layer]] — `oauth:pending:{token}` lives here
- [[2026-07-31 — Standalone Admin SPA]] — the neighbouring ADR that
  landed the same day
