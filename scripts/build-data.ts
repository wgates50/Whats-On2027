// prebuild: bundle data/*.json into one compact file the app loads (and the service worker caches).
import { mkdirSync, writeFileSync } from "node:fs";
import { loadAppData } from "../lib/data.ts";

const data = loadAppData();
const json = JSON.stringify(data);
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/app.json", json);
console.log(`public/data/app.json: ${data.events.length} events, ${data.venues.length} venues, ${(json.length / 1024).toFixed(0)} KB`);
