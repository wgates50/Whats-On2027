// Skiddle Events API (free key: skiddle.com/api/join.php). Searches around central London for the
// event types we care about and matches results to our venues by name (aggregator source).
//
// Env: SKIDDLE_API_KEY. Without it the source is "skipped" (not an error).

import type { Person } from "../../../lib/types.ts";
import { addDays, londonDateTime, type ParsedRange } from "../../dates.ts";
import { clean, textToPrice, type RawEvent, type RawPerson } from "../../extract.ts";
import { MissingKeyError, type AdapterContext, type AdapterResult, type CustomAdapter } from "../index.ts";

const BASE = "https://www.skiddle.com/api/v1/events/search/";
const LIMIT = 100; // Skiddle maximum

/** Skiddle event codes → a label our classifier understands. */
const CODE_LABEL: Record<string, string> = {
  THEATRE: "Theatre",
  COMEDY: "Comedy",
  EXHIB: "Exhibition",
  ARTS: "Art",
  LIVE: "Live music",
  KIDS: "Family",
  FEST: "Festival",
  CLUB: "Club night",
};
/** …and, where Skiddle's code is unambiguous, a schema.org type (outranks title words like "UK Tour"). */
const CODE_SCHEMA: Record<string, string> = { THEATRE: "TheaterEvent", COMEDY: "ComedyEvent", LIVE: "MusicEvent", KIDS: "ChildrensEvent" };
/** What kind of act the event's artists are. */
const CODE_KIND: Record<string, Person["kind"]> = { LIVE: "music", COMEDY: "comedy", THEATRE: "theatre", KIDS: "family" };

interface SkEvent {
  id: string | number;
  eventname?: string;
  EventCode?: string;
  cancelled?: string | number | boolean;
  venue?: { name?: string; town?: string };
  link?: string;
  largeimageurl?: string;
  imageurl?: string;
  date?: string;
  startdate?: string;
  enddate?: string;
  description?: string;
  entryprice?: string;
  /** With description=1 Skiddle adds who's on (not in its docs' examples — read defensively). */
  artists?: { artistid?: string | number; name?: string }[];
  /** Music genres, e.g. [{ name: "Indie" }] (read defensively too). */
  genres?: { genreid?: string | number; name?: string }[];
}
interface SkResponse {
  error?: number | string;
  errormessage?: string;
  totalcount?: number | string;
  results?: SkEvent[];
}

export function mapSkiddleEvent(e: SkEvent): RawEvent | null {
  const title = clean(e.eventname);
  if (!title) return null;
  const s = e.startdate ? londonDateTime(e.startdate) : e.date ? { date: e.date } : null;
  if (!s) return null;
  const en = e.enddate ? londonDateTime(e.enddate) : null;
  // Skiddle end times often run past midnight; only treat it as a run if it ends on a later *day* + 1.
  const multiDay = en && en.date > s.date && (Date.parse(en.date) - Date.parse(s.date)) / 864e5 >= 2;
  const dates: ParsedRange = multiDay ? { startDate: s.date, endDate: en!.date } : { startDate: s.date, endDate: null, startTime: s.time };
  // "Comedy", "Theatre", or for gigs "Music/Indie" — hints for themes.
  const label = e.EventCode ? CODE_LABEL[e.EventCode] ?? e.EventCode : undefined;
  const named = (Array.isArray(e.genres) ? e.genres : []).map((g) => clean(g?.name)).filter(Boolean);
  const genres = named.length ? named.map((g) => `${e.EventCode === "LIVE" ? "Music" : label ?? "Other"}/${g}`) : label ? [label] : [];
  const people: RawPerson[] = (Array.isArray(e.artists) ? e.artists : [])
    .map((a) => clean(a?.name))
    .filter(Boolean)
    .map((name) => ({ name, kind: (e.EventCode && CODE_KIND[e.EventCode]) || "other", ...(named.length ? { genres } : {}) }));
  const price = e.entryprice ? (/^\s*(free|£\s*0(\.00)?)\s*$/i.test(e.entryprice) ? "free" : textToPrice(e.entryprice) ?? (/\d/.test(e.entryprice) ? "paid" : undefined)) : undefined;
  return {
    url: e.link ?? `https://www.skiddle.com/e/${e.id}`,
    title,
    dates,
    image: e.largeimageurl || e.imageurl || undefined,
    description: e.description ? clean(e.description).slice(0, 280) : undefined,
    price,
    venueName: e.venue?.name ? clean(e.venue.name) : undefined,
    typeLabel: label,
    schemaType: e.EventCode ? CODE_SCHEMA[e.EventCode] : undefined,
    cancelled: e.cancelled === true || e.cancelled === 1 || e.cancelled === "1",
    ...(people.length ? { people } : {}),
    ...(genres.length ? { genres } : {}),
  };
}

const skiddle: CustomAdapter = async (ctx: AdapterContext, options): Promise<AdapterResult> => {
  const key = process.env.SKIDDLE_API_KEY;
  if (!key) throw new MissingKeyError("SKIDDLE_API_KEY");
  const codes = (options.eventcodes as string[] | undefined) ?? ["THEATRE", "COMEDY", "EXHIB", "ARTS", "LIVE"];
  const days = (options.days as number | undefined) ?? 90;
  const maxPerCode = (options.maxPerCode as number | undefined) ?? 1000;
  const warnings: string[] = [];
  const events: RawEvent[] = [];
  const seen = new Set<string>();

  for (const code of codes) {
    for (let offset = 0; offset < maxPerCode; offset += LIMIT) {
      if (ctx.deadline && Date.now() > ctx.deadline) {
        warnings.push("time budget reached; some pages left for the next run");
        return { events, warnings, skippedNoDates: 0, linksFound: events.length };
      }
      const q = new URLSearchParams({
        api_key: key,
        latitude: "51.5074",
        longitude: "-0.1278",
        radius: "12",
        eventcode: code,
        minDate: ctx.today,
        maxDate: addDays(ctx.today, days),
        limit: String(LIMIT),
        offset: String(offset),
        description: "1",
      });
      const res = await ctx.fetcher.get(`${BASE}?${q}`, { api: true });
      const body = JSON.parse(res.body) as SkResponse;
      if (body.error && String(body.error) !== "0") throw new Error(`Skiddle API error: ${body.errormessage ?? body.error}`);
      const results = body.results ?? [];
      for (const e of results) {
        const id = String(e.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const m = mapSkiddleEvent(e);
        if (m) events.push(m);
      }
      const total = Number(body.totalcount ?? 0);
      if (!results.length || offset + LIMIT >= total) break;
    }
  }
  return { events, warnings, skippedNoDates: 0, linksFound: events.length };
};

export default skiddle;
