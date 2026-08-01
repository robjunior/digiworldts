---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Scrape catalog
  - Bootstrap catalog
  - Fresh catalog
  - Digimon catalog seed
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - README.md
  - backend/src/scraper/verifier.ts
  - backend/src/digimon/xml.ts
verified-at-commit: 13dc16b
---

# Bootstrap a fresh scraped catalog

> [!info] When to use this
> A fresh deploy needs the Digimon catalog seeded. Without a catalog:
> - Starter rosters seed empty.
> - Combat has nothing to spawn as PvE enemies.
> - The admin catalog editor has nothing to filter.
>
> Two paths — CLI-first (recommended for production) and Register-first
> (browser-only, dev-friendly).

## What "catalog" means here

Three data sets, all derived from `api.skullbot.fr` + `wikimon.net`:

- **`scraped_catalog`** table (DB) — the raw ~434-entry list from
  skullbot: id, name, stage, attribute, evolution graph, portrait URL.
  Cheap to refresh; admin-facing only.
- **XML catalog** at `data/catalog/digimons.xml` — the AUTHORITATIVE
  playable roster. Every entry has stats, attacks, resistances. Curated
  from `scraped_catalog` + wikimon enrichment.
- **Assets** under `public/assets/digimon/{catalogId}/` —
  `portrait.webp` + `dot.gif` per entry, referenced by the XML.

The XML is the source of truth for gameplay. The DB scrape is upstream
plumbing; assets are the visual layer.

## Path A — CLI-first (recommended)

Populate everything BEFORE the first user registers, so their starter
roster seeds cleanly.

```bash
# 1. Pull the ~434-entry list into scraped_catalog
pnpm scrape --list

# 2. Enrich the first N entries with attack data (writes XML)
pnpm scrape --enrich --limit 20

# 3. Download portrait.webp + dot.gif for those entries
pnpm scrape --assets --limit 20

# 4. Bring the stack up
pnpm dev
# OR
docker compose up -d
```

Then register the first user via the browser. Because
`ADMIN_BOOTSTRAP=open` (during bootstrap — see
[[First admin bootstrap]]) AND the catalog now has 20 entries, the
starter roster seeder finds 3 random Rookies to give them.

### Increasing `--limit`

`--limit 20` is enough for a demo. Full catalog is ~434 entries, but
enriching + downloading all of them takes many minutes and hammers
wikimon. The scraper respects `SCRAPER_MIN_DELAY_MS` (default 150 ms
between requests) so it's polite; long-form catalog fills should be
scheduled overnight, not blocked-on interactively.

Typical fill sequence:

```bash
pnpm scrape --list                        # fast, seconds
pnpm scrape --enrich --limit 50           # ~5 min
pnpm scrape --assets --limit 50           # ~2 min
# --- deploy ---
pnpm scrape --enrich --limit 200 &        # background
pnpm scrape --assets --limit 200 &
wait
```

## Path B — Register-first (browser-only)

For local dev when you can't run the CLI easily.

```bash
pnpm dev                # backend up, empty catalog
```

1. Register the first user via the browser.
2. Because the catalog is empty, the starter-roster seeder defers —
   registration succeeds, but the roster is empty. (There is a
   `/api/roster/seed` endpoint the frontend can retry later.)
3. Log into the admin panel (the admin subdomain
   [[Deploy the admin panel to a subdomain]] or `/admin`):
   - Click **Refresh from skullbot** → `scraped_catalog` populates.
   - Click **Add to catalog** on each Digimon you want (each add pulls
     the attacks from wikimon on-demand).
4. Go to `/roster.html` (or the roster page in the SPA) → click **Try
   to seed starter roster**.
5. You get 3 starter Digimon based on the catalog you just curated.

Both paths converge on the same DB state.

## Live asset verifier (runs on every startup)

`backend/src/scraper/verifier.ts` walks the loaded XML catalog at boot,
finds every entry whose portrait/dot is missing OR truncated on disk,
and re-downloads. Idempotent — noop on a clean install; heals a
partial catalog automatically. Boot log:

```json
{"msg":"boot.verify","totalCatalog":434,"ok":434,"repaired":0,"irreparable":[],"summary":{"downloaded":0,"skipped":0,"failed":0}}
```

If `irreparable` is non-empty, those IDs' upstream URLs are down (skullbot
removed them or wikimon renamed the page). Investigate manually via
[`data/catalog/digimons.xml`](../../mnt/sdc/digiworld/data/catalog/digimons.xml).

## Verify

Catalog well-formed and complete-enough:

```bash
docker exec digiworld-backend-1 sh -c '
cat /app/backend/data/catalog/digimons.xml | grep -c "<digimon "
'
# → e.g. 20 (or whatever your --limit was)
```

Assets on disk:

```bash
docker exec digiworld-backend-1 sh -c '
ls /app/backend/public/assets/digimon | wc -l
'
```

DB scraped list:

```sql
SELECT COUNT(*) FROM scraped_catalog;
```

## HTTP verification (after boot)

```bash
curl -sS -b cookies.txt https://<host>/api/catalog | jq '.digimon | length'
# → the count of playable Digimon
```

## Path C — restore a curated XML directly

If you have an XML catalog from another deploy (backup, staging → dev
clone), skip the scrape entirely:

```bash
docker cp digimons.xml digiworld-backend-1:/app/backend/data/catalog/digimons.xml
docker exec digiworld-backend-1 sh -c 'chown node:node /app/backend/data/catalog/digimons.xml'
docker restart digiworld-backend-1
```

Boot's asset verifier will download any missing portrait/dot referenced
by the XML — you get a working catalog without needing wikimon rescans.

## What can go wrong

> [!warning] `SCRAPER_USER_AGENT` blocked upstream
> Wikimon has been sensitive to non-browser UAs at times. Symptom: every
> enrich returns 403 / 429 / captcha. Fix: update
> `SCRAPER_USER_AGENT` to a realistic browser string. See
> [`backend/src/config.ts`](backend/src/config.ts) for the current value.

> [!warning] `--limit N` truncates but starter seeding needs specific stages
> The starter roster seeder picks 3 random Rookies. If your `--limit 5`
> only pulled 5 Champions, the seed fails silently ("no eligible
> Rookies"). Verify with:
> ```sql
> SELECT stage, COUNT(*) FROM digimon_templates GROUP BY stage;
> ```
> Bump `--limit` until you have at least 3 Rookies.

> [!warning] Rate-limited scraper trickles forever
> `SCRAPER_MIN_DELAY_MS=150` × 434 entries = ~65 s just for the polite
> delay, plus network. `--limit 20` is intentionally conservative for
> dev. Production should schedule long-form fills as a background job.

> [!warning] Assets directory writable but readable by nginx
> The `public/assets/digimon/` bind-mount in `docker-compose.yml` uses
> the `assetdata` named volume. If you're serving assets from a
> different location (CDN, S3), make sure the URLs in the XML resolve.
> `<assets portrait="/assets/digimon/skb-317/portrait.webp"/>` is a
> RELATIVE path — the frontend resolves it against the current origin.

## Related

- [[First admin bootstrap]] — must run BEFORE the CLI-first path's
  register step
- [[Environments#Development]] — `.env` block including the scraper
  config
- [[HTTP Surface#Catalog + Roster]] — the read endpoints
- [[Architecture Overview#Boot sequence]] — where the asset verifier
  fits in
