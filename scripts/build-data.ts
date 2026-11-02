// prebuild: bundle data/*.json into one compact file the app loads (and the service worker caches).
import { mkdirSync, writeFileSync } from "node:fs";
import { loadAppData, loadPeopleData } from "../lib/data.ts";

const data = loadAppData();
const json = JSON.stringify(data);
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/app.json", json);
console.log(`public/data/app.json: ${data.events.length} events, ${data.venues.length} venues, ${(json.length / 1024).toFixed(0)} KB`);

// Performers: loaded by the app only on people pages or when you follow someone.
const people = loadPeopleData();
const venueIds = new Set(data.venues.map((v) => v.id));
const named = new Set(data.events.flatMap((e) => e.people ?? []));
for (const e of people.elsewhere) for (const p of e.people ?? []) named.add(p);
const slim = {
  people: people.people.filter((p) => named.has(p.id)).map(({ tm: _tm, ...p }) => p),
  // Dates elsewhere skip the description and image (a quarter of the file); the venue is named, not linked.
  elsewhere: people.elsewhere.filter((e) => !venueIds.has(e.venueId)).map(({ description: _d, image: _i, ...e }) => e),
};
const pjson = JSON.stringify(slim);
writeFileSync("public/data/people.json", pjson);
console.log(`public/data/people.json: ${slim.people.length} people, ${slim.elsewhere.length} dates elsewhere, ${(pjson.length / 1024).toFixed(0)} KB`);
