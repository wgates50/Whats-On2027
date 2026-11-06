// RawEvent (adapter output) → WOEvent (what the app reads). Pure and deterministic given `today`,
// so fixture tests can replay it exactly.

import type { Person, SourceConfig, VenueKind, WOEvent } from "../lib/types.ts";
import { addDays, parseDateRange } from "./dates.ts";
import type { RawEvent } from "./extract.ts";
import { categoryFor, classifyType, notAnEvent } from "./classify.ts";
import type { VenueIndex } from "./venues.ts";

export interface NormalizeReport {
  events: WOEvent[];
  past: number; // already finished — dropped, not an error
  invalid: string[]; // failed validation — counts against health
  unmatchedVenues: Record<string, number>; // aggregator venue names we don't know
  filtered: number; // removed by include/exclude, or not an event to go to (courses, schools, online)
  cancelled: number;
  /** Events at venues we don't list, kept only because they name performers (venueId ""). */
  elsewhere: WOEvent[];
  /** Performers named by this source's events, by id. */
  people: Record<string, Person>;
}

/** A performer's id: the slug of their name (so the same act from two APIs is one person). */
export const personId = (name: string) => slugify(name, 60);

export function slugify(s: string, max = 80): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

function urlSlug(u: string): string {
  try {
    const x = new URL(u);
    const segs = x.pathname.split("/").filter(Boolean);
    // Last two path segments are usually distinctive ("tate-modern/monet"); keep a query id if any.
    return slugify([...segs.slice(-2), x.search.replace(/^\?/, "")].filter(Boolean).join("-"));
  } catch {
    return slugify(u);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CANCELLED = /\b(cancelled|canceled|postponed)\b|\b(online )?live ?stream\b|\(online\)|\bon[- ]demand\b/i;

/** "Mon 2 Nov 2026" as a title means the card's title selector is pointing at the date. */
function looksLikeDate(title: string, today: string): boolean {
  if (title.length > 40) return false;
  const stripped = title.replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|[\d\s,.:–—\-/]|\b(st|nd|rd|th|am|pm)\b/gi, "");
  const monthsOnly = stripped.replace(/january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec/gi, "");
  return monthsOnly.trim() === "" && parseDateRange(title, today) !== null;
}

export function normalize(raws: RawEvent[], source: SourceConfig, venues: VenueIndex, today: string): NormalizeReport {
  const report: NormalizeReport = { events: [], past: 0, invalid: [], unmatchedVenues: {}, filtered: 0, cancelled: 0, elsewhere: [], people: {} };
  const include = source.include ? new RegExp(source.include, "i") : null;
  const exclude = source.exclude ? new RegExp(source.exclude, "i") : null;
  const venueFilter = source.venueFilter ? new RegExp(source.venueFilter, "i") : null;
  const unmatchedReport = source.unmatchedReport ? new RegExp(source.unmatchedReport, "i") : null;
  const urlCounts = new Map<string, number>();
  for (const r of raws) urlCounts.set(r.url, (urlCounts.get(r.url) ?? 0) + 1);
  const horizon = addDays(today, 365 * 3);
  const seen = new Set<string>();

  for (const raw of raws) {
    // Tidy titles: drop "read more" arrows and the like that some cards append.
    const r = { ...raw, title: raw.title.replace(/\s*[→›»↗➔+]+\s*$/u, "").trim() };
    if (r.cancelled || CANCELLED.test(r.title)) {
      report.cancelled++;
      continue;
    }
    if (r.title.length < 2 || looksLikeDate(r.title, today)) {
      report.invalid.push(`title looks like a date, not a name: "${r.title}"`);
      continue;
    }
    const hay = `${r.title} ${r.url}`;
    if ((include && !include.test(hay)) || (exclude && exclude.test(hay)) || notAnEvent(r)) {
      report.filtered++;
      continue;
    }
    if (venueFilter && !(r.venueName && venueFilter.test(r.venueName))) {
      report.filtered++;
      continue;
    }
    const venueId = source.venueId ?? venues.match(r.venueName);
    // An unknown venue is still worth keeping when the event names performers: it shows on their pages
    // and to people who follow them. It never counts towards the source's health.
    const elsewhere = !venueId;
    let venueKind: VenueKind = "live-venue";
    if (!venueId) {
      const k = r.venueName ?? "(no venue given)";
      if (!unmatchedReport || unmatchedReport.test(k)) report.unmatchedVenues[k] = (report.unmatchedVenues[k] ?? 0) + 1;
      if (!r.people?.length) continue;
    } else {
      const venue = venues.get(venueId);
      if (!venue) {
        report.invalid.push(`${r.title}: unknown venueId ${venueId}`);
        continue;
      }
      venueKind = venue.kind;
    }

    const { startDate, endDate, ongoing, startTime } = r.dates;
    const problem =
      (startDate && !ISO.test(startDate)) || (endDate && !ISO.test(endDate)) || (startDate && endDate && endDate < startDate)
        ? `${r.title}: bad dates ${startDate}…${endDate}`
        : !startDate && !endDate && !ongoing
          ? `${r.title}: no dates`
          : (startDate && startDate > horizon) || (endDate && endDate > horizon)
            ? `${r.title}: implausible date ${startDate}…${endDate}`
            : null;
    if (problem) {
      if (!elsewhere) report.invalid.push(problem);
      continue;
    }
    const lastDay = endDate ?? (ongoing ? null : startDate);
    if (lastDay && lastDay < today) {
      if (!elsewhere) report.past++;
      continue;
    }

    // Already open with only an end date ("Until 10 Jan") or open-ended → treat as a long run.
    const spanDays = startDate && endDate ? (Date.parse(endDate) - Date.parse(startDate)) / 864e5 : ongoing || endDate ? 999 : undefined;
    const oneOff = !!startDate && !ongoing && (!endDate || (spanDays ?? 0) <= 3);
    const type = classifyType({
      url: r.url,
      title: r.title,
      typeLabel: r.typeLabel,
      schemaType: r.schemaType,
      sourceDefault: source.defaults?.type,
      venueKind,
      spanDays,
      oneOff,
    });
    const category = source.defaults?.category ?? categoryFor(type, venueKind);
    const shared = (urlCounts.get(r.url) ?? 0) > 1;
    const prefix = venueId ?? `~${slugify(r.venueName ?? "elsewhere", 40)}`;
    let id = `${prefix}:${shared ? slugify(`${r.title}-${startDate ?? endDate ?? ""}`) : urlSlug(r.url)}`;
    for (let n = 2; seen.has(id); n++) id = `${id.replace(/~\d+$/, "")}~${n}`;
    seen.add(id);

    const ev: WOEvent = {
      id,
      venueId: venueId ?? "",
      sourceId: source.id,
      title: r.title,
      url: r.url,
      type,
      category,
      startDate,
      endDate,
      firstSeen: today,
    };
    if (ongoing) ev.ongoing = true;
    if (startTime) ev.startTime = startTime;
    if (r.image) ev.image = r.image;
    if (r.description) ev.description = r.description;
    if (r.price) ev.price = r.price;
    if (r.schedule) ev.schedule = r.schedule;
    if (r.onSale) ev.onSale = r.onSale;
    const people = addPeople(report.people, r.people);
    if (people.length) ev.people = people;
    if (elsewhere) report.elsewhere.push({ ...ev, ...(r.venueName ? { venueName: r.venueName } : {}) });
    else report.events.push(ev);
  }
  return report;
}

/** Record performers (merging what two listings say about the same one); returns their ids. */
function addPeople(into: Record<string, Person>, raw: RawEvent["people"]): string[] {
  const ids: string[] = [];
  for (const p of raw ?? []) {
    const id = personId(p.name);
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    const had = into[id];
    const tm = [...new Set([...(had?.tm ?? []), ...(p.tmId ? [p.tmId] : [])])];
    const links = { ...p.links, ...had?.links };
    into[id] = {
      id,
      name: had?.name ?? p.name,
      kind: had && had.kind !== "other" ? had.kind : (p.kind ?? "other"),
      ...(Object.keys(links).length ? { links } : {}),
      ...(tm.length ? { tm } : {}),
    };
  }
  return ids;
}
