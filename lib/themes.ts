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

/** …and at an untagged performer's, from what kind of act they are. */
const PERSON_KIND_THEMES: Partial<Record<Person["kind"], string[]>> = { comedy: ["comedy"], talk: ["talks"], dance: ["dance"], family: ["family"], theatre: ["plays"] };

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
  /** The strongest evidence: the APIs' genres > words in the title > the event type > the venue. */
  from: "genres" | "title" | "type" | "venue" | "none";
}

/** A first guess at an event's themes, before the maintenance task has tagged it. */
export function guessEventThemes(e: Pick<WOEvent, "title" | "type" | "genres">, venue: string[], t: Themes): Guess {
  const byGenre = genreThemes(e.genres, t);
  const byTitle = t.match.filter(([th, re]) => (!th.types || th.types.includes(e.type)) && re.test(e.title)).map(([th]) => th.id);
  const byType = TYPE_THEME[e.type] ? [TYPE_THEME[e.type]!] : [];
  const found = uniq([...byGenre, ...byTitle, ...byType]);
  // Nothing about the subject? Borrow the venue's — those that suit this kind of event.
  const groups = TYPE_GROUPS[e.type];
  const byVenue = found.some((id) => !FORMAT.has(id))
    ? []
    : venue.filter((id) => {
        const th = t.byId.get(id);
        return th && (!groups || groups.includes(th.group)) && !found.includes(id);
      });
  // One for a show or gig (a theatre's second theme is usually another strand); two for exhibitions.
  const borrow = e.type === "exhibition" || e.type === "display" ? 2 : 1;
  const themes = uniq([...found, ...byVenue.slice(0, borrow)])
    .filter((id) => t.byId.has(id))
    .slice(0, MAX_THEMES);
  const from = byGenre.length ? "genres" : byTitle.length ? "title" : byType.length ? "type" : byVenue.length ? "venue" : "none";
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
