// The Royal Institution. Its what's-on page is a script that reads one JSON file the site publishes for
// it (/sites/default/files/attachments/whatson.json): the whole current programme, with start times,
// formats (in person / livestream) and who it's for. One request a day, instead of crawling the
// sitemap's 900-odd event pages (past ones included).
//
// Times in the file are UTC: evening lectures read 18:00 in summer and 19:00 in winter (both 7pm here).
// Its excerpts are cut off mid-sentence, so descriptions come from each event's own page instead (the
// scrape's details step, with the source's `enrich` selector).

import { londonDateTime, type ParsedRange } from "../../dates.ts";
import { absolute, clean, type RawEvent } from "../../extract.ts";
import type { AdapterContext, AdapterResult, CustomAdapter } from "../index.ts";

const FEED = "https://www.rigb.org/sites/default/files/attachments/whatson.json";

interface RiTerm {
  label?: string;
  name?: string;
}
export interface RiEvent {
  title?: string;
  excerpt?: string; // cut off at ~140 characters: not used
  link?: string;
  /** Who it's for: "Adults", "Families", "Children 12 and under", "Young people 13+". */
  vocabOne?: RiTerm[] | "";
  /** Format: "In-person", "Livestream". */
  vocabTwo?: RiTerm[] | "";
  /** Topics, and "Talks and shows". */
  hiddenNodeRefs?: RiTerm[] | "";
  /** The listing's teaser card (HTML), with the image. */
  content?: string;
  calculated_start_date?: string; // "2026-11-07 19:00:00" (UTC)
  calculated_end_date?: string; // "" unless it runs over several days
}

const labels = (t: RiTerm[] | "" | undefined) => (Array.isArray(t) ? t.map((x) => clean(x.label ?? x.name)).filter(Boolean) : []);

/** "2026-07-21 18:30:00" (UTC) → London date and time. */
function london(v: string | undefined): { date: string; time?: string } | null {
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  return m[2] ? londonDateTime(`${m[1]}T${m[2]}:00Z`) : { date: m[1] };
}

/** One event from the file, or null if it can't be used (no title, link or date; online only). */
export function mapRiEvent(e: RiEvent, base = FEED): RawEvent | null {
  const title = clean(e.title);
  const url = absolute(e.link, base);
  const start = london(e.calculated_start_date);
  if (!title || !url || !start) return null;
  const formats = labels(e.vocabTwo);
  if (formats.length && !formats.some((f) => /in[- ]person/i.test(f))) return null; // livestream only
  const end = london(e.calculated_end_date);
  const dates: ParsedRange =
    end && end.date > start.date ? { startDate: start.date, endDate: end.date } : { startDate: start.date, endDate: null, ...(start.time ? { startTime: start.time } : {}) };
  const who = labels(e.vocabOne);
  const family = /\(family\)/i.test(title) || (who.includes("Families") && !who.includes("Adults"));
  const talk = labels(e.hiddenNodeRefs).some((l) => /^talks\b/i.test(l));
  const img = e.content?.match(/<img[^>]+src="([^"]+)"/i)?.[1];
  return {
    url,
    title,
    dates,
    // Only labels the classifier should act on: a topic like "Art, culture and society" isn't an exhibition.
    ...(family ? { typeLabel: "Family" } : talk ? { typeLabel: "Talk" } : {}),
    ...(img ? { image: absolute(img, base) } : {}),
  };
}

const rigb: CustomAdapter = async (ctx: AdapterContext, options): Promise<AdapterResult> => {
  const url = typeof options.url === "string" ? options.url : FEED;
  const res = await ctx.fetcher.get(url);
  const body = JSON.parse(res.body) as { events?: RiEvent[] };
  if (!Array.isArray(body.events)) throw new Error("no events list in the what's-on file (has the site changed?)");
  const events = body.events.map((e) => mapRiEvent(e, res.url)).filter((e): e is RawEvent => !!e);
  return { events, warnings: [], skippedNoDates: body.events.filter((e) => !london(e.calculated_start_date)).length, linksFound: body.events.length };
};

export default rigb;
