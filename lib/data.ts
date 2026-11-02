// Build-time data loading. The scraper writes data/*.json; at build time scripts/build-data.ts bundles
// them into public/data/app.json, which the app loads (venue pages also get their events baked in).
// "Today" is always worked out in the browser.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Person, SourceConfig, SourceHealth, Venue, VenueKind, WOEvent } from "./types.ts";
import type { Week } from "./hours.ts";

export interface VenueLite {
  id: string;
  name: string;
  area: string;
  kind: VenueKind;
  website: string;
  /** auto = scraped · manual = site blocks us (hand-added events only) · soon = not covered yet */
  coverage: "auto" | "manual" | "soon";
  /** Weekly opening hours from OpenStreetMap (0 = Sunday); null = closed that day. */
  hours?: Week;
  hoursPartial?: boolean;
}

export interface AppData {
  generatedAt: string;
  venues: VenueLite[];
  events: WOEvent[];
}

const read = <T>(file: string, fallback: T): T => {
  const p = join(process.cwd(), "data", file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
};

let cache: AppData | null = null;

export function loadAppData(): AppData {
  if (cache) return cache;
  const venues = read<Venue[]>("venues.json", []);
  const sources = read<SourceConfig[]>("sources.json", []);
  const scraped = read<{ generatedAt: string; events: WOEvent[] }>("events.json", { generatedAt: "", events: [] });
  const manual = read<WOEvent[]>("manual-events.json", []);
  const health = read<{ sources: Record<string, SourceHealth> }>("health.json", { sources: {} });
  const hours = read<{ venues: Record<string, { week?: Week; partial?: boolean }> }>("hours.json", { venues: {} });

  const venueIds = new Set(venues.map((v) => v.id));
  const withEvents = new Set(scraped.events.map((e) => e.venueId));
  const ownSource = new Set(sources.filter((s) => s.enabled && s.venueId && health.sources[s.id]?.status !== "blocked").map((s) => s.venueId));

  const events = [...scraped.events, ...manual].filter((e) => venueIds.has(e.venueId));

  return (cache = {
    generatedAt: scraped.generatedAt,
    venues: venues
      .map((v) => ({
        id: v.id,
        name: v.name,
        area: v.area,
        kind: v.kind,
        website: v.website,
        coverage: (withEvents.has(v.id) || ownSource.has(v.id) ? "auto" : v.manualOnly ? "manual" : "soon") as VenueLite["coverage"],
        ...(hours.venues[v.id]?.week ? { hours: hours.venues[v.id].week, hoursPartial: !!hours.venues[v.id].partial } : {}),
      }))
      .sort((a, b) => a.name.replace(/^the /i, "").localeCompare(b.name.replace(/^the /i, ""))),
    events,
  });
}

/** Performers and their dates at venues we don't list — a separate file, loaded only when needed. */
export interface PeopleData {
  people: Person[];
  elsewhere: WOEvent[];
}

export function loadPeopleData(): PeopleData {
  const file = read<{ people?: Person[]; elsewhere?: WOEvent[] }>("people.json", {});
  return { people: file.people ?? [], elsewhere: file.elsewhere ?? [] };
}
