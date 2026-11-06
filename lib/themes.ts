// Themes: a fixed list (data/themes.json) that venues, events and people are tagged with, so Discover can
// learn what you like from what you follow and save. Tags come from two places:
//
//  • data/tags.json — assigned by the daily Claude maintenance task (MAINTAINING.md), which reads each
//    new venue, event and performer and picks themes from the list. These always win.
//  • rules here, a first guess until something has been tagged: the ticketing APIs' genres, the event's
//    type, words in its title, and — for events nothing else says much about — the venue's own themes.
//
// Nothing here calls an AI: tags.json is plain data, and the app and its build only read it.

import type { EventType, Person, TagsFile, Theme, ThemeGroup, Venue, VenueKind, WOEvent } from "./types.ts";

/** At most this many themes per thing (the most telling first). */
export const MAX_THEMES = 4;

export const EMPTY_TAGS: TagsFile = { venues: {}, events: {}, people: {} };

/** Themes that are a format rather than a subject — on their own they say little about taste. */
const FORMAT = new Set(["talks", "film", "family", "lates", "workshops", "tours", "outdoors"]);

/** An event type that is itself a format. */
const TYPE_THEME: Partial<Record<EventType, string>> = { talk: "talks", screening: "film", family: "family", late: "lates", workshop: "workshops", tour: "tours" };

/** Which of a venue's themes can carry over to an event of this type. */
const TYPE_GROUPS: Partial<Record<EventType, ThemeGroup[]>> = {
  exhibition: ["art", "ideas", "more"],
  display: ["art", "ideas", "more"],
  show: ["stage", "more"],
  concert: ["music"],
  talk: ["ideas", "more"],
  screening: ["screen"],
};

/** A first guess at an untagged venue's themes, from its kind. */
const KIND_THEMES: Partial<Record<VenueKind, string[]>> = {
  "commercial-gallery": ["contemporary-art"],
  "comedy-club": ["comedy"],
  "talks-venue": ["talks"],
  garden: ["nature", "outdoors"],
  theatre: ["plays"],
};

/** …and at an untagged performer's, from what kind of act they are (not "theatre": those are productions). */
const PERSON_KIND_THEMES: Partial<Record<Person["kind"], string[]>> = { comedy: ["comedy"], talk: ["talks"], dance: ["dance"] };

/** Acts you could follow (musicians, comedians, speakers, dancers) — not productions or line-up nights. */
const ACT_KINDS = new Set<Person["kind"]>(["music", "comedy", "talk", "dance"]);
/** Ticketmaster also lists club nights, line-up shows and tributes as "attractions". */
const NOT_AN_ACT =
  /\b(comedy|stand[- ]?up (show|night)|best in stand[- ]?up|open mic|showcase|presents|live at|club|night|carnival|tribute|the musical|experience|festival|awards?)\b/i;
export const isAct = (p: Pick<Person, "kind" | "name">) => ACT_KINDS.has(p.kind) && !NOT_AN_ACT.test(p.name);

export interface Themes {
  list: Theme[];
  byId: Map<string, Theme>;
  match: [Theme, RegExp][];
  genres: [Theme, RegExp][];
}

export function compileThemes(list: Theme[]): Themes {
  return {
    list,
    byId: new Map(list.map((t) => [t.id, t])),
    match: list.filter((t) => t.match).map((t) => [t, new RegExp(t.match!, "i")]),
    genres: list.filter((t) => t.genres).map((t) => [t, new RegExp(t.genres!, "i")]),
  };
}

const uniq = (ids: string[]) => [...new Set(ids)];

/** Themes the ticketing APIs' genres point to. */
export function genreThemes(genres: string[] | undefined, t: Themes): string[] {
  if (!genres?.length) return [];
  return uniq(genres.flatMap((g) => t.genres.filter(([, re]) => re.test(g)).map(([th]) => th.id)));
}

