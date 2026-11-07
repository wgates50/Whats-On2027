// Behaviour of the generic pages adapter that fixtures don't exercise: sitemaps, the detail-page
// cache, fetch/time budgets, dates from URLs, venue filters and cross-source de-duplication.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PagesAdapterConfig, SourceConfig, WOEvent } from "../lib/types.ts";
import type { DetailCache } from "./adapters/index.ts";
import { dateFromUrl, runPages } from "./adapters/pages.ts";
import type { Fetcher, FetchResult } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { absorb, sameThing } from "./dedupe.ts";
import { VenueIndex } from "./venues.ts";
import { loadVenues } from "./config.ts";

const TODAY = "2026-11-02";

/** In-memory fetcher that counts requests. */
function fakeFetcher(pages: Record<string, string>): Fetcher & { log: string[] } {
  const log: string[] = [];
  return {
    requests: 0,
    log,
    async get(url: string): Promise<FetchResult> {
      log.push(url);
      this.requests++;
      const body = pages[url];
      if (body === undefined) throw new Error(`HTTP 404 for ${url}`);
      return { url, status: 200, body, contentType: url.endsWith(".xml") ? "application/xml" : "text/html" };
    },
  };
}

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://example.org/exhibitions/one</loc></url>
  <url><loc>https://example.org/exhibitions/two</loc></url>
  <url><loc>https://example.org/about</loc></url>
