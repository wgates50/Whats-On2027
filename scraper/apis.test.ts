// API adapters (Ticketmaster, Skiddle) tested against sample responses shaped like the documented
// APIs — no keys or network needed. Also checks keys never leak into errors/logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import ticketmaster, { collapseRuns, mapTmEvent } from "./adapters/custom/ticketmaster.ts";
import skiddle, { mapSkiddleEvent } from "./adapters/custom/skiddle.ts";
import { MissingKeyError } from "./adapters/index.ts";
import { redact, type Fetcher, type FetchResult } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { VenueIndex } from "./venues.ts";
import { loadVenues } from "./config.ts";
import type { SourceConfig } from "../lib/types.ts";

const TODAY = "2026-11-02";

function jsonFetcher(respond: (u: URL) => unknown): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    requests: 0,
    urls,
    async get(url: string, opts?: { api?: boolean }): Promise<FetchResult> {
      assert.equal(opts?.api, true, "API calls must use api mode");
      urls.push(url);
      this.requests++;
      return { url, status: 200, contentType: "application/json", body: JSON.stringify(respond(new URL(url))) };
    },
  };
}

const perf = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Hamlet Hail to the Thief",
  url: `https://www.ticketmaster.co.uk/event/${id}`,
  images: [
    { url: "https://img/small.jpg", ratio: "3_2", width: 305 },
    { url: "https://img/wide.jpg", ratio: "16_9", width: 1024 },
    { url: "https://img/huge.jpg", ratio: "16_9", width: 2048 },
  ],
  dates: { start: { localDate: date, localTime: "19:30:00" }, status: { code: "onsale" } },
  classifications: [{ primary: true, segment: { name: "Arts & Theatre" }, genre: { name: "Theatre" } }],
  _embedded: { venues: [{ name: "Barbican Theatre", city: { name: "London" } }] },
  ...extra,
});

test("Ticketmaster: missing key means skipped, not broken", async () => {
  delete process.env.TICKETMASTER_API_KEY;
  await assert.rejects(ticketmaster({ fetcher: jsonFetcher(() => ({})), today: TODAY, log: () => {} }, {}), MissingKeyError);
});

test("Ticketmaster: maps events, collapses performances into a run, pages, skips postponed/test", async () => {
  process.env.TICKETMASTER_API_KEY = "secret-tm-key";
  const f = jsonFetcher((u) => {
    if (u.searchParams.get("classificationName") !== "Arts & Theatre" || u.searchParams.get("startDateTime") !== "2026-11-02T00:00:00Z")
      return { page: { size: 200, totalElements: 0, totalPages: 0, number: 0 } };
    const page = Number(u.searchParams.get("page"));
    if (page === 0)
      return {
        _embedded: {
          events: [
            perf("a1", "2026-11-05"),
            perf("a2", "2026-11-06"),
            { ...perf("p1", "2026-11-20"), name: "Postponed Thing", dates: { start: { localDate: "2026-11-20" }, status: { code: "postponed" } } },
            { ...perf("t1", "2026-11-21"), name: "Test Event", test: true },
          ],
        },
        page: { size: 200, totalElements: 300, totalPages: 2, number: 0 },
      };
    return {
      _embedded: {
        events: [
          perf("a3", "2026-11-28"),
          { ...perf("c1", "2026-11-10"), name: "Cancelled Gig", dates: { start: { localDate: "2026-11-10", localTime: "20:00:00" }, status: { code: "canceled" } } },
        ],
      },
      page: { size: 200, totalElements: 300, totalPages: 2, number: 1 },
    };
  });
  const res = await ticketmaster({ fetcher: f, today: TODAY, log: () => {} }, { segments: ["Arts & Theatre"], days: 30, windowDays: 30 });
  assert.equal(f.urls.length, 2); // page 0 and 1 of the only window
  assert.ok(f.urls.every((u) => u.includes("apikey=secret-tm-key") && u.includes("city=London") && u.includes("countryCode=GB")));
  const hamlet = res.events.find((e) => e.title === "Hamlet Hail to the Thief")!;
  assert.deepEqual(hamlet.dates, { startDate: "2026-11-05", endDate: "2026-11-28" });
  assert.equal(hamlet.image, "https://img/wide.jpg");
  assert.equal(hamlet.venueName, "Barbican Theatre");
  assert.equal(hamlet.typeLabel, "Arts & Theatre Theatre");
  assert.ok(!res.events.some((e) => e.title === "Postponed Thing" || e.title === "Test Event"));
  assert.equal(res.events.find((e) => e.title === "Cancelled Gig")?.cancelled, true);

  // Through normalize: matched to the Barbican, classified as a show, cancelled one dropped.
  const source: SourceConfig = { id: "ticketmaster", name: "TM", enabled: true, aggregator: true, adapter: { type: "custom", module: "ticketmaster" } };
  const rep = normalize(res.events, source, new VenueIndex(loadVenues()), TODAY);
  assert.deepEqual(rep.events.map((e) => [e.venueId, e.title, e.type, e.category]), [["barbican", "Hamlet Hail to the Thief", "show", "shows"]]);
  assert.equal(rep.cancelled, 1);
});