export function venueThemes(v: Pick<Venue, "id" | "kind">, tags: TagsFile): string[] {
  return tags.venues[v.id] ?? KIND_THEMES[v.kind] ?? [];
}

export interface Guess {
  themes: string[];
  /** The strongest evidence: the APIs' genres > words in the title > the description > the event type > the venue. */
  from: "genres" | "title" | "details" | "type" | "venue" | "none";
}

/** A first guess at an event's themes, before the maintenance task has tagged it. */
/** Themes a description can suggest: subjects, not formats or seasons ("join our talk this Christmas"). */
const DETAIL_SKIP = new Set([...FORMAT, "festive", "podcasts", "tributes", "food-drink"]);

export function guessEventThemes(e: Pick<WOEvent, "title" | "type" | "genres"> & { description?: string }, venue: string[], t: Themes): Guess {
  const byGenre = genreThemes(e.genres, t);
  const suits = (th: Theme) => !th.types || th.types.includes(e.type);
  const byTitle = t.match.filter(([th, re]) => suits(th) && re.test(e.title)).map(([th]) => th.id);
  // Nothing from the genres or title? The description often says what it's about (first few lines).
  const subject = (ids: string[]) => ids.some((id) => !FORMAT.has(id));
  const text = e.description?.slice(0, 400) ?? "";
  const byDetails =
    subject([...byGenre, ...byTitle]) || !text
      ? []
      : t.match
          .filter(([th, re]) => suits(th) && !DETAIL_SKIP.has(th.id) && re.test(text))
          .map(([th]) => th.id)
          .slice(0, 2);
  const byType = TYPE_THEME[e.type] ? [TYPE_THEME[e.type]!] : [];
  const found = uniq([...byGenre, ...byTitle, ...byDetails, ...byType]);
  // Nothing about the subject? Borrow the venue's — but only where the venue is mainly that kind of
  // place: a gig at Union Chapel (folk first, comedy too) mustn't become comedy because it's typed a
  // "show", nor jazz at the Barbican (art first) classical. A generic "event" borrows only from a venue
  // that does one kind of thing ("And also" themes like family don't count as a kind).
  const groups = TYPE_GROUPS[e.type];
  const groupOf = (id: string) => t.byId.get(id)?.group;
  const kinds = new Set(venue.map(groupOf).filter((g) => g && g !== "more"));
  const fits = groups ? !!venue[0] && groups.includes(groupOf(venue[0])!) : kinds.size === 1;
  const byVenue =
    found.some((id) => !FORMAT.has(id)) || !fits
      ? []
      : venue.filter((id) => {
          const g = groupOf(id);
          return g && (!groups || groups.includes(g)) && !found.includes(id);
        });
  // One for a show or gig (a theatre's second theme is usually another strand); two for exhibitions.
  const borrow = e.type === "exhibition" || e.type === "display" ? 2 : 1;
  const themes = uniq([...found, ...byVenue.slice(0, borrow)])
    .filter((id) => t.byId.has(id))
    .slice(0, MAX_THEMES);
  const from = byGenre.length ? "genres" : byTitle.length ? "title" : byDetails.length ? "details" : byType.length ? "type" : byVenue.length ? "venue" : "none";
  return { themes, from };
}

export function eventThemes(e: Pick<WOEvent, "id" | "title" | "type" | "genres">, venue: string[], tags: TagsFile, t: Themes): string[] {
  return tags.events[e.id] ?? guessEventThemes(e, venue, t).themes;
}

export function guessPersonThemes(p: Pick<Person, "kind" | "genres">, t: Themes): string[] {
  const g = genreThemes(p.genres, t);
  return (g.length ? g : (PERSON_KIND_THEMES[p.kind] ?? [])).slice(0, MAX_THEMES);
}

export function personThemes(p: Pick<Person, "id" | "kind" | "genres">, tags: TagsFile, t: Themes): string[] {
  return tags.people[p.id] ?? guessPersonThemes(p, t);
}
