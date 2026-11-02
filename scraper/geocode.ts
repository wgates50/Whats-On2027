// Fill in lat/lng for venues that don't have them, using OpenStreetMap Nominatim (free).
// Respects the Nominatim usage policy: ≤1 request/second, identifying User-Agent, small volumes.
//
//   npm run geocode                 # all venues missing coordinates
//   npm run geocode -- <venueId>…   # specific venues (re-geocodes even if set)

import { readFileSync, writeFileSync } from "node:fs";
import type { Venue } from "../lib/types.ts";
import { USER_AGENT } from "./fetcher.ts";

const FILE = new URL("../data/venues.json", import.meta.url);
// Greater London, roughly: lon -0.55…0.35, lat 51.25…51.75
const VIEWBOX = "-0.55,51.75,0.35,51.25";

async function search(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en-GB" } });
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
  const [hit] = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  return hit ? { lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5), label: hit.display_name } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const venues: Venue[] = JSON.parse(readFileSync(FILE, "utf8"));
const only = process.argv.slice(2);
const todo = venues.filter((v) => (only.length ? only.includes(v.id) : v.lat === undefined));
const missing: string[] = [];

for (const v of todo) {
  let hit = null;
  for (const q of [`${v.name}, London`, v.name, ...(v.aliases ?? []).map((a) => `${a}, London`)]) {
    hit = await search(q);
    await sleep(1100);
    if (hit) break;
  }
  if (hit) {
    v.lat = hit.lat;
    v.lng = hit.lng;
    console.log(`✓ ${v.id.padEnd(40)} ${hit.lat},${hit.lng}  ${hit.label.slice(0, 70)}`);
  } else {
    missing.push(v.id);
    console.log(`✗ ${v.id} — not found`);
  }
  writeFileSync(FILE, JSON.stringify(venues, null, 2) + "\n");
}
if (missing.length) console.log(`\nNot found (${missing.length}): ${missing.join(", ")}`);
