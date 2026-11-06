# What's On · London

A personal, installable web app (PWA) for what's on in London — **exhibitions, shows and art events** —
at the places you care about. No AI in the app, no API costs.

- **Calendar**: pick a day → *Happening* (talks, tours, lates, one-night shows) and *On now*
  (exhibitions and show runs), filtered to the places and people you follow. Shows say when they're
  on that day — or that there's no performance (e.g. Sundays in the West End).
- **Feed**: on sale soon (with presales), people you follow, just announced, this weekend, opening
  this week, last chance.
- **Places**: over 260 London museums, galleries, theatres, arts centres, music and comedy venues to follow.
  **People**: ~2,000 comedians, bands, speakers and shows with London dates — follow them and their
  dates show up wherever they play, even at venues not in the list.
- **Saved**: everything you've starred, this week first, then later — with a one-tap tidy-up of
  anything that's finished.
- **Sync**: Saved → *Sync with your other devices*. Turn it on on one device, type the code on the
  others, and places, people and saved events stay the same everywhere (no account).

## How it works

```
GitHub Action (daily, free)                     Vercel (free)
  scrape ~90 sources ─► data/events.json ─commit─► rebuild static site ─► your phone (PWA, works offline)
        │
        └─ health check ─► "Source broken" issue ─► Claude scheduled task (your Claude plan)
                                                     fixes the config ─► PR ─► CI auto-merges
```

- **Sources** (`data/sources.json`): each venue's own website (structured data, listing cards or
  detail pages), plus aggregators — e.g. *Official London Theatre* covers ~70 West End and
  off-West End theatres in one request.
- **No workarounds**: sites that block automated requests (e.g. the British Museum, Royal Academy,
  Southbank Centre) are marked *manual*; their events come via aggregators or the "Add event" form.
- **Self-maintaining**: when a site's markup changes, the daily health check opens an issue and the
  scheduled Claude task fixes it (see `MAINTAINING.md`). Config-only fixes auto-merge after tests.

## Using it

- **Install**: open the site on your phone → Share → *Add to Home Screen*.
- **Follow** places in the Places tab; your follows and saved events stay on the device
  (*Share list* gives you a link to copy them to another device).
- **Add an event the scrapers miss**: *Add an event here* on a venue page (opens a GitHub issue form —
  a workflow adds it to `data/manual-events.json` and closes the issue).
- **Request a venue**: Places → *Request a place*. The maintenance task adds it.

## Optional free API keys

Two official event APIs fill gaps the venue sites can't (West End and big venues, gigs, comedy). They're
free, and the sources are simply *skipped* until a key is added:

| API | Get a key | GitHub secret name |
|---|---|---|
| Ticketmaster Discovery | developer.ticketmaster.com → sign up → *My Apps* → copy the **Consumer Key** | `TICKETMASTER_API_KEY` |
| Skiddle | skiddle.com/api/join.php → you'll be emailed a key | `SKIDDLE_API_KEY` |

Add each in GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret**.
The next daily scrape picks them up (or run *Actions → Daily scrape → Run workflow*). Keys stay in
GitHub — they're never in the app or the logs.

Ticketmaster also gives each show's performance days and times, on-sale dates and performers (that's
where the People list comes from). It has no prices for UK events and no sold-out status on a free key.

Opening hours come from OpenStreetMap (no key; refreshed weekly) and show on venue pages and as
"Venue closed" on the calendar.

## Deploy (one-time)

1. In Vercel: *Add New → Project → Import* `wgates50/Whats-On2027` (framework: Next.js, defaults).
2. Every push to `main` (including the daily data commit) redeploys automatically.
3. For device sync, add free storage: project → **Storage → Create → Blob**, name `whatson-sync`,
   region London, access **Private**, and connect it to the project (all environments). That adds
   `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` to the project (nothing to copy anywhere); redeploy once.
   Without it everything else works and Sync says it isn't set up.

All pages are prerendered; the only server code is `/api/sync` (a few requests a day, well within
Vercel's free tier).

## Develop

```bash
npm ci
npm run dev            # http://localhost:3000
npm test               # date parser + replay recorded venue pages
npm run scrape -- --only tate-modern --dry
```

See `CLAUDE.md` for the code map and `MAINTAINING.md` for the maintenance runbook.
