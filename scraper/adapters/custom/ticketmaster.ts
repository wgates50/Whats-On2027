// Ticketmaster Discovery API (free key: developer.ticketmaster.com — 5,000 calls/day, 5/second).
// Pulls London events for a few classification segments and matches them to our venues by name
// (the source is an aggregator). Each performance is a separate Ticketmaster event, so runs of the
// same show at the same venue are collapsed into one listing.
//
// Env: TICKETMASTER_API_KEY. Without it the source is "skipped" (not an error).
// Terms: Ticketmaster requires attribution and links back to their event pages — we always link
// to the Ticketmaster URL and credit them in the app.

import { addDays, type ParsedRange } from "../../dates.ts";
import { clean, type RawEvent } from "../../extract.ts";
import { spanOf } from "../pages.ts";
import { MissingKeyError, type AdapterContext, type AdapterResult, type CustomAdapter } from "../index.ts";

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;
const MAX_ITEMS = 1000; // Discovery API deep-paging limit: size * page < 1000

interface TmImage {
  url: string;
  ratio?: string;
  width?: number;
}
interface TmEvent {
  id: string;
  name: string;
  url?: string;
  test?: boolean;
  images?: TmImage[];
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string; dateTBA?: boolean; dateTBD?: boolean; noSpecificTime?: boolean };
    end?: { localDate?: string };
    status?: { code?: string };
  };
  classifications?: { primary?: boolean; segment?: { name?: string }; genre?: { name?: string } }[];
  priceRanges?: { min?: number; max?: number }[];
  info?: string;
  _embedded?: { venues?: { name?: string; city?: { name?: string } }[] };
}
interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { size: number; totalElements: number; totalPages: number; number: number };
}

const isoZ = (day: string) => `${day}T00:00:00Z`;

function bestImage(images: TmImage[] = []): string | undefined {
  const wide = images.filter((i) => i.ratio === "16_9" && (i.width ?? 0) <= 1200).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (wide[0] ?? images[0])?.url;
}

export function mapTmEvent(e: TmEvent): RawEvent | null {
  if (e.test) return null;
  const status = e.dates?.status?.code;
  if (status === "postponed") return null; // no date to show
  const start = e.dates?.start;
  if (!start?.localDate || start.dateTBA || start.dateTBD) return null;
  const venue = e._embedded?.venues?.[0];
  const time = start.localTime && !start.noSpecificTime ? start.localTime.slice(0, 5) : undefined;
  const end = e.dates?.end?.localDate;
  const dates: ParsedRange = end && end > start.localDate ? { startDate: start.localDate, endDate: end } : { startDate: start.localDate, endDate: null, startTime: time };
  const c = e.classifications?.find((x) => x.primary) ?? e.classifications?.[0];
  const label = [c?.segment?.name, c?.genre?.name].filter((x) => x && x !== "Undefined").join(" ");
  const prices = (e.priceRanges ?? []).flatMap((p) => [p.min, p.max]).filter((x): x is number => typeof x === "number");
  return {
    url: e.url ?? `https://www.ticketmaster.co.uk/event/${e.id}`,
    title: clean(e.name),
    dates,
    image: bestImage(e.images),
    description: e.info ? clean(e.info).slice(0, 280) : undefined,
    price: prices.length ? (Math.max(...prices) === 0 ? "free" : "paid") : undefined,
    venueName: venue?.name ? clean(venue.name) : undefined,
    typeLabel: label || undefined,
    cancelled: status === "canceled",
  };
}

/** One listing per show per venue: many performances → one run from first to last date. */
export function collapseRuns(events: RawEvent[]): RawEvent[] {
  const groups = new Map<string, RawEvent[]>();
  for (const e of events) {
    const k = `${(e.venueName ?? "").toLowerCase()}|${e.title.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: RawEvent[] = [];
  for (const g of groups.values()) {
    const live = g.filter((e) => !e.cancelled);
    if (!live.length) {
      out.push(g[0]); // all cancelled → let normalize drop it as cancelled
      continue;
    }
    const sorted = [...live].sort((a, b) => (a.dates.startDate ?? "").localeCompare(b.dates.startDate ?? ""));
    out.push(sorted.length === 1 ? sorted[0] : { ...sorted[0], dates: spanOf(sorted.map((e) => e.dates)) });
  }
  return out;
}

const ticketmaster: CustomAdapter = async (ctx: AdapterContext, options): Promise<AdapterResult> => {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new MissingKeyError("TICKETMASTER_API_KEY");
  const segments = (options.segments as string[] | undefined) ?? ["Arts & Theatre", "Music", "Miscellaneous"];
  const days = (options.days as number | undefined) ?? 120;
  const windowDays = (options.windowDays as number | undefined) ?? 30;
  const warnings: string[] = [];
  const raw: RawEvent[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (let from = 0; from < days; from += windowDays) {
      const start = addDays(ctx.today, from);
      const end = addDays(ctx.today, Math.min(from + windowDays, days));
      for (let page = 0; page * PAGE_SIZE < MAX_ITEMS; page++) {
        if (ctx.deadline && Date.now() > ctx.deadline) {
          warnings.push("time budget reached; some pages left for the next run");
          return { events: collapseRuns(raw), warnings, skippedNoDates: 0, linksFound: raw.length };
        }
        const q = new URLSearchParams({
          apikey: key,
          countryCode: "GB",
          city: "London",
          classificationName: segment,
          startDateTime: isoZ(start),
          endDateTime: isoZ(end),
          size: String(PAGE_SIZE),
          page: String(page),
          sort: "date,asc",
          locale: "*",
        });
        const res = await ctx.fetcher.get(`${BASE}?${q}`, { api: true });
        const body = JSON.parse(res.body) as TmResponse;
        for (const e of body._embedded?.events ?? []) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          const m = mapTmEvent(e);
          if (m) raw.push(m);
        }
        const p = body.page;
        if (!p || p.number + 1 >= p.totalPages) break;
        if ((page + 1) * PAGE_SIZE >= MAX_ITEMS) warnings.push(`${segment} ${start}…${end}: over ${MAX_ITEMS} results; narrow the window`);
      }
    }
  }
  return { events: collapseRuns(raw), warnings, skippedNoDates: 0, linksFound: raw.length };
};

export default ticketmaster;
