// Daily scrape: run every enabled source, normalise, merge, health-check, write data/*.json.
//
//   npm run scrape                       # everything (what the GitHub Action runs)
//   npm run scrape -- --only tate-modern,vam   # just these sources (others' data is kept)
//   npm run scrape -- --only vam --dry   # print results, write nothing
//
// Never exits non-zero because a venue broke — that's what health.json + issues are for.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HealthStatus, SourceConfig, WOEvent } from "../lib/types.ts";
import { runAdapter, type CachedDetail, type DetailCache } from "./adapters/index.ts";
import { loadEvents, loadHealth, loadSources, loadVenues, writeJson, type HealthFile } from "./config.ts";
import { todayLondon } from "./dates.ts";
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
  const base = { source, events: [] as WOEvent[], warnings: [] as string[], unmatchedVenues: {} };
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
    const prev = prevHealth.sources[source.id];
    const baseline = prev?.lastOkCount ?? 0;
    const considered = rep.events.length + rep.invalid.length;
    let status: HealthStatus = "ok";
    let message: string | undefined;
    if (rep.invalid.length && rep.invalid.length >= considered * 0.5) {
      status = "invalid";
      message = `${rep.invalid.length} of ${considered} events failed validation, e.g. ${rep.invalid.slice(0, 3).join("; ")}`;
    } else if (res.linksFound >= 4 && res.skippedNoDates >= res.linksFound * 0.5) {
      status = "invalid";
      message = `${res.skippedNoDates} of ${res.linksFound} detail pages had no parseable dates — date selector probably broken`;
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
    return { ...base, status, message, events: rep.events, warnings: res.warnings, unmatchedVenues: rep.unmatchedVenues, ms: Date.now() - t0 };
  } catch (e) {
    if (cache && !dry && cache.size) saveCache(source, cache); // keep partial progress
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
  console.log(`${o.status === "ok" ? "✓" : "✗"} ${s.id.padEnd(34)} ${o.status.padEnd(8)} ${String(o.events.length).padStart(4)} events  ${(o.ms / 1000).toFixed(0)}s${o.message ? `  — ${o.message}` : ""}`);
  return o;
});

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
    merged.push(...prevEvents.filter((e) => e.sourceId === o.source.id && !have.has(e.id) && isCurrent(e)));
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
for (const e of merged) {
  const k = keyOf(e);
  if (byKey.has(k)) continue;
  const kept = byVenue.get(e.venueId) ?? [];
  // Only across sources: one site's own "Tour" and "BSL Tour" are separate events.
  if (kept.some((x) => x.sourceId !== e.sourceId && sameThing(x, e))) continue;
  const firstSeen = [e.firstSeen, prevById.get(e.id)?.firstSeen, prevByKey.get(k)?.firstSeen].filter(Boolean).sort()[0]!;
  const ev = { ...e, firstSeen };
  byKey.set(k, ev);
  byVenue.set(e.venueId, [...kept, ev]);
}
const events = [...byKey.values()].sort(
  (a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.venueId.localeCompare(b.venueId) || a.title.localeCompare(b.title),
);

// ---------------------------------------------------------------- health

const health: HealthFile = { checkedAt: now, sources: only ? { ...prevHealth.sources } : {} };
for (const o of outcomes) {
  const prev = prevHealth.sources[o.source.id];
  const ok = o.status === "ok";
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
    consecutiveFailures: ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    ...(Object.keys(topUnmatched).length ? { unmatchedVenues: topUnmatched } : {}),
    ...(o.warnings.length ? { warnings: o.warnings.slice(0, 8) } : {}),
  };
}

// ---------------------------------------------------------------- output

const bad = outcomes.filter((o) => o.status !== "ok");
const summary = [
  `## Scrape ${today}`,
  ``,
  `${events.length} current events · ${outcomes.length - bad.length}/${outcomes.length} sources ok · ${fetcher.requests} requests`,
  ``,
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
} else {
  writeJson("events.json", { generatedAt: now, events });
  writeJson("health.json", health);
}
