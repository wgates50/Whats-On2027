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

test("Ticketmaster: busy windows are split so nothing is lost past the API's 1,000-result cap", async () => {
  process.env.TICKETMASTER_API_KEY = "secret-tm-key";
  // 100 performances a day for 30 days = 3,000 events: far more than one window can return.
  const day = (n: number) => new Date(Date.parse(TODAY) + n * 864e5).toISOString().slice(0, 10);
  const perfs = (days: number, perDay: number) =>
    Array.from({ length: days * perDay }, (_, i) => ({ ...perf(`e${i}`, day(Math.floor(i / perDay))), name: `Show ${i % perDay}` }));
  const api = (all: ReturnType<typeof perfs>) =>
    jsonFetcher((u) => {
      const [from, to, page] = [u.searchParams.get("startDateTime")!.slice(0, 10), u.searchParams.get("endDateTime")!.slice(0, 10), Number(u.searchParams.get("page"))];
      assert.ok(page * 200 < 1000, "never asks past the 1,000th result (the API errors)");
      const hits = all.filter((e) => e.dates.start.localDate >= from && e.dates.start.localDate < to);
      return { _embedded: { events: hits.slice(page * 200, page * 200 + 200) }, page: { size: 200, totalElements: hits.length, totalPages: Math.ceil(hits.length / 200), number: page } };
    });

  const f = api(perfs(30, 100));
  const res = await ticketmaster({ fetcher: f, today: TODAY, log: () => {} }, { segments: ["Arts & Theatre"], days: 30, windowDays: 30 });
  assert.equal(res.linksFound, 3000); // every performance fetched
  assert.equal(res.events.length, 100); // collapsed into one run per show
  assert.deepEqual(res.events[0].dates, { startDate: TODAY, endDate: day(29) });
  assert.deepEqual(res.warnings, []);
  assert.ok(f.urls.length <= 20, `${f.urls.length} requests`); // 1 probe + ~3,000/200 pages

  // A single day that's still too busy can't be split: take what the API gives and say so.
  const g = api(perfs(1, 1200));
  const one = await ticketmaster({ fetcher: g, today: TODAY, log: () => {} }, { segments: ["Arts & Theatre"], days: 1 });
  assert.equal(one.linksFound, 1000);
  assert.match(one.warnings.join(), /over 1000 events in one day/);
});

test("Ticketmaster: add-ons and attraction admissions aren't events; moved gigs are dropped", () => {
  const cls = (segment: string, genre: string, type?: string, subType?: string) => ({
    classifications: [{ primary: true, segment: { name: segment }, genre: { name: genre }, type: type && { name: type }, subType: subType && { name: subType } }],
  });
  const notEvents = [
    { name: "Abba Voyage - VIP Premium Package" },
    { name: "kwn - VIP Upgrades Only (No Event Tickets Included)" },
    { name: "Gladiators Live - Venue Premium Tickets" },
    { name: "The Lord Of The Rings: Official Premium Ticket and Hotel Experiences" },
    { name: "Frameless Gift Card Redemption" },
    { name: "London Eye - Standard Experience" },
    { name: "The Tower of London - Standard All Day Entry" },
    { name: "Kehlani Extras", ...cls("Miscellaneous", "Undefined", "Upsell", "Concession Voucher") },
    { name: "The View from The Shard", ...cls("Miscellaneous", "Undefined", "Event Style", "Sightseeing/Facility") },
  ];
  for (const x of notEvents) assert.equal(mapTmEvent({ ...perf("n", "2026-12-01"), ...x } as never), null, x.name);
  // Look-alikes that are real shows stay.
  for (const name of ["The Dire Straits Experience", "Rock n Roll Freakshow Experience w/Band of Skulls", "The Paddington Bear Experience"])
    assert.ok(mapTmEvent({ ...perf("k", "2026-12-01"), name } as never), name);
  assert.equal(mapTmEvent({ ...perf("m", "2026-11-19"), name: "Rizzle Kicks ** MOVED TO O2 ACADEMY BRIXTON" } as never)!.cancelled, true);
});

test("Ticketmaster: its classification decides the type, so a band's World Tour is a concert", () => {
  const source: SourceConfig = { id: "ticketmaster", name: "TM", enabled: true, aggregator: true, adapter: { type: "custom", module: "ticketmaster" } };
  const at = (venue: string, name: string, segment: string, genre: string, subType?: string) =>
    mapTmEvent({
      ...perf(name, "2026-11-20"),
      name,
      classifications: [{ primary: true, segment: { name: segment }, genre: { name: genre }, subType: subType && { name: subType } }],
      _embedded: { venues: [{ name: venue, city: { name: "London" } }] },
    } as never)!;
  const raws = [
    at("Roundhouse", "Boy Harsher - The Heartbreak Tour", "Music", "Rock"),
    at("Alexandra Palace", "Gorgon City", "Music", "Dance/Electronic"),
    at("Eventim Apollo", "Atsuko Okatsuka - The Big Bowl Tour", "Arts & Theatre", "Comedy"),
    at("The Lightroom", "Matisse: Joy", "Arts & Theatre", "Fine Art", "Exhibit"),
    at("The O2", "Mo Gilligan: The Mo You Know", "Arts & Theatre", "Comedy"),
  ];
  const rep = normalize(raws, source, new VenueIndex(loadVenues()), TODAY);
  assert.deepEqual(
    rep.events.map((e) => [e.venueId, e.type]),
    [
      ["roundhouse", "concert"],
      ["alexandra-palace", "concert"],
      ["eventim-apollo", "show"],
      ["lightroom", "exhibition"],
      ["the-o2", "show"], // the arena, not indigo at The O2
    ],
  );
});

test("Ticketmaster: the same show listed with and without a year or ticket tier is one run", () => {
  const f = (id: string, name: string, date: string) => mapTmEvent({ ...perf(id, date), name, _embedded: { venues: [{ name: "Marble Arch Place" }] } } as never)!;
  const runs = collapseRuns([f("1", "FRAMELESS", "2026-11-02"), f("2", "FRAMELESS 2026", "2026-12-31"), f("3", "Illusions STANDARD", "2026-11-03"), f("4", "Illusions PEAK", "2026-11-07")]);
  assert.deepEqual(
    runs.map((r) => [r.title, r.dates.startDate, r.dates.endDate]),
    [
      ["FRAMELESS", "2026-11-02", "2026-12-31"],
      ["Illusions STANDARD", "2026-11-03", "2026-11-07"],
    ],
  );
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