test("Ticketmaster: single performance keeps its time; free price detected", () => {
  const e = mapTmEvent({ ...perf("x", "2026-12-01"), priceRanges: [{ min: 0, max: 0 }] } as never)!;
  assert.deepEqual(e.dates, { startDate: "2026-12-01", endDate: null, startTime: "19:30" });
  assert.equal(e.price, "free");
  assert.deepEqual(collapseRuns([e]).length, 1);
});

test("Skiddle: maps events (London time, cancellations, free entry) and pages by offset", async () => {
  delete process.env.SKIDDLE_API_KEY;
  await assert.rejects(skiddle({ fetcher: jsonFetcher(() => ({})), today: TODAY, log: () => {} }, {}), MissingKeyError);
  process.env.SKIDDLE_API_KEY = "secret-sk-key";
  const ev = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    eventname: `Comedy Night ${id}`,
    EventCode: "COMEDY",
    cancelled: "0",
    venue: { name: "Clapham Grand", town: "London" },
    link: `https://www.skiddle.com/whats-on/London/Clapham-Grand/Comedy-Night/${id}/`,
    largeimageurl: `https://img/${id}.jpg`,
    date: "2026-11-07",
    startdate: "2026-11-07T19:30:00+00:00",
    enddate: "2026-11-08T01:00:00+00:00",
    entryprice: "£15.00",
    ...extra,
  });
  const f = jsonFetcher((u) => {
    const offset = Number(u.searchParams.get("offset"));
    const all = [ev(1), ev(2, { cancelled: "1" }), ev(3, { entryprice: "Free" })];
    return { error: 0, totalcount: "3", results: offset === 0 ? all.slice(0, 2) : all.slice(2) };
  });
  // LIMIT is 100, so with totalcount 3 there is one page per event code.
  const res = await skiddle({ fetcher: f, today: TODAY, log: () => {} }, { eventcodes: ["COMEDY"] });
  assert.equal(f.urls.length, 1);
  assert.ok(f.urls[0].includes("api_key=secret-sk-key") && f.urls[0].includes("minDate=2026-11-02") && f.urls[0].includes("maxDate=2027-01-31"));
  assert.equal(res.events.length, 2);
  const one = res.events[0];
  assert.deepEqual(one.dates, { startDate: "2026-11-07", endDate: null, startTime: "19:30" }); // ends after midnight ≠ run
  assert.equal(one.typeLabel, "Comedy");
  assert.equal(one.price, "paid");
  assert.equal(res.events[1].cancelled, true);
  assert.equal(mapSkiddleEvent(ev(3, { entryprice: "Free" }))!.price, "free");
  assert.deepEqual(mapSkiddleEvent(ev(4, { startdate: "2026-07-01T23:30:00+00:00", enddate: undefined }))!.dates, {
    startDate: "2026-07-02",
    endDate: null,
    startTime: "00:30",
  }); // BST conversion
});

test("API keys are redacted from anything that gets logged", () => {
  assert.equal(
    redact("https://app.ticketmaster.com/discovery/v2/events.json?apikey=SECRET&city=London"),
    "https://app.ticketmaster.com/discovery/v2/events.json?apikey=***&city=London",
  );
  assert.equal(redact("https://www.skiddle.com/api/v1/events/search/?api_key=SECRET&limit=100"), "https://www.skiddle.com/api/v1/events/search/?api_key=***&limit=100");
});