</urlset>`;
const detail = (name: string, venue: string) => `<html><head><title>${name}</title></head><body>
  <h1>${name}</h1><p class="venue">${venue}</p><p class="dates">8 October 2026 – 14 February 2027</p></body></html>`;
const PAGES = {
  "https://example.org/sitemap.xml": SITEMAP,
  "https://example.org/exhibitions/one": detail("Exhibition One", "Tate Britain, London"),
  "https://example.org/exhibitions/two": detail("Exhibition Two", "Kettle's Yard, Cambridge"),
};
const CFG: PagesAdapterConfig = {
  type: "pages",
  listUrls: ["https://example.org/sitemap.xml"],
  linkPattern: "^https://example\\.org/exhibitions/[^/]+$",
  cacheDays: 14,
  detail: { dates: "p.dates", venue: "p.venue" },
};

test("sitemap <loc> entries work as listing links", async () => {
  const f = fakeFetcher(PAGES);
  const res = await runPages({ ...CFG, cacheDays: undefined }, { fetcher: f, today: TODAY, log: () => {} });
  assert.deepEqual(res.events.map((e) => e.title).sort(), ["Exhibition One", "Exhibition Two"]);
  assert.equal(res.events[0].dates.startDate, "2026-10-08");
});

test("detail-page cache: second run fetches only the listing", async () => {
  const cache: DetailCache = new Map();
  const f1 = fakeFetcher(PAGES);
  await runPages(CFG, { fetcher: f1, today: TODAY, log: () => {}, cache });
  assert.equal(f1.requests, 3);
  assert.equal(cache.size, 2);
  const f2 = fakeFetcher(PAGES);
  const res = await runPages(CFG, { fetcher: f2, today: "2026-11-03", log: () => {}, cache });
  assert.deepEqual(f2.log, ["https://example.org/sitemap.xml"]);
  assert.equal(res.events.length, 2);
});

test("cache entries expire (within cacheDays) and get refetched", async () => {
  const cache: DetailCache = new Map();
  await runPages(CFG, { fetcher: fakeFetcher(PAGES), today: TODAY, log: () => {}, cache });
  const f = fakeFetcher(PAGES);
  await runPages(CFG, { fetcher: f, today: "2026-11-20", log: () => {}, cache }); // 18 days later
  assert.equal(f.requests, 3);
});

test("pages that left the listing are dropped from the cache", async () => {
  const cache: DetailCache = new Map();
  await runPages(CFG, { fetcher: fakeFetcher(PAGES), today: TODAY, log: () => {}, cache });
  const smaller = { ...PAGES, "https://example.org/sitemap.xml": SITEMAP.replace(/<url><loc>[^<]*two<\/loc><\/url>/, "") };
  await runPages(CFG, { fetcher: fakeFetcher(smaller), today: TODAY, log: () => {}, cache });
  assert.deepEqual([...cache.keys()], ["https://example.org/exhibitions/one"]);
});

test("fetch budget and deadline stop detail fetching gracefully", async () => {
  const cache: DetailCache = new Map();
  const f = fakeFetcher(PAGES);
  const res = await runPages({ ...CFG, maxLinks: 1 }, { fetcher: f, today: TODAY, log: () => {}, cache });
  assert.equal(f.requests, 2);
  assert.match(res.warnings.join(" "), /1 detail pages left for the next run/);
  const g = fakeFetcher(PAGES);
  await runPages({ ...CFG, cacheDays: undefined }, { fetcher: g, today: TODAY, log: () => {}, deadline: Date.now() - 1 });
  assert.equal(g.requests, 1); // listing only
});

test("dateFromUrl reads dates and times encoded in links", () => {
  const re = "/whats-on/(?<y>\\d{4})(?<m>\\d{2})(?<d>\\d{2})(?<H>\\d{2})(?<M>\\d{2})$";
  assert.deepEqual(dateFromUrl("https://www.wigmore-hall.org.uk/whats-on/202611041930", re), {
    startDate: "2026-11-04",
    endDate: null,
    startTime: "19:30",
  });
  assert.equal(dateFromUrl("https://www.wigmore-hall.org.uk/whats-on/series/x", re), null);
});

test("venueFilter keeps only matching venue text before matching venues", async () => {
  const venues = new VenueIndex(loadVenues());
  const res = await runPages({ ...CFG, cacheDays: undefined }, { fetcher: fakeFetcher(PAGES), today: TODAY, log: () => {} });
  const source: SourceConfig = { id: "t", name: "t", enabled: true, aggregator: true, venueFilter: ",\\s*London$", adapter: CFG };
  const rep = normalize(res.events, source, venues, TODAY);
  assert.deepEqual(rep.events.map((e) => [e.venueId, e.title]), [["tate-britain", "Exhibition One"]]);
  assert.equal(rep.filtered, 1);
  assert.deepEqual(rep.unmatchedVenues, {}); // Cambridge isn't reported as an unknown venue
});

test("sameThing: same exhibition from two sources, but not different shows", () => {
  const run = { startDate: "2026-10-08", endDate: "2027-01-03" };
  assert.ok(sameThing({ title: "Frida: The Making of an Icon", ...run }, { title: "Frida Kahlo: The Making of an Icon", ...run }));
  assert.ok(sameThing({ title: "The 90s: Art and Fashion", ...run }, { title: "The 90s", startDate: null, endDate: "2027-02-14" }));
  assert.ok(!sameThing({ title: "Frida: The Making of an Icon", ...run }, { title: "Ana Mendieta", ...run }));
  assert.ok(!sameThing({ title: "Monet", ...run }, { title: "Monet", startDate: "2027-02-25", endDate: "2027-06-27" }));
});

test("absorb: a ticketing API's classification corrects a venue's default type, never its listing's own evidence", () => {
  const ev = (o: Partial<WOEvent> = {}): WOEvent => ({
    id: "union-chapel:x",
    venueId: "union-chapel",
    sourceId: "union-chapel",
    title: "Matt Mathews",
    url: "https://unionchapel.org.uk/whats-on/x",
    type: "concert",
    category: "shows",
    startDate: "2026-12-01",
    endDate: null,
    firstSeen: TODAY,
    ...o,
  });
  const tm = (o: Partial<WOEvent>) => ev({ sourceId: "ticketmaster", url: "https://www.ticketmaster.co.uk/x", ...o });

  // Union Chapel's listings default to concert; Ticketmaster knows this one's a comedian.
  const comic = ev({ typeGuessed: true });
  absorb(comic, tm({ type: "show", genres: ["Arts & Theatre/Comedy/Comedy"], people: ["matt-mathews"] }), "live-venue");
  assert.deepEqual([comic.type, comic.category, comic.typeGuessed], ["show", "shows", undefined]);
  assert.deepEqual([comic.genres, comic.people], [["Arts & Theatre/Comedy/Comedy"], ["matt-mathews"]]);

  // A one-night thing at an arts centre with nothing to say what it was becomes a gig (and a show).
  const gig = ev({ venueId: "barbican", type: "event", category: "art-events", typeGuessed: true });
  absorb(gig, tm({ type: "concert" }), "arts-centre");
  assert.deepEqual([gig.type, gig.category], ["concert", "shows"]);
  // Talks and films too ("Film/Music": a film with a live score).
  const film = ev({ title: "William Shakespeare’s Romeo + Juliet", type: "show", typeGuessed: true });
  absorb(film, tm({ type: "screening" }), "live-venue");
  assert.equal(film.type, "screening");

  // The listing's own evidence stays: Ticketmaster files film-with-orchestra nights under theatre.
  const muppets = ev({ title: "The Muppet Christmas Carol in Concert" });
  absorb(muppets, tm({ type: "show" }), "live-venue");
  assert.equal(muppets.type, "concert");

  // Nor does a guess give way to the API's own guess, or to another listing site; tours stay tours,
  // and an API's family or exhibition label doesn't re-type a show.
  const guess = ev({ type: "show", typeGuessed: true });
  absorb(guess, tm({ type: "concert", typeGuessed: true }), "live-venue");
  absorb(guess, ev({ sourceId: "official-london-theatre", type: "concert" }), "live-venue");
  assert.equal(guess.type, "show");
  const tour = ev({ type: "tour", typeGuessed: true });
  absorb(tour, tm({ type: "concert" }), "live-venue");
  assert.equal(tour.type, "tour");
  const kids = ev({ type: "show", typeGuessed: true });
  absorb(kids, tm({ type: "family" }), "live-venue");
  assert.equal(kids.type, "show");
});

test("normalize lists the events whose type is only a default", () => {
  const source: SourceConfig = { id: "union-chapel", name: "Union Chapel", enabled: true, venueId: "union-chapel", defaults: { type: "concert" }, adapter: CFG };
  const raw = (title: string, typeLabel?: string) => ({ url: `https://unionchapel.org.uk/whats-on/${encodeURIComponent(title)}`, title, typeLabel, dates: { startDate: "2026-12-01", endDate: null } });
  const rep = normalize([raw("Matt Mathews"), raw("Sunday Jam in Concert"), raw("Tim Key", "Comedy")], source, new VenueIndex(loadVenues()), TODAY);
  assert.deepEqual(rep.events.map((e) => [e.title, e.type]), [["Matt Mathews", "concert"], ["Sunday Jam in Concert", "concert"], ["Tim Key", "show"]]);
  assert.deepEqual(rep.defaultTyped.map((e) => e.title), ["Matt Mathews"]);
  assert.ok(rep.events.every((e) => !("typeGuessed" in e))); // the scrape marks them, not normalize
});

test("discover builds selectors that survive site redeploys", async () => {
  const { stableStep } = await import("./discover.ts");
  assert.equal(stableStep("div", "InformationCardstyles__Content-sc-1rrmvlw-3 EventCardstyles__CardContent-sc-1gq4rkg-5"), 'div[class*="InformationCardstyles__Content"][class*="EventCardstyles__CardContent"]');
  assert.equal(stableStep("a", "iScFvn card"), "a.card");
  assert.equal(stableStep("a", "w-7/8 md:w-full promo"), "a.promo");
  assert.equal(stableStep("p", "o-teaser__date"), "p.o-teaser__date");
});
