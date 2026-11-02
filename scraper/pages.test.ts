// Behaviour of the generic pages adapter that fixtures don't exercise: sitemaps, the detail-page
// cache, fetch/time budgets, dates from URLs, venue filters and cross-source de-duplication.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PagesAdapterConfig, SourceConfig } from "../lib/types.ts";
import type { DetailCache } from "./adapters/index.ts";
import { dateFromUrl, runPages } from "./adapters/pages.ts";
import type { Fetcher, FetchResult } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { sameThing } from "./dedupe.ts";
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

test("discover builds selectors that survive site redeploys", async () => {
  const { stableStep } = await import("./discover.ts");
  assert.equal(stableStep("div", "InformationCardstyles__Content-sc-1rrmvlw-3 EventCardstyles__CardContent-sc-1gq4rkg-5"), 'div[class*="InformationCardstyles__Content"][class*="EventCardstyles__CardContent"]');
  assert.equal(stableStep("a", "iScFvn card"), "a.card");
  assert.equal(stableStep("a", "w-7/8 md:w-full promo"), "a.promo");
  assert.equal(stableStep("p", "o-teaser__date"), "p.o-teaser__date");
});
