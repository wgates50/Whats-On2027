// Filling in descriptions and images from events' own pages (scraper/enrich.ts) — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { enrich, readEventPage, type EnrichCache } from "./enrich.ts";
import type { Fetcher, FetchResult } from "./fetcher.ts";
import type { WOEvent } from "../lib/types.ts";

const page = (desc: string, img: string) =>
  `<html><head><meta property="og:description" content="${desc}"><meta property="og:image" content="${img}"></head><body></body></html>`;
const ev = (url: string, extra: Partial<WOEvent> = {}): WOEvent =>
  ({ id: url, venueId: "v", sourceId: "site", title: "T", url, type: "show", category: "shows", startDate: "2026-12-01", endDate: null, firstSeen: "2026-11-01", ...extra }) as WOEvent;

function fakeFetcher(pages: Record<string, string>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  return {
    requests: 0,
    asked,
    async get(url: string): Promise<FetchResult> {
      asked.push(url);
      if (!(url in pages)) throw new Error("HTTP 404");
      return { url, status: 200, contentType: "text/html", body: pages[url] };
    },
  };
}

test("descriptions and images come from the event's own page, once", async () => {
  const a = "https://venue.example/whats-on/a";
  const f = fakeFetcher({ [a]: page("A rare chance to see the full Kahlil Joseph film cycle on the big screen.", "https://venue.example/a.jpg") });
  const cache: EnrichCache = {};
  const events = [ev(a), ev("https://venue.example/whats-on/b", { description: "Already has one, and an image", image: "x.jpg" })];
  const r = await enrich(events, { fetcher: f, cache, today: "2026-11-06", deadline: Date.now() + 60_000, eligible: () => true });
  assert.deepEqual([r.fetched, r.filled], [1, 1]);
  assert.equal(events[0].description, "A rare chance to see the full Kahlil Joseph film cycle on the big screen.");
  assert.equal(events[0].image, "https://venue.example/a.jpg");
  // Next run: from the cache, no fetch.
  const again = [ev(a)];
  await enrich(again, { fetcher: f, cache, today: "2026-11-07", deadline: Date.now() + 60_000, eligible: () => true });
  assert.equal(f.asked.length, 1);
  assert.equal(again[0].image, "https://venue.example/a.jpg");
});

test("a site's generic blurb and logo aren't used; ineligible sources (APIs) aren't fetched", async () => {
  const urls = ["a", "b", "c"].map((x) => `https://museum.example/event/${x}`);
  const blurb = "Welcome to the Museum, one of London's best-loved places to spend a day out with the family.";
  const f = fakeFetcher(Object.fromEntries(urls.map((u) => [u, page(blurb, "https://museum.example/logo.png")])));
  const events = urls.map((u) => ev(u));
  const tm = ev("https://www.ticketmaster.co.uk/event/1", { sourceId: "ticketmaster" });
  await enrich([...events, tm], { fetcher: f, cache: {}, today: "2026-11-06", deadline: Date.now() + 60_000, eligible: (e) => e.sourceId !== "ticketmaster" });
  assert.ok(events.every((e) => !e.description && !e.image));
  assert.ok(!f.asked.includes(tm.url));
});

test("an event page's own JSON-LD description wins over the site's meta tags", () => {
  const html = `<html><head><meta name="description" content="Generic site text that is long enough to count as a description."><script type="application/ld+json">{"@type":"Event","name":"Hamlet","startDate":"2026-12-01","description":"Robert Hastie directs a new Hamlet set in a decaying Danish court."}</script></head></html>`;
  assert.equal(readEventPage(html, "https://x.example/e", "2026-11-06").d, "Robert Hastie directs a new Hamlet set in a decaying Danish court.");
});

test("a source's description selector and a mangled image address", () => {
  const html = `<html><head><meta property="og:image" content="https://chapel.example/https://cdn.example/img/a.jpg"><meta property="og:description" content="The venue's generic blurb that every single page carries, word for word."></head>
    <body><div class="pt-4"><p>The monthly spectacle returns with another extraordinary line up;</p><p>One of the nation's favourite stand-ups headlines the Chapel.</p></div></body></html>`;
  const r = readEventPage(html, "https://chapel.example/whats-on/x", "2026-11-06", ".pt-4 > p");
  assert.equal(r.d, "The monthly spectacle returns with another extraordinary line up; One of the nation's favourite stand-ups headlines the Chapel.");
  assert.equal(r.i, "https://cdn.example/img/a.jpg");
});
