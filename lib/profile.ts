// Discover: what you seem to be into, worked out on your device from what you follow, save and pick —
// then what else matches, spread across your interests and explained. No AI and no server: the themes
// come with the app's data (see lib/themes.ts).

import type { VenueLite } from "./data";
import type { EventType, Person, VenueKind, WOEvent } from "./types";
import { isAct } from "./themes";

export { isAct };

/**
 * How much each signal counts, in total (an item spreads it over its themes, most telling first):
 * a theme you picked, a saved event, a followed act, a followed place. A place counts least: big
 * venues do a bit of everything, so following the O2 says less than saving one exhibition.
 */
export const WEIGHT = { liked: 4, saved: 3, person: 2, venue: 1 } as const;
const POSITION = [1, 0.7, 0.5, 0.4];
const pos = (i: number) => POSITION[i] ?? 0.3;
/** An item's weight spread over its themes. */
const spread = (themes: string[], total: number) => {
  const sum = themes.reduce((s, _, i) => s + pos(i), 0);
  return themes.map((t, i) => [t, (total * pos(i)) / sum] as const);
};

/** What kinds of event a followed place usually means you go to. */
const KIND_TYPES: Record<VenueKind, EventType[]> = {
  museum: ["exhibition", "display"],
  "public-gallery": ["exhibition", "display"],
  "commercial-gallery": ["exhibition"],
  garden: ["exhibition", "event"],
  theatre: ["show"],
  "concert-hall": ["concert"],
  "live-venue": ["show", "concert"],
  "talks-venue": ["talk"],
  "comedy-club": ["show"],
  "arts-centre": ["exhibition", "show", "concert", "screening", "talk"],
};
const PERSON_TYPES: Partial<Record<Person["kind"], EventType>> = { music: "concert", comedy: "show", theatre: "show", dance: "show", talk: "talk", family: "family" };
const GROUP_TYPE: Record<string, EventType> = { art: "exhibition", ideas: "exhibition", stage: "show", music: "concert", screen: "screening" };

/** Where a theme in your profile came from — for "Because you saved …". */
export type Source =
  | { kind: "liked" }
  | { kind: "saved"; title: string; themes: string[] }
  | { kind: "person"; name: string; themes: string[] }
  | { kind: "venue"; name: string; themes: string[] };

export interface Profile {
  themes: Map<string, number>;
  /** What kinds of thing you go to (exhibitions, shows…) and what kinds of place. */
  types: Map<EventType, number>;
  kinds: Map<VenueKind, number>;
  sources: Map<string, (Source & { weight: number })[]>;
}

export interface Signals {
  likes: string[];
  follows: string[];
  saved: string[];
  people: string[];
}

export interface Lookups {
  venue: (id: string) => VenueLite | undefined;
  event: (id: string) => WOEvent | undefined;
  person: (id: string) => Person | undefined;
  /** A theme's group (art, stage…), to read a picked theme as a kind of event. */
  group?: (theme: string) => string | undefined;
}

export function buildProfile(s: Signals, l: Lookups): Profile {
  const p: Profile = { themes: new Map(), types: new Map(), kinds: new Map(), sources: new Map() };
  const add = <K>(m: Map<K, number>, k: K, w: number) => m.set(k, (m.get(k) ?? 0) + w);
  const credit = (themes: string[] | undefined, total: number, src: Source) => {
    for (const [t, w] of spread(themes ?? [], total)) {
      add(p.themes, t, w);
      p.sources.set(t, [...(p.sources.get(t) ?? []), { ...src, weight: w }]);
    }
  };
  for (const t of s.likes) {
    credit([t], WEIGHT.liked, { kind: "liked" });
    const type = GROUP_TYPE[l.group?.(t) ?? ""];
    if (type) add(p.types, type, 1);
  }
  for (const id of s.saved) {
    const e = l.event(id);
    if (!e) continue;
    credit(e.themes, WEIGHT.saved, { kind: "saved", title: e.title, themes: e.themes ?? [] });
    add(p.types, e.type, 3);
    const v = l.venue(e.venueId);
    if (v) add(p.kinds, v.kind, 1);
  }
  for (const id of s.people) {
    const x = l.person(id);
    if (!x) continue;
    credit(x.themes, WEIGHT.person, { kind: "person", name: x.name, themes: x.themes ?? [] });
    const type = PERSON_TYPES[x.kind];
    if (type) add(p.types, type, 1);
  }
  for (const id of s.follows) {
    const v = l.venue(id);
    if (!v) continue;
    credit(v.themes, WEIGHT.venue, { kind: "venue", name: v.name, themes: v.themes ?? [] });
    for (const type of KIND_TYPES[v.kind]) add(p.types, type, 1 / KIND_TYPES[v.kind].length);
    add(p.kinds, v.kind, 1);
  }
  return p;
}

