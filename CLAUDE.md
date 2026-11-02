# What's On — repo guide for Claude

Personal London "what's on" PWA (exhibitions, shows, art events). **No AI in the app**: listings come
from deterministic scrapers configured in JSON. Claude's role is *maintenance only* — see
`MAINTAINING.md` (that's the runbook for the scheduled task; follow its ground rules).

## Layout

- `data/venues.json` — every place you can follow (id is permanent: follows are stored against it).
- `data/sources.json` — where events come from. `venueId` = one venue's own site; `aggregator: true` =
  feeds many venues, matched by name/aliases (`scraper/venues.ts`).
- `data/events.json`, `data/health.json`, `data/cache/` — **generated** by the daily scrape. Don't hand-edit.
  (Bump `CACHE_VERSION` in `scraper/run.ts` when you change page parsing in a way that changes cached results.)
- `data/manual-events.json` — hand-added events (via the "Add an event" issue form → workflow).
- `data/hours.json` — opening hours from OpenStreetMap via Nominatim (`npm run hours`, weekly in CI;
  parser in `lib/hours.ts`). © OpenStreetMap contributors — keep the credit where hours are shown.
- API sources: `scraper/adapters/custom/ticketmaster.ts`, `skiddle.ts` (keys from Actions secrets;
  `skipped` without them; tested with sample responses in `scraper/apis.test.ts`, no fixtures).
- `scraper/` — `run.ts` (daily), `adapters/` (`pages` = listing/cards/detail pages + JSON-LD, `ics`),
  `dates.ts` (UK date-range parser), `classify.ts` (type/category rules), `normalize.ts`,
  `discover.ts` / `probe.ts` (config helpers), `fixture.ts` + `fixtures/` (recorded pages for tests).
- `app/`, `components/`, `lib/` — Next.js 16 static-export PWA. Data reaches the app as
  `public/data/app.json` (built by `scripts/build-data.ts` in `prebuild`). Follows/saved live in
  localStorage (`lib/store.ts`).
- `.github/workflows/` — `scrape.yml` (daily 05:17 UTC, opens/closes `broken-source` issues),
  `ci.yml` (typecheck, tests, build; auto-merges `claude/*` PRs that only touch config + fixtures),
  `add-event.yml`.

## Commands

```bash
npm test                 # date tests + replay every fixture (no network)
npm run typecheck
npm run build            # static site → out/
npm run scrape -- --only <sourceId> --dry
npm run discover -- <url>
npm run probe -- <venueId>
npm run fixture -- <sourceId>        # re-record after changing a source config
npm run fixture -- --rebaseline --all  # after changing classify/venue rules
```

In cloud sessions, network commands need `NODE_USE_ENV_PROXY=1`.

## Conventions

- Respect robots.txt and blocks — never work around a 401/403/429 (see MAINTAINING.md rule 3).
- Be polite: the fetcher spaces requests to a host by 1.5s; keep `maxLinks` modest (≤ 60).
- Keep the app copy British English. Keep the visual style (paper/ink/vermilion, serif + grotesk).
- The app name lives in `lib/site.ts` (`APP_NAME`).
