// Daily scrape: run every enabled source, normalise, merge, health-check, write data/*.json.
//
//   npm run scrape                       # everything (what the GitHub Action runs)
//   npm run scrape -- --only tate-modern,vam   # just these sources (others' data is kept)
//   npm run scrape -- --only vam --dry   # print results, write nothing
//
// Never exits non-zero because a venue broke — that's what health.json + issues are for.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HealthStatus, Person, SourceConfig, WOEvent } from "../lib/types.ts";
import { MissingKeyError, runAdapter, type CachedDetail, type DetailCache } from "./adapters/index.ts";
import { loadEvents, loadHealth, loadPeople, loadSources, loadVenues, readJson, writeJson, type HealthFile } from "./config.ts";
import { enrich as fillDetails, type EnrichCache } from "./enrich.ts";
import { addDays, todayLondon } from "./dates.ts";
import { staleEvents } from "./health.ts";
import { BlockedError, createFetcher } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { VenueIndex, normName } from "./venues.ts";
import { sameThing } from "./dedupe.ts";

interface Outcome {
  source: SourceConfig;
  status: HealthStatus;
  message?: string;
  events: WOEvent[];
  warnings: string[];
  unmatchedVenues: Record<string, number>;
  elsewhere: WOEvent[];
  people: Record<string, Person>;
  /** Events that look like past ones read as current were held back (see staleEvents). */
  heldBack?: boolean;
  ms: number;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only")?.split(",").map((s) => s.trim());
const dry = args.includes("--dry");

const today = todayLondon();
const now = new Date().toISOString();
const venues = loadVenues();
const index = new VenueIndex(venues);
const allSources = loadSources();
const sources = allSources.filter((s) => s.enabled && (!only || only.includes(s.id)));
if (only) for (const id of only) if (!allSources.some((s) => s.id === id)) console.warn(`⚠ unknown source: ${id}`);
const prevEvents = loadEvents().events;
const prevPeople = loadPeople();
const prevHealth = loadHealth();
const fetcher = createFetcher({ mode: "live" });

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms).unref())]);
}