export const isEmpty = (p: Profile) => p.themes.size === 0;

export function topThemes(p: Profile, n = 8): string[] {
  return [...p.themes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * How well a set of themes matches you (0–1): its best-matching theme (relative to your strongest
 * interest), plus a little for each other match. Also says which theme it is.
 */
export function match(themes: string[] | undefined, p: Profile): { score: number; theme?: string } {
  const max = Math.max(0, ...p.themes.values());
  if (!themes?.length || !max) return { score: 0 };
  let best = 0;
  let theme: string | undefined;
  let rest = 0;
  themes.forEach((t, i) => {
    const s = ((p.themes.get(t) ?? 0) / max) * pos(i);
    if (s > best) {
      rest += best;
      [best, theme] = [s, t];
    } else rest += s;
  });
  return { score: best + 0.2 * rest, theme };
}

/** 0.35–1: how much you go to this kind of thing (from what you save and the places you follow). */
function fit<K>(m: Map<K, number>, k: K, floor: number): number {
  const max = Math.max(0, ...m.values());
  return max ? floor + (1 - floor) * ((m.get(k) ?? 0) / max) : 1;
}

/** Why something's suggested: the theme, and the thing of yours that put it in your profile. */
export interface Why {
  theme: string;
  source?: Source;
}

/** The saved event / followed place most like the suggestion, among those behind its theme. */
function explain(theme: string, themes: string[], p: Profile): Why {
  const overlap = (xs: string[]) => xs.filter((x) => themes.includes(x)).length;
  const rank = { liked: 3, saved: 2, person: 1, venue: 0 } as const;
  const srcs = p.sources.get(theme) ?? [];
  // The most similar thing of yours (most themes in common), a saved event over a followed place on a tie.
  const best = [...srcs].sort(
    (a, b) =>
      ("themes" in b ? overlap(b.themes) : 9) - ("themes" in a ? overlap(a.themes) : 9) ||
      rank[b.kind] - rank[a.kind] ||
      b.weight - a.weight,
  )[0];
  return { theme, source: best };
}

export interface Match<T> {
  item: T;
  score: number;
  why: Why;
}

/**
 * Spread the picks across your interests rather than piling them on the strongest one: each of your
 * top themes gets a share of the slots in proportion to its weight (at least two), and the list
 * alternates between themes. At most one per place until every theme has had its turn.
 */
function diversify<T>(all: Match<T>[], p: Profile, limit: number, placeOf: (x: T) => string, themes = 8): Match<T>[] {
  // Nothing much weaker than the best match, just to fill a slot.
  const floor = 0.3 * Math.max(0, ...all.map((c) => c.score));
  const cands = all.filter((c) => c.score >= floor);
  const top = topThemes(p, themes).filter((t) => cands.some((c) => c.why.theme === t));
  const total = top.reduce((s, t) => s + (p.themes.get(t) ?? 0), 0);
  const quota = new Map(top.map((t) => [t, Math.max(2, Math.round((limit * (p.themes.get(t) ?? 0)) / total))]));
  const groups = new Map(top.map((t) => [t, cands.filter((c) => c.why.theme === t).sort((a, b) => b.score - a.score)]));
  const out: Match<T>[] = [];
  const taken = new Set<Match<T>>();
  const perPlace = new Map<string, number>();
  for (const cap of [1, 2]) {
    if (cap === 2 && out.length >= limit / 2) break; // a second from one place only if there's little else
    let progress = true;
    while (out.length < limit && progress) {
      progress = false;
      for (const t of top) {
        if (out.length >= limit) break;
        if (cap === 1 && out.filter((x) => x.why.theme === t).length >= quota.get(t)!) continue;
        const next = groups.get(t)!.find((c) => !taken.has(c) && (perPlace.get(placeOf(c.item)) ?? 0) < cap);
        if (!next) continue;
        taken.add(next);
        perPlace.set(placeOf(next.item), (perPlace.get(placeOf(next.item)) ?? 0) + 1);
        out.push(next);
        progress = true;
      }
    }
  }
  return out;
}

const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : (e.startDate ?? "9999"));
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
/** Themes that were assigned (tagged, or read from the API's genres / the title) count fully; ones borrowed from the venue, less. */
const EVIDENCE = { guess: 0.85, venue: 0.6 } as const;

/**
 * Events you might like that you wouldn't otherwise see: not already saved, not at places you follow
 * and not by people you follow (those are in your feed). On now or within `horizon` days. Scored by
 * how well the themes match, how sure we are of them, and whether it's the kind of thing (exhibition,
 * show…) at the kind of place you go to; nudged for closing soon, opening soon or just announced.
 */
export function recommendEvents(
  p: Profile,
  events: WOEvent[],
  o: {
    today: string;
    follows: Set<string>;
    people: Set<string>;
    saved: Set<string>;
    venue: (id: string) => VenueLite | undefined;
    horizon?: number;
    limit?: number;
  },
): Match<WOEvent>[] {
  if (isEmpty(p)) return [];
  const horizon = o.horizon ?? 60;
  const cands: Match<WOEvent>[] = [];
  for (const e of events) {
    if (o.saved.has(e.id) || o.follows.has(e.venueId) || e.people?.some((x) => o.people.has(x))) continue;
    if (lastDay(e) < o.today || (e.startDate && days(o.today, e.startDate) > horizon)) continue;
    const m = match(e.themes, p);
    if (!m.theme) continue;
    const venue = o.venue(e.venueId);
    let score = m.score * (e.themesFrom ? EVIDENCE[e.themesFrom] : 1) * fit(p.types, e.type, 0.35) * (venue ? fit(p.kinds, venue.kind, 0.5) : 1);
    if (!e.description && !e.image) score *= 0.85;
    // Made for children (or at a children's museum): only if families are part of what you go to.
    const forKids = e.themes?.includes("family") || venue?.themes?.[0] === "family" || /\b(home education|ks[1-5]|under[- ]?\d+s|toddlers?|ages? \d)/i.test(e.title);
    if (forKids && (p.themes.get("family") ?? 0) < 0.25 * Math.max(...p.themes.values())) continue;
    const end = e.endDate && e.endDate !== e.startDate ? days(o.today, e.endDate) : Infinity;
    if (end <= 14) score *= 1.1; // last chance
    if (e.startDate && e.startDate >= o.today && days(o.today, e.startDate) <= 14) score *= 1.1;
    if (days(e.firstSeen, o.today) <= 7) score *= 1.1;
    cands.push({ item: e, score, why: explain(m.theme, e.themes ?? [], p) });
  }
  return diversify(cands, p, o.limit ?? 24, (e) => e.venueId);
}

/** Places you don't follow that match you and have something on — one per interest. */
export function recommendVenues(p: Profile, venues: VenueLite[], onNow: Record<string, number>, follows: Set<string>, limit = 8): Match<VenueLite>[] {
  if (isEmpty(p)) return [];
  const cands = venues
    .filter((v) => !follows.has(v.id) && (onNow[v.id] ?? 0) > 0)
    .map((v) => {
      const m = match(v.themes, p);
      return { item: v, score: m.score * fit(p.kinds, v.kind, 0.5) * (1 + 0.15 * Math.log1p(onNow[v.id] ?? 0)), why: explain(m.theme ?? "", v.themes ?? [], p) };
    })
    .filter((x) => x.score > 0 && x.why.theme);
  return diversify(cands, p, limit, (v) => v.id).map((x) => x);
}

/** Acts (not shows: musicians, comedians, speakers, dancers) you don't follow, with London dates. */
export function recommendPeople(p: Profile, people: Person[], dates: Map<string, number>, following: Set<string>, limit = 6): Match<Person>[] {
  if (isEmpty(p)) return [];
  const cands = people
    .filter((x) => isAct(x) && !following.has(x.id) && (dates.get(x.id) ?? 0) > 0)
    .map((x) => {
      const m = match(x.themes, p);
      // A few dates is a tour; dozens is usually a residency or a club night, so it isn't worth more.
      const n = Math.min(dates.get(x.id) ?? 0, 3);
      return { item: x, score: m.score * fit(p.types, PERSON_TYPES[x.kind]!, 0.35) * (1 + 0.1 * Math.log1p(n)), why: explain(m.theme ?? "", x.themes ?? [], p) };
    })
    .filter((x) => x.score > 0 && x.why.theme);
  return diversify(cands, p, limit, (x) => x.id);
}

/** "Because you saved The 90s: Art and Fashion", "Because you follow Tate Modern", "Because you like Jazz & blues". */
export function whyText(w: Why, label: (theme: string) => string | undefined): string {
  const s = w.source;
  const clip = (title: string) => {
    const t = title.replace(/^members'?\s[^:]*:\s*/i, ""); // "Members' Preview Day: X" → "X"
    return t.length > 38 ? `${t.slice(0, 36).replace(/\s+\S*$/, "")}…` : t;
  };
  if (s?.kind === "saved") return `Because you saved ${clip(s.title)}`;
  if (s?.kind === "venue" || s?.kind === "person") return `Because you follow ${s.name}`;
  return `Because you like ${label(w.theme) ?? w.theme}`;
}
