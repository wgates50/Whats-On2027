// Ticketmaster Discovery API (free key: developer.ticketmaster.com — 5,000 calls/day, 5/second).
// Pulls London events for a few classification segments and matches them to our venues by name
// (the source is an aggregator). Each performance is a separate Ticketmaster event, so runs of the
// same show at the same venue are collapsed into one listing.
//
// Env: TICKETMASTER_API_KEY. Without it the source is "skipped" (not an error).
// Terms: Ticketmaster requires attribution and links back to their event pages — we always link
// to the Ticketmaster URL and credit them in the app.

import { SCHEDULE_DIGITS, type OnSale, type Person, type Schedule } from "../../../lib/types.ts";
import { addDays, type ParsedRange } from "../../dates.ts";
import { clean, type RawEvent, type RawPerson } from "../../extract.ts";
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
interface TmClassification {
  primary?: boolean;
  segment?: { name?: string };
  genre?: { name?: string };
  subGenre?: { name?: string };
  type?: { name?: string };
  subType?: { name?: string };
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
  classifications?: TmClassification[];
  priceRanges?: { min?: number; max?: number }[];
  info?: string;
  sales?: {
    public?: { startDateTime?: string; startTBD?: boolean; startTBA?: boolean };
    presales?: { name?: string; startDateTime?: string; endDateTime?: string }[];
  };
  _embedded?: { venues?: { name?: string; city?: { name?: string } }[]; attractions?: TmAttraction[] };
}
interface TmAttraction {
  id?: string;
  name?: string;
  classifications?: TmClassification[];
  externalLinks?: Record<string, { url?: string }[] | undefined>;
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

/**
 * Things Ticketmaster sells that aren't events: VIP and hospitality add-ons, upgrades with "no ticket
 * included", gift-card redemptions, parking, hotel packages, and day admission to attractions
 * ("London Eye - Standard Experience", "Tower of London - Standard All Day Entry").
 */
const NOT_AN_EVENT =
  /\b(vip|premium|platinum|hospitality)\b.*\b(packages?|upgrades?|experiences?|tickets?)\b|\bupgrades? only\b|\bno (event )?tickets? included\b|\bgift ?cards?\b|\bvouchers?\b|\bhotel (packages?|experiences?|stays?)\b|\bparking\b|\bstandard (all day )?(entry|admission|experience)\b/i;
/** Classification types/sub-types for the same: "Upsell", "Nonticket", "Sightseeing/Facility". */
const NOT_AN_EVENT_CLASS = /^(upsell|nonticket)$|sightseeing/i;
/** "Rizzle Kicks ** MOVED TO O2 ACADEMY BRIXTON" — it's listed again at the new venue. */
const MOVED = /\b(moved|relocated) to\b/i;

/**
 * Ticketmaster's own classification → the schema.org type our classifier trusts most. It outranks
 * title words, so a band's "… World Tour" stays a concert instead of becoming a guided tour.
 */
function schemaFor(c?: TmClassification): string | undefined {
  const segment = c?.segment?.name ?? "";
  const genre = c?.genre?.name ?? "";
  if (/lecture|seminar/i.test(c?.subType?.name ?? "")) return "LiteraryEvent";
  if (segment === "Music" || /classical/i.test(genre)) return "MusicEvent";
  if (segment === "Film") return "ScreeningEvent";
  if (/comedy/i.test(genre)) return "ComedyEvent";
  if (/children/i.test(genre)) return "ChildrensEvent";
  if (/dance/i.test(genre)) return "DanceEvent";
  if ((segment === "Arts & Theatre" && !/fine art|spoken word|undefined/i.test(genre || "undefined")) || /ice shows/i.test(genre)) return "TheaterEvent";
  return undefined;
}

/** What sort of act a performer is, from their own (or the event's) classification. */
function kindOf(c?: TmClassification): Person["kind"] {
  const segment = c?.segment?.name ?? "";
  const genre = c?.genre?.name ?? "";
  if (/lecture|seminar/i.test(c?.subType?.name ?? "") || /spoken word/i.test(genre)) return "talk";
  if (segment === "Music" || /classical|opera/i.test(genre)) return "music";
  if (/comedy/i.test(genre)) return "comedy";
  if (/children|family/i.test(genre)) return "family";
  if (/dance/i.test(genre)) return "dance";
  if (segment === "Arts & Theatre") return "theatre";
  return "other";
}

const LINK_KINDS = ["homepage", "spotify", "instagram", "wiki", "youtube"] as const;

function personOf(a: TmAttraction, eventClass?: TmClassification): RawPerson | null {
  const name = clean(a.name);
  if (!name || NOT_AN_EVENT.test(name)) return null;
  const links: NonNullable<RawPerson["links"]> = {};
  for (const k of LINK_KINDS) {
    const url = a.externalLinks?.[k]?.[0]?.url;
    if (url && /^https?:\/\//.test(url)) links[k] = url;
  }
  const c = a.classifications?.find((x) => x.primary) ?? a.classifications?.[0];
  return { name, kind: kindOf(c?.segment?.name && c.segment.name !== "Undefined" ? c : eventClass), ...(Object.keys(links).length ? { links } : {}), ...(a.id ? { tmId: a.id } : {}) };
}

function onSaleOf(e: TmEvent): OnSale | undefined {
  const pub = e.sales?.public;
  if (!pub?.startDateTime || pub.startTBD || pub.startTBA) return undefined;
  const presales = (e.sales?.presales ?? [])
    .filter((p) => p.name && p.startDateTime && p.startDateTime < pub.startDateTime!)
    .sort((a, b) => a.startDateTime!.localeCompare(b.startDateTime!))
    .slice(0, 3)
    .map((p) => ({ name: clean(p.name), start: p.startDateTime! }));
  return { start: pub.startDateTime, ...(presales.length ? { presales } : {}) };
}

export function mapTmEvent(e: TmEvent): RawEvent | null {
  if (e.test) return null;
  const status = e.dates?.status?.code;
  if (status === "postponed") return null; // no date to show
  const start = e.dates?.start;
  if (!start?.localDate || start.dateTBA || start.dateTBD) return null;
  const c = e.classifications?.find((x) => x.primary) ?? e.classifications?.[0];
  if (NOT_AN_EVENT.test(e.name) || NOT_AN_EVENT_CLASS.test(c?.type?.name ?? "") || NOT_AN_EVENT_CLASS.test(c?.subType?.name ?? "")) return null;
  const venue = e._embedded?.venues?.[0];
  const time = start.localTime && !start.noSpecificTime ? start.localTime.slice(0, 5) : undefined;
  const end = e.dates?.end?.localDate;
  const dates: ParsedRange = end && end > start.localDate ? { startDate: start.localDate, endDate: end } : { startDate: start.localDate, endDate: null, startTime: time };
  const exhibit = /exhibit|museum/i.test(c?.subType?.name ?? ""); // immersive shows, Frameless, Lightroom
  const label = exhibit ? "Exhibition" : [c?.segment?.name, c?.genre?.name].filter((x) => x && x !== "Undefined").join(" ");
  const prices = (e.priceRanges ?? []).flatMap((p) => [p.min, p.max]).filter((x): x is number => typeof x === "number");
  const onSale = onSaleOf(e);
  const people = (e._embedded?.attractions ?? []).map((a) => personOf(a, c)).filter((p): p is RawPerson => !!p);
  return {
    url: e.url ?? `https://www.ticketmaster.co.uk/event/${e.id}`,
    title: clean(e.name),
    dates,
    image: bestImage(e.images),
    description: e.info ? clean(e.info).slice(0, 280) : undefined,
    price: prices.length ? (Math.max(...prices) === 0 ? "free" : "paid") : undefined,
    venueName: venue?.name ? clean(venue.name) : undefined,
    typeLabel: label || undefined,
    schemaType: exhibit ? undefined : schemaFor(c),
    cancelled: status === "canceled" || MOVED.test(e.name),
    ...(onSale ? { onSale } : {}),
    ...(people.length ? { people } : {}),
  };
}

const dayIndex = (from: string, day: string) => Math.round((Date.parse(day) - Date.parse(from)) / 864e5);

/**
 * Which days of a run have performances, and at what times (see Schedule in lib/types.ts). Only for
 * runs longer than a few days — shorter ones are one-offs in the app and show their own time.
 */
export function scheduleOf(perfs: RawEvent[]): Schedule | undefined {
  const dated = perfs.filter((p) => p.dates.startDate && !p.dates.endDate);
  const days = dated.map((p) => p.dates.startDate!).sort();
  if (dated.length < 2 || dayIndex(days[0], days[days.length - 1]) < 4) return undefined;
  const freq = new Map<string, number>();
  for (const p of dated) if (p.dates.startTime) freq.set(p.dates.startTime, (freq.get(p.dates.startTime) ?? 0) + 1);
  // Up to 6 distinct times fit the encoding; otherwise (or if some times are missing) record just
  // which days have a performance.
  const times = freq.size <= 6 && dated.every((p) => p.dates.startTime) ? [...freq.keys()].sort() : [];
  const masks = new Array<number>(dayIndex(days[0], days[days.length - 1]) + 1).fill(0);
  for (const p of dated) masks[dayIndex(days[0], p.dates.startDate!)] |= times.length ? 1 << times.indexOf(p.dates.startTime!) : 1;
  return { from: days[0], times, days: masks.map((m) => SCHEDULE_DIGITS[m]).join("") };
}

/** A run is "on sale soon" only if none of its performances is on sale yet. */
function runOnSale(perfs: RawEvent[], now: string): OnSale | undefined {
  if (perfs.some((p) => !p.onSale || p.onSale.start <= now)) return undefined;
  return [...perfs].sort((a, b) => a.onSale!.start.localeCompare(b.onSale!.start))[0].onSale;
}

function peopleOf(perfs: RawEvent[]): RawPerson[] | undefined {
  const byName = new Map<string, RawPerson>();
  for (const p of perfs) for (const x of p.people ?? []) if (!byName.has(x.name.toLowerCase())) byName.set(x.name.toLowerCase(), x);
  return byName.size ? [...byName.values()] : undefined;
}

/** Same show, different listing: "FRAMELESS" / "FRAMELESS 2026", "… STANDARD" / "… PEAK" tickets. */
const runKey = (e: RawEvent) =>
  `${(e.venueName ?? "").toLowerCase()}|${e.title
    .toLowerCase()
    .replace(/\s*[-–:|(]?\s*\b(standard|peak|off[- ]peak)\)?\s*$/, "")
    .replace(/\s*[-–:|(]?\s*\b20\d\d\)?\s*$/, "")
    .trim()}`;

/**
 * One listing per show per venue: many performances → one run from first to last date, with its
 * performance schedule, its performers, and its on-sale date if no performance is on sale yet.
 * `now` (ISO) decides what "on sale" means.
 */
export function collapseRuns(events: RawEvent[], now = new Date().toISOString()): RawEvent[] {
  const groups = new Map<string, RawEvent[]>();
  for (const e of events) {
    const k = runKey(e);
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
    const { onSale: _o, people: _p, ...first } = sorted[0];
    const run: RawEvent = sorted.length === 1 ? first : { ...first, dates: spanOf(sorted.map((e) => e.dates)) };
    const schedule = scheduleOf(sorted);
    const onSale = runOnSale(sorted, now);
    const people = peopleOf(sorted);
    out.push({ ...run, ...(schedule ? { schedule } : {}), ...(onSale ? { onSale } : {}), ...(people ? { people } : {}) });
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
  let outOfTime = false;

  const fetchPage = async (segment: string, start: string, end: string, page: number) => {
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
    return body.page;
  };

  // Every event in [start, end). The API stops at the 1,000th result, and a month of London theatre
  // is several thousand performances, so a window that's too busy (judged from its first page) is
  // split into smaller ones until each fits. One-day windows can't split further.
  const fetchWindow = async (segment: string, start: string, end: string): Promise<void> => {
    for (let page = 0; page * PAGE_SIZE < MAX_ITEMS; page++) {
      if (ctx.deadline && Date.now() > ctx.deadline) {
        outOfTime = true;
        return;
      }
      const p = await fetchPage(segment, start, end, page);
      if (!p) return;
      const span = Math.round((Date.parse(end) - Date.parse(start)) / 864e5);
      if (page === 0 && p.totalElements > MAX_ITEMS && span > 1) {
        const step = Math.max(1, Math.floor(span / Math.ceil(p.totalElements / (MAX_ITEMS * 0.8))));
        for (let d = 0; d < span && !outOfTime; d += step) await fetchWindow(segment, addDays(start, d), addDays(start, Math.min(d + step, span)));
        return;
      }
      if (p.number + 1 >= p.totalPages) return;
      if ((page + 1) * PAGE_SIZE >= MAX_ITEMS) warnings.push(`${segment} ${start}: over ${MAX_ITEMS} events in one day; the rest were left out`);
    }
  };

  for (const segment of segments)
    for (let from = 0; from < days && !outOfTime; from += windowDays)
      await fetchWindow(segment, addDays(ctx.today, from), addDays(ctx.today, Math.min(from + windowDays, days)));
  if (outOfTime) warnings.push("time budget reached; some pages left for the next run");
  return { events: collapseRuns(raw), warnings, skippedNoDates: 0, linksFound: raw.length };
};

export default ticketmaster;
