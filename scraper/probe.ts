// Scan venues that have no source yet, suggest an adapter config, and *test* it live.
// Only suggestions that produce ≥3 current, valid events are reported as "working".
//
//   npm run probe                       # all venues without a source
//   npm run probe -- <venueId> […]      # specific venues
//   npm run probe -- --write            # also append working configs to data/sources.json (enabled)
//
// Used for the venue backlog and for new venue requests. Blocked sites are reported, never worked around.

import type { PagesAdapterConfig, SourceConfig, Venue } from "../lib/types.ts";
import { runAdapter } from "./adapters/index.ts";
import { loadSources, loadVenues, writeJson } from "./config.ts";
import { todayLondon } from "./dates.ts";
import { discover, type Discovery } from "./discover.ts";
import { createFetcher } from "./fetcher.ts";
import { normalize } from "./normalize.ts";
import { VenueIndex } from "./venues.ts";

export interface ProbeResult {
  venueId: string;
  status: "working" | "blocked" | "no-data" | "error";
  checked: string[];
  config?: SourceConfig;
  events?: number;
  sample?: string[];
  message?: string;
}

const today = todayLondon();

function candidates(d: Discovery): PagesAdapterConfig[] {
  const url = d.finalUrl ?? d.url;
  const out: PagesAdapterConfig[] = [];
  if (d.jsonLdEvents >= 2) out.push({ type: "pages", listUrls: [url] });
  for (const c of d.cards.slice(0, 2)) out.push({ type: "pages", listUrls: [url], cards: { item: c.item, dates: c.dates } });
  return out;
}

async function tryConfig(v: Venue, cfg: PagesAdapterConfig, index: VenueIndex, fetcher: ReturnType<typeof createFetcher>) {
  const source: SourceConfig = { id: v.id, name: v.name, enabled: true, venueId: v.id, adapter: cfg };
  const res = await runAdapter(cfg, { fetcher, today, log: () => {} });
  const rep = normalize(res.events, source, index, today);
  const ok = rep.events.length >= 3 && rep.invalid.length <= rep.events.length * 0.2;
  return { ok, source, rep };
}

export async function probeVenue(v: Venue, index: VenueIndex, fetcher = createFetcher({ mode: "live", minDelayMs: 1200 })): Promise<ProbeResult> {
  const checked: string[] = [];
  let first: Discovery;
  try {
    first = await discover(v.website, fetcher);
  } catch (e) {
    return { venueId: v.id, status: "error", checked, message: (e as Error).message };
  }
  checked.push(v.website);
  if (first.status === "blocked") return { venueId: v.id, status: "blocked", checked, message: first.message };
  if (first.status === "error") return { venueId: v.id, status: "error", checked, message: first.message };

  const pages: Discovery[] = [first];
  // Then up to two likely listing pages linked from the homepage.
  const listing = first.whatsOnLinks
    .filter((u) => !/\/(news|blog|press|shop|jobs|careers|hire|support|join|membership)\b/i.test(u))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 2);
  for (const u of listing) {
    if (u === first.finalUrl) continue;
    const d = await discover(u, fetcher);
    checked.push(u);
    if (d.status === "ok") pages.unshift(d);
  }

  for (const d of pages) {
    for (const cfg of candidates(d)) {
      try {
        const t = await tryConfig(v, cfg, index, fetcher);
        if (t.ok)
          return {
            venueId: v.id,
            status: "working",
            checked,
            config: { ...t.source, notes: `Auto-configured by \`npm run probe\` on ${today}.` },
            events: t.rep.events.length,
            sample: t.rep.events.slice(0, 4).map((e) => `${e.startDate ?? "…"}→${e.endDate ?? ""} ${e.title}`),
          };
      } catch {
        /* try next */
      }
    }
  }
  return { venueId: v.id, status: "no-data", checked, message: "no listing with ≥3 current dated events found" };
}

function score(u: string): number {
  const p = new URL(u).pathname.toLowerCase();
  let s = 0;
  if (/what-?s-?on|whatson/.test(p)) s += 5;
  if (/exhibitions?/.test(p)) s += 4;
  if (/events?|programme|shows?|listings|calendar/.test(p)) s += 3;
  return s - p.split("/").filter(Boolean).length; // prefer shallow pages
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const ids = args.filter((a) => !a.startsWith("--"));
  const venues = loadVenues();
  const sources = loadSources();
  const covered = new Set(sources.map((s) => s.venueId).filter(Boolean));
  const hostOf = (u: string) => new URL(u).host.replace(/^www\./, "");
  const coveredHosts = new Set(sources.flatMap((s) => ("listUrls" in s.adapter ? s.adapter.listUrls : []).map(hostOf)));
  const index = new VenueIndex(venues);
  const todo = venues.filter((v) =>
    ids.length ? ids.includes(v.id) : !covered.has(v.id) && !v.manualOnly && !coveredHosts.has(hostOf(v.website)),
  );
  // Several venues share one website (e.g. aggregator-covered theatres) — probe each site once.
  const seenSites = new Set<string>();
  const fetcher = createFetcher({ mode: "live", minDelayMs: 1200 });
  const results: ProbeResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < todo.length) {
        const v = todo[next++];
        if (!ids.length && (seenSites.has(v.website) || v.website.includes("officiallondontheatre.com"))) continue;
        seenSites.add(v.website);
        const r = await probeVenue(v, index, fetcher);
        results.push(r);
        console.log(`${r.status === "working" ? "✓" : r.status === "blocked" ? "⛔" : "·"} ${v.id.padEnd(38)} ${r.status}${r.events ? ` (${r.events} events)` : ""}${r.message ? ` — ${r.message}` : ""}`);
        for (const s of r.sample ?? []) console.log(`     ${s}`);
      }
    }),
  );
  writeJson("../.probe-results.json", results);
  if (write) {
    const working = results.filter((r) => r.status === "working" && r.config);
    const have = new Set(sources.map((s) => s.id));
    const added = working.filter((r) => !have.has(r.config!.id)).map((r) => r.config!);
    writeJson("sources.json", [...sources, ...added]);
    console.log(`\nAdded ${added.length} sources to data/sources.json`);
  }
  const by = (s: string) => results.filter((r) => r.status === s).length;
  console.log(`\nworking ${by("working")} · blocked ${by("blocked")} · no-data ${by("no-data")} · error ${by("error")}`);
}