// Detail-page caches (sources with adapter.cacheDays) live in data/cache/<sourceId>.json. A cache is
// thrown away when the source's adapter config changes or CACHE_VERSION is bumped (bump it whenever
// the page-parsing code changes in a way that would change what gets cached).
const CACHE_DIR = new URL("../data/cache/", import.meta.url);
const CACHE_VERSION = 2;
const cacheKey = (s: SourceConfig) => createHash("sha1").update(JSON.stringify([CACHE_VERSION, s.adapter])).digest("hex").slice(0, 12);
interface CacheFile {
  key: string;
  pages: Record<string, CachedDetail>;
}
function loadCache(s: SourceConfig): DetailCache {
  const f = new URL(`${s.id}.json`, CACHE_DIR);
  if (!existsSync(f)) return new Map();
  const file = JSON.parse(readFileSync(f, "utf8")) as Partial<CacheFile>;
  return file.key === cacheKey(s) && file.pages ? new Map(Object.entries(file.pages)) : new Map();
}
function saveCache(s: SourceConfig, cache: DetailCache) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const pages = Object.fromEntries([...cache.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(new URL(`${s.id}.json`, CACHE_DIR), JSON.stringify({ key: cacheKey(s), pages } satisfies CacheFile, null, 1) + "\n");
}

async function runOne(source: SourceConfig): Promise<Outcome> {
  const t0 = Date.now();
  const base = { source, events: [] as WOEvent[], warnings: [] as string[], unmatchedVenues: {}, elsewhere: [] as WOEvent[], people: {} };
  const cache = source.adapter.type === "pages" && source.adapter.cacheDays ? loadCache(source) : undefined;
  try {
    // Adapters stop fetching at the deadline and return what they have; the timeout is only a backstop.
    const deadline = Date.now() + 10 * 60_000;
    const res = await withTimeout(
      runAdapter(source.adapter, { fetcher, today, cache, deadline, log: (m) => console.log(`  [${source.id}] ${m}`) }),
      15 * 60_000,
    );
    if (cache && !dry) saveCache(source, cache);
    const rep = normalize(res.events, source, index, today);
    const stale = staleEvents(rep.events, today);
    if (stale) rep.events = rep.events.filter((e) => !stale.includes(e)); // held back until the source is fixed
    const prev = prevHealth.sources[source.id];
    // "Usually ~N" only means something for the same config: after a fix (new selectors, a date
    // that was being misread) the count is allowed to move without being called a drop.
    const baseline = prev?.configKey === cacheKey(source) ? (prev?.lastOkCount ?? 0) : 0;
    const considered = rep.events.length + rep.invalid.length;
    let status: HealthStatus = "ok";
    let message: string | undefined;
    if (rep.invalid.length && rep.invalid.length >= considered * 0.5) {
      status = "invalid";
      message = `${rep.invalid.length} of ${considered} events failed validation, e.g. ${rep.invalid.slice(0, 3).join("; ")}`;
    } else if (res.linksFound >= 4 && res.skippedNoDates >= res.linksFound * 0.5) {
      status = "invalid";
      message = `${res.skippedNoDates} of ${res.linksFound} detail pages had no parseable dates — date selector probably broken`;
    } else if (stale) {
      status = "invalid";
      message = `${stale.length} events started over a year ago (e.g. "${stale[0].title}" from ${stale[0].startDate}) — past events are probably being read as current; check how this source's dates are parsed`;
    } else if (rep.events.length === 0) {
      // A multi-city listing with nothing in London this week is fine — as long as the cards do carry
      // location text (if none do, the venue selector is what broke).
      const quiet =
        !!source.venueFilter &&
        rep.filtered > 0 &&
        rep.invalid.length === 0 &&
        res.events.some((e) => e.venueName) &&
        rep.filtered + rep.past + rep.cancelled >= res.events.length;
      if (quiet) message = `nothing matching the venue filter right now (${res.events.length} listed elsewhere)`;
      else {
        status = "empty";
        message = `0 current events (adapter returned ${res.events.length}; ${rep.past} already finished; ${Object.keys(rep.unmatchedVenues).length} unknown venue names; ${res.linksFound} links found)`;
      }
    } else if (baseline >= 6 && rep.events.length < baseline * 0.5) {
      status = "dropped";
      message = `${rep.events.length} events, usually ~${baseline}`;
    }
    return {
      ...base,
      status,
      message,
      events: rep.events,
      warnings: res.warnings,
      unmatchedVenues: rep.unmatchedVenues,
      elsewhere: rep.elsewhere,
      people: rep.people,
      heldBack: !!stale,
      ms: Date.now() - t0,
    };
  } catch (e) {
    if (cache && !dry && cache.size) saveCache(source, cache); // keep partial progress
    if (e instanceof MissingKeyError) return { ...base, status: "skipped", message: e.message, ms: Date.now() - t0 };
    return { ...base, status: e instanceof BlockedError ? "blocked" : "error", message: (e as Error).message, ms: Date.now() - t0 };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const outcomes = await pool(sources, 6, async (s) => {
  const o = await runOne(s);
  console.log(`${o.status === "ok" ? "✓" : o.status === "skipped" ? "–" : "✗"} ${s.id.padEnd(34)} ${o.status.padEnd(8)} ${String(o.events.length).padStart(4)} events  ${(o.ms / 1000).toFixed(0)}s${o.message ? `  — ${o.message}` : ""}`);
  return o;
});

// A source's first successful run brings its whole programme at once (a new venue, a new API key) —
// that's not "just announced", so date it to when the app started. Same for the first people.json.
const startedOn = prevEvents.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), today);
for (const o of outcomes) {
  const first = o.status === "ok" && !prevHealth.sources[o.source.id]?.lastOk;
  for (const e of first ? o.events : []) e.firstSeen = startedOn;
  for (const e of first || !prevPeople.generatedAt ? o.elsewhere : []) e.firstSeen = startedOn;
}

// ---------------------------------------------------------------- merge

const isCurrent = (e: WOEvent) => {
  const last = e.endDate ?? (e.ongoing ? null : e.startDate);
  return !last || last >= today;
};
const ran = new Map(outcomes.map((o) => [o.source.id, o]));
const singleVenue = new Set(allSources.filter((s) => s.venueId).map((s) => s.id));

const merged: WOEvent[] = [];
for (const o of outcomes) {
  merged.push(...o.events);
  if (o.status !== "ok") {
    // Don't let one bad run wipe a venue: keep its previous, still-current events.
    const have = new Set(o.events.map((e) => e.id));
    // …except, when this run held back past-looking events, the same ones from before.
    const stalePrev = o.heldBack ? (e: WOEvent) => !!e.startDate && e.startDate < addDays(today, -365) : () => false;
    merged.push(...prevEvents.filter((e) => e.sourceId === o.source.id && !have.has(e.id) && isCurrent(e) && !stalePrev(e)));
  }
}
// Sources not run this time (--only, or temporarily disabled) keep their data.
const stillConfigured = new Set(allSources.filter((s) => s.enabled).map((s) => s.id));
for (const e of prevEvents) {
  if (!ran.has(e.sourceId) && (only ? true : stillConfigured.has(e.sourceId)) && isCurrent(e)) merged.push(e);
}

// De-duplicate: the same thing at the same venue from two sources (e.g. Tate's site and Art Fund, or a
// theatre's site and Official London Theatre) → keep the venue's own site's version. "Same thing" =
// similar title (most words shared) and overlapping dates.
const keyOf = (e: WOEvent) => `${e.venueId}|${normName(e.title)}`;
merged.sort((a, b) => Number(singleVenue.has(b.sourceId)) - Number(singleVenue.has(a.sourceId)));
const byKey = new Map<string, WOEvent>();
const byVenue = new Map<string, WOEvent[]>();
const prevById = new Map(prevEvents.map((e) => [e.id, e]));
const prevByKey = new Map(prevEvents.map((e) => [keyOf(e), e]));
/** The venue's own listing wins, but keeps what only the ticketing API knew. */
const enrich = (kept: WOEvent, dup: WOEvent) => {
  if (dup.schedule && !kept.schedule) kept.schedule = dup.schedule;
  if (dup.onSale && !kept.onSale) kept.onSale = dup.onSale;
  if (dup.people?.length) kept.people = [...new Set([...(kept.people ?? []), ...dup.people])];
  if (dup.genres?.length && !kept.genres) kept.genres = dup.genres;
};
for (const e of merged) {
  const k = keyOf(e);
  const same = byKey.get(k);
  if (same) {
    if (same.sourceId !== e.sourceId) enrich(same, e);
    continue;
  }
  const kept = byVenue.get(e.venueId) ?? [];
  // Only across sources: one site's own "Tour" and "BSL Tour" are separate events.
  const twin = kept.find((x) => x.sourceId !== e.sourceId && sameThing(x, e));
  if (twin) {
    enrich(twin, e);
    continue;
  }
  const firstSeen = [e.firstSeen, prevById.get(e.id)?.firstSeen, prevByKey.get(k)?.firstSeen].filter(Boolean).sort()[0]!;
  const ev = { ...e, firstSeen };
  byKey.set(k, ev);
  byVenue.set(e.venueId, [...kept, ev]);
}
const events = [...byKey.values()].sort(
  (a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.venueId.localeCompare(b.venueId) || a.title.localeCompare(b.title),
);

// ---------------------------------------------------------------- people

// Performers' dates at venues we don't list. Same carry-over rules as events: a source that failed
// (or wasn't run) keeps its previous, still-current ones.
const prevElsewhere = new Map(prevPeople.elsewhere.map((e) => [e.id, e]));
const elsewhereAll: WOEvent[] = [];
for (const o of outcomes) {
  elsewhereAll.push(...o.elsewhere);
  if (o.status !== "ok") {
    const have = new Set(o.elsewhere.map((e) => e.id));
    elsewhereAll.push(...prevPeople.elsewhere.filter((e) => e.sourceId === o.source.id && !have.has(e.id) && isCurrent(e)));
  }
}
for (const e of prevPeople.elsewhere) if (!ran.has(e.sourceId) && (only ? true : stillConfigured.has(e.sourceId)) && isCurrent(e)) elsewhereAll.push(e);
const elsewhereKey = (e: WOEvent) => `${normName(e.venueName ?? "")}|${normName(e.title)}`;
const elsewhereByKey = new Map<string, WOEvent>();
for (const e of elsewhereAll) {
  const k = elsewhereKey(e);
  const had = elsewhereByKey.get(k);
  if (had) {
    if (had.sourceId !== e.sourceId) enrich(had, e);
    continue;
  }
  const firstSeen = [e.firstSeen, prevElsewhere.get(e.id)?.firstSeen].filter(Boolean).sort()[0]!;
  elsewhereByKey.set(k, { ...e, firstSeen });
}
const elsewhere = [...elsewhereByKey.values()].sort(
  (a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || (a.venueName ?? "").localeCompare(b.venueName ?? "") || a.title.localeCompare(b.title),
);

// Everyone named by a current event (here or elsewhere); what the APIs said this run wins.
const peopleById = new Map<string, Person>(prevPeople.people.map((p) => [p.id, p]));
for (const o of outcomes)
  for (const p of Object.values(o.people)) {
    const had = peopleById.get(p.id);
    peopleById.set(
      p.id,
      had
        ? { ...had, ...p, links: { ...had.links, ...p.links }, tm: [...new Set([...(had.tm ?? []), ...(p.tm ?? [])])], genres: [...new Set([...(had.genres ?? []), ...(p.genres ?? [])])] }
        : p,
    );
  }
const named = new Set([...events, ...elsewhere].flatMap((e) => e.people ?? []));
const people = [...peopleById.values()]
  .filter((p) => named.has(p.id))
  .map((p) => ({
    ...p,
    ...(p.links && !Object.keys(p.links).length ? { links: undefined } : {}),
    ...(p.tm && !p.tm.length ? { tm: undefined } : {}),
    ...(p.genres && !p.genres.length ? { genres: undefined } : {}),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------- details

// Listing cards rarely carry a description: read it (and an image) from each event's own page, once.
const enrichCache = readJson<EnrichCache>("cache/enrich.json", {});
const pageSources = new Set(allSources.filter((s) => s.adapter.type === "pages").map((s) => s.id));
if (!dry || args.includes("--enrich")) {
  const r = await fillDetails(events, {
    fetcher,
    cache: enrichCache,
    today,
    deadline: Date.now() + 5 * 60_000,
    eligible: (e) => pageSources.has(e.sourceId),
    descSelector: (url) => {
      const e = events.find((x) => x.url === url);
      return e ? allSources.find((x) => x.id === e.sourceId)?.enrich?.description : undefined;
    },
  });
  console.log(`details: ${r.fetched} event pages read, ${r.filled} events filled in${r.blockedHosts.length ? ` (refused: ${r.blockedHosts.join(", ")})` : ""}`);
}

// ---------------------------------------------------------------- health

const health: HealthFile = { checkedAt: now, sources: only ? { ...prevHealth.sources } : {} };
for (const o of outcomes) {
  const prev = prevHealth.sources[o.source.id];
  const ok = o.status === "ok";
  const skipped = o.status === "skipped";
  const topUnmatched = Object.fromEntries(Object.entries(o.unmatchedVenues).sort((a, b) => b[1] - a[1]).slice(0, 20));
  health.sources[o.source.id] = {
    sourceId: o.source.id,
    status: o.status,
    count: o.events.length,
    previousCount: prev?.count ?? 0,
    message: o.message,
    checkedAt: now,
    lastOk: ok ? now : prev?.lastOk,
    lastOkCount: ok ? o.events.length : prev?.lastOkCount,
    configKey: ok ? cacheKey(o.source) : prev?.configKey,
    consecutiveFailures: ok || skipped ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    ...(Object.keys(topUnmatched).length ? { unmatchedVenues: topUnmatched } : {}),
    ...(o.warnings.length ? { warnings: o.warnings.slice(0, 8) } : {}),
  };
}

// ---------------------------------------------------------------- output

const bad = outcomes.filter((o) => o.status !== "ok" && o.status !== "skipped");
const skippedOnes = outcomes.filter((o) => o.status === "skipped");
const summary = [
  `## Scrape ${today}`,
  ``,
  `${events.length} current events · ${outcomes.length - bad.length - skippedOnes.length}/${outcomes.length - skippedOnes.length} sources ok · ${fetcher.requests} requests`,
  ``,
  ...(skippedOnes.length ? [`Skipped (no API key): ${skippedOnes.map((o) => o.source.id).join(", ")}`, ``] : []),
  ...(bad.length ? [`| source | status | message |`, `|---|---|---|`, ...bad.map((o) => `| ${o.source.id} | ${o.status} | ${(o.message ?? "").replace(/\|/g, "/")} |`)] : []),
].join("\n");
console.log("\n" + summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");

if (dry) {
  for (const o of outcomes) {
    console.log(`\n--- ${o.source.id} (${o.events.length})`);
    for (const e of o.events.slice(0, 25))
      console.log(`  ${e.type.padEnd(10)} ${(e.startDate ?? "…").padEnd(10)} → ${(e.endDate ?? (e.ongoing ? "ongoing" : "")).padEnd(10)} ${e.venueId.padEnd(26)} ${e.title}`);
    const um = Object.entries(o.unmatchedVenues);
    if (um.length) console.log(`  unmatched venues: ${um.map(([k, v]) => `${k} (${v})`).join(", ")}`);
    if (o.warnings.length) console.log(`  warnings: ${o.warnings.slice(0, 5).join(" | ")}`);
  }
  console.log(`\npeople: ${people.length} performers · ${elsewhere.length} dates at other venues`);
} else {
  writeJson("events.json", { generatedAt: now, events });
  // Keep only pages of current events, so the cache doesn't grow forever.
  const live = new Set(events.map((e) => e.url));
  writeJson("cache/enrich.json", Object.fromEntries(Object.entries(enrichCache).filter(([u]) => live.has(u)).sort(([a], [b]) => a.localeCompare(b))));
  writeJson("people.json", { generatedAt: now, people, elsewhere });
  writeJson("health.json", health);
}
