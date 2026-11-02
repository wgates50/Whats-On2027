// Record a source's live pages as a test fixture, plus the events they should produce.
//
//   npm run fixture -- <sourceId> [sourceId…]     record from the live site (network)
//   npm run fixture -- --rebaseline <id>|--all    recompute expected.json from the stored pages (no network),
//                                                 e.g. after changing classify.ts or venue aliases
//
// Fixtures are small on purpose: first listing page + up to 4 detail pages, gzipped, scripts stripped.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAdapter } from "./adapters/index.ts";
import { loadSources, loadVenues } from "./config.ts";
import { todayLondon } from "./dates.ts";
import { createFetcher } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { VenueIndex } from "./venues.ts";

export const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
export const LIMITS = { maxPages: 1, maxLinks: 4 };

export interface Expected {
  sourceId: string;
  recordedAt: string; // the "today" used for date inference/past filtering
  limits: typeof LIMITS;
  adapter: unknown; // config at record time (to spot config drift)
  rawCount?: number; // items the adapter extracted before filtering (a listing can legitimately have 0 London events)
  events: unknown[];
}

export async function produce(sourceId: string, mode: "record" | "replay", today: string, limits = LIMITS) {
  const source = loadSources().find((s) => s.id === sourceId);
  if (!source) throw new Error(`No source "${sourceId}" in data/sources.json`);
  const index = new VenueIndex(loadVenues());
  const fetcher = createFetcher({ mode, fixtureDir: join(FIXTURES, sourceId), minDelayMs: mode === "record" ? 1500 : 0 });
  const res = await runAdapter(source.adapter, { fetcher, today, log: () => {}, limits });
  return { source, rep: normalize(res.events, source, index, today), res };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const rebaseline = args.includes("--rebaseline");
  let ids = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--all")) ids = readdirSync(FIXTURES).filter((d) => existsSync(join(FIXTURES, d, "expected.json")));
  if (!ids.length) {
    console.error("usage: npm run fixture -- <sourceId>…   |   npm run fixture -- --rebaseline <sourceId>…|--all");
    process.exit(2);
  }
  let next = 0;
  const worker = async () => {
    while (next < ids.length) await one(ids[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));

  async function one(id: string) {
    const dir = join(FIXTURES, id);
    let today = todayLondon();
    if (rebaseline) {
      today = (JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected).recordedAt;
    } else {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    }
    try {
      const { source, rep, res } = await produce(id, rebaseline ? "replay" : "record", today);
      const expected: Expected = { sourceId: id, recordedAt: today, limits: LIMITS, adapter: source.adapter, rawCount: res.events.length, events: rep.events };
      writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
      console.log(`${res.events.length ? "✓" : "✗"} ${id}: ${rep.events.length} events (${res.events.length} extracted)${rebaseline ? " (rebaselined)" : " recorded"}`);
      if (!res.events.length) process.exitCode = 1;
    } catch (e) {
      console.log(`✗ ${id}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}
