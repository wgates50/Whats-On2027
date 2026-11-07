# What's On — repo guide for Claude

Personal London "what's on" PWA (exhibitions, shows, art events). **No AI in the app**: listings come
from deterministic scrapers configured in JSON. Claude's role is *maintenance only* — see
`MAINTAINING.md` (that's the runbook for the scheduled task; follow its ground rules).

## Layout

- `data/venues.json` — every place you can follow (id is permanent: follows are stored against it).
- `data/sources.json` — where events come from. `venueId` = one venue's own site; `aggregator: true` =
  feeds many venues, matched by name/aliases (`scraper/venues.ts`).
- `data/events.json`, `data/health.json`, `data/people.json`, `data/cache/` — **generated** by the daily scrape
  (`data/cache/enrich.json` = descriptions/images read from events' own pages by `scraper/enrich.ts`).
  Don't hand-edit. `people.json` = performers named by the ticketing APIs + their dates at venues we
  don't list (`elsewhere`, venueId `""`); people's ids are name slugs (follows are stored against them).
  (Bump `CACHE_VERSION` in `scraper/run.ts` when you change page parsing in a way that changes cached results.)
- `data/manual-events.json` — hand-added events (via the "Add an event" issue form → workflow).
- `data/themes.json` — the fixed list of themes (ids permanent); `data/tags.json` — themes the daily
  maintenance task assigns to venues, events and performers (`npm run themes -- todo | apply | check`,
  `scraper/tagging.ts`). Rules in `lib/themes.ts` give first guesses (API genres, title words, the
  venue's themes) until something's tagged; themes are worked out at build time into `app.json`.
  **Discover** (`components/DiscoverView.tsx`, `lib/profile.ts`) builds a profile on the device from the
  themes of what you follow, save, pick and have been to ("I've been" on a listing; `visited` + `memo` in
  prefs, so what you saved/went to still counts after the listing has gone), and suggests events, places
  and people. Suggestions cite a real connection — shared distinctive words from titles/descriptions
  (`lib/keywords.ts`, build time) or a theme that isn't everywhere — not just a broad shared theme.
  Still no AI in the app.
- `data/hours.json` — opening hours from OpenStreetMap via Nominatim (`npm run hours`, weekly in CI;
  parser in `lib/hours.ts`). © OpenStreetMap contributors — keep the credit where hours are shown.
- API sources: `scraper/adapters/custom/ticketmaster.ts`, `skiddle.ts` (keys from Actions secrets;
  `skipped` without them; tested with sample responses in `scraper/apis.test.ts`, no fixtures).
  Ticketmaster (12 months ahead): busy date windows split themselves (API stops at 1,000 results);
  add-ons and attraction admissions are dropped by `NOT_AN_EVENT`; its classification sets
  `schemaType`. Runs carry a `schedule` (which days have performances, and times), `onSale` (general
  sale + presales, only while nothing's on sale yet) and `people`. The scrape copies these onto the
  venue's own listing when it wins de-duplication (`absorb` in `scraper/dedupe.ts`), and its classification
  (gig / show / talk / film) replaces the listing's type when that was only a default (`typeGuessed`, never
  written out). Their events link to their pages and the app credits
  them ("View on Ticketmaster") — keep that.
- `scraper/` — `run.ts` (daily), `adapters/` (`pages` = listing/cards/detail pages + JSON-LD, `ics`),
  `dates.ts` (UK date-range parser), `classify.ts` (type/category rules), `normalize.ts`,
  `discover.ts` / `probe.ts` (config helpers), `fixture.ts` + `fixtures/` (recorded pages for tests).
- `app/`, `components/`, `lib/` — Next.js 16 PWA, every page prerendered; the one server route is
  `app/api/sync` (device sync: one private Vercel Blob document per sync code, `lib/syncStore.ts`,
  `lib/sync.ts`; `SYNC_DEV_DIR` = local folder store for testing). Data reaches the app as
  `public/data/app.json` and `public/data/people.json` (loaded only for people pages or when you follow
  someone), built by `scripts/build-data.ts` in `prebuild`. Follows (places and people)/saved live in
  localStorage (`lib/store.ts`). One static `/person/?id=…` page serves every performer.
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
npm run themes -- todo              # what still needs themes (the daily task answers; then: apply <file>)
npm run fixture -- <sourceId>        # re-record after changing a source config
npm run fixture -- --rebaseline --all  # after changing classify/venue rules
```

In cloud sessions, network commands need `NODE_USE_ENV_PROXY=1`.

## Conventions

- Respect robots.txt and blocks — never work around a 401/403/429 (see MAINTAINING.md rule 3).
- Be polite: the fetcher spaces requests to a host by 1.5s; keep `maxLinks` modest (≤ 60).
- Keep the app copy British English. Keep the visual style (paper/ink/vermilion, serif + grotesk).
- The app name lives in `lib/site.ts` (`APP_NAME`).
