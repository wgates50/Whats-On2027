// Opening hours from OpenStreetMap (via Nominatim — free, no key; ≤1 request/second, honest UA).
// First time a venue is seen, it's found by name (and checked to be within 400 m of our coordinates);
// after that it's refreshed by its OSM id in batches of 50, so a weekly run is a handful of requests.
//
//   npm run hours                    # refresh everything
//   npm run hours -- --max-age 7     # do nothing if data/hours.json is under 7 days old (CI uses this)
//   npm run hours -- <venueId>…      # (re)find specific venues
//
// Data © OpenStreetMap contributors, ODbL — credited wherever hours are shown.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Venue } from "../lib/types.ts";
import { parseOpeningHours, type Week } from "../lib/hours.ts";
import { loadVenues } from "./config.ts";
import { USER_AGENT } from "./fetcher.ts";

const FILE = new URL("../data/hours.json", import.meta.url);
const NOMINATIM = "https://nominatim.openstreetmap.org";
const VIEWBOX = "-0.55,51.75,0.35,51.25";

export interface HoursEntry {
  osm?: string; // e.g. "W24642569"
  hours?: string | null; // raw OSM opening_hours
  week?: Week;
  partial?: boolean;
  checkedAt: string; // YYYY-MM-DD
}
export interface HoursFile {
  generatedAt: string;
  attribution: string;
  venues: Record<string, HoursEntry>;
}

interface NomResult {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  extratags?: Record<string, string> | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function nominatim<T>(path: string): Promise<T> {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const r = await fetch(`${NOMINATIM}${path}`, { headers: { "user-agent": USER_AGENT, "accept-language": "en-GB" } });
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status} for ${path.split("?")[0]}`);
  return (await r.json()) as T;
}

const metres = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const osmRef = (r: NomResult) => `${r.osm_type[0].toUpperCase()}${r.osm_id}`;

function entryFrom(r: NomResult, today: string): HoursEntry {
  const raw = r.extratags?.opening_hours ?? null;
  const parsed = parseOpeningHours(raw);
  return { osm: osmRef(r), hours: raw, ...(parsed ? { week: parsed.week, partial: parsed.partial } : {}), checkedAt: today };
}

async function find(v: Venue, today: string): Promise<HoursEntry> {
  for (const q of [`${v.name}, London`, ...(v.aliases ?? []).slice(0, 2).map((a) => `${a}, London`)]) {
    const hits = await nominatim<NomResult[]>(
      `/search?format=jsonv2&limit=3&extratags=1&countrycodes=gb&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`,
    );
    const near = hits.find((h) => v.lat === undefined || metres(v.lat, v.lng!, +h.lat, +h.lon) < 400);
    if (near) return entryFrom(near, today);
  }
  return { checkedAt: today }; // not found — try again in a month
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ageArg = args.indexOf("--max-age");
  const maxAge = ageArg >= 0 ? Number(args[ageArg + 1]) : 0;
  const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--max-age");
  const today = new Date().toISOString().slice(0, 10);
  const file: HoursFile = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, "utf8"))
    : { generatedAt: "", attribution: "Opening hours © OpenStreetMap contributors (ODbL)", venues: {} };

  if (maxAge && file.generatedAt && (Date.parse(today) - Date.parse(file.generatedAt.slice(0, 10))) / 864e5 < maxAge && !only.length) {
    console.log(`hours.json is under ${maxAge} days old — skipping.`);
    process.exit(0);
  }

  const venues = loadVenues();
  const todo = only.length ? venues.filter((v) => only.includes(v.id)) : venues;
  let found = 0;
  let refreshed = 0;

  // 1) Refresh known OSM objects in batches (cheap).
  const known = todo.filter((v) => file.venues[v.id]?.osm && !only.includes(v.id));
  for (let i = 0; i < known.length; i += 50) {
    const batch = known.slice(i, i + 50);
    try {
      const res = await nominatim<NomResult[]>(`/lookup?format=jsonv2&extratags=1&osm_ids=${batch.map((v) => file.venues[v.id].osm).join(",")}`);
      const byRef = new Map(res.map((r) => [osmRef(r), r]));
      for (const v of batch) {
        const r = byRef.get(file.venues[v.id].osm!);
        if (r) {
          file.venues[v.id] = entryFrom(r, today);
          refreshed++;
        }
      }
    } catch (e) {
      console.warn(`lookup batch failed: ${(e as Error).message}`);
    }
  }

  // 2) Find venues we haven't matched yet (re-try misses monthly).
  for (const v of todo) {
    const e = file.venues[v.id];
    const stale = !e || (!e.osm && (Date.parse(today) - Date.parse(e.checkedAt)) / 864e5 >= 30) || only.includes(v.id);
    if (!stale) continue;
    try {
      file.venues[v.id] = await find(v, today);
      if (file.venues[v.id].osm) found++;
    } catch (e) {
      console.warn(`${v.id}: ${(e as Error).message}`);
    }
  }

  // Drop venues that no longer exist.
  const ids = new Set(venues.map((v) => v.id));
  for (const id of Object.keys(file.venues)) if (!ids.has(id)) delete file.venues[id];

  file.generatedAt = new Date().toISOString();
  file.venues = Object.fromEntries(Object.entries(file.venues).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(FILE, JSON.stringify(file, null, 1) + "\n");
  const withHours = Object.values(file.venues).filter((e) => e.week).length;
  console.log(`hours: ${refreshed} refreshed, ${found} newly found · ${withHours}/${venues.length} venues have opening hours`);
}
