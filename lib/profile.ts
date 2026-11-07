// Discover: what you seem to be into, worked out on your device from what you follow, save and pick —
// then what else matches, spread across your interests and explained. No AI and no server: the themes
// come with the app's data (see lib/themes.ts).

import type { VenueLite } from "./data";
import type { EventType, Memo, Person, VenueKind, WOEvent } from "./types";
import { isAct } from "./themes";

export { isAct };

/**
 * How much each signal counts, in total (an item spreads it over its themes, most telling first):
 * a theme you picked, a saved event, a followed act, a followed place. A place counts least: big
 * venues do a bit of everything, so following the O2 says less than saving one exhibition.
 */
export const WEIGHT = { visited: 4, liked: 4, saved: 3, person: 2, venue: 1 } as const;
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
  | { kind: "visited" | "saved"; title: string; themes: string[]; kw: string[] }
  | { kind: "person"; name: string; themes: string[] }
  | { kind: "venue"; name: string; themes: string[] };

export interface Profile {
  themes: Map<string, number>;
  /** What kinds of thing you go to (exhibitions, shows…) and what kinds of place. */
  types: Map<EventType, number>;
  kinds: Map<VenueKind, number>;
  sources: Map<string, (Source & { weight: number })[]>;
  /** What you've been to and saved — to connect suggestions to ("Because you saved X · Westwood"). */
  anchors: { kind: "visited" | "saved"; id: string; title: string; themes: string[]; kw: string[] }[];
}

export interface Signals {
  likes: string[];
  follows: string[];
  saved: string[];
  people: string[];
  visited?: string[];
  /** What saved/visited events were, for ones no longer listed. */
  memo?: Record<string, Memo>;
}

export interface Lookups {
  venue: (id: string) => VenueLite | undefined;
  event: (id: string) => WOEvent | undefined;
  person: (id: string) => Person | undefined;
  /** A theme's group (art, stage…), to read a picked theme as a kind of event. */
  group?: (theme: string) => string | undefined;
}

export function buildProfile(s: Signals, l: Lookups): Profile {
  const p: Profile = { themes: new Map(), types: new Map(), kinds: new Map(), sources: new Map(), anchors: [] };
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
  // Things you've been to count most, then things you've saved (the listing, or what we remembered of it).
  const visited = new Set(s.visited ?? []);
  for (const [kind, ids] of [["visited", [...visited]], ["saved", s.saved.filter((id) => !visited.has(id))]] as const) {
    for (const id of ids) {
      const e = l.event(id);
      const m = s.memo?.[id];
      const thing = e ? { title: e.title, themes: e.themes ?? [], kw: e.kw ?? [], type: e.type, venue: e.venueId } : m ? { title: m.t, themes: m.th ?? [], kw: m.kw ?? [], type: m.ty, venue: m.v } : null;
      if (!thing) continue;
      credit(thing.themes, WEIGHT[kind], { kind, title: thing.title, themes: thing.themes, kw: thing.kw });
      p.anchors.push({ kind, id, title: thing.title, themes: thing.themes, kw: thing.kw });
      if (thing.type) add(p.types, thing.type, kind === "visited" ? 4 : 3);
      const v = l.venue(thing.venue);
      if (v) add(p.kinds, v.kind, kind === "visited" ? 2 : 1);
    }
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
  /** A real connection to something you went to or saved, and what they share (themes, words). */
  link?: { kind: "visited" | "saved"; title: string; shared: string[] };
}

/** How common each theme is across the listings (share of all of them). */
export function themeShare(events: Pick<WOEvent, "themes">[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const e of events) for (const t of e.themes ?? []) df.set(t, (df.get(t) ?? 0) + 1);
  return new Map([...df].map(([t, n]) => [t, n / Math.max(1, events.length)]));
}
/** A theme on more than 4% of listings (Contemporary art, Comedy…) is too common to be a connection by itself. */
const COMMON = 0.04;
const common = (t: string, share?: Map<string, number>) => (share?.get(t) ?? 0) > COMMON;

/**
 * The thing you went to or saved that a suggestion is most like: distinctive words in common (an
 * artist, a material, a subject) and themes in common that aren't everywhere. None → no connection.
 */
export function connect(e: Pick<WOEvent, "themes" | "kw"> & { id?: string }, p: Profile, share?: Map<string, number>) {
  let best: { anchor: Profile["anchors"][number]; shared: string[]; strength: number } | undefined;
  for (const a of p.anchors) {
    if (a.id === e.id) continue;
    const words = (e.kw ?? []).filter((w) => a.kw.includes(w));
    const themes = (e.themes ?? []).filter((t) => a.themes.includes(t));
    const specific = themes.filter((t) => !common(t, share));
    const strength = words.length + specific.length + 0.25 * (themes.length - specific.length);
    if (strength >= 1 && (!best || strength > best.strength || (strength === best.strength && a.kind === "visited")))
      best = { anchor: a, shared: [...specific, ...words.filter((w) => !specific.some((t) => t === w || t.startsWith(`${w}-`)))], strength };
  }
  return best;
}

/** The saved event / followed place most like the suggestion, among those behind its theme. */
function explain(theme: string, themes: string[], p: Profile, share?: Map<string, number>): Why {
  const overlap = (xs: string[]) => xs.filter((x) => themes.includes(x)).length;
  const rank = { liked: 3, visited: 2, saved: 2, person: 1, venue: 0 } as const;
  // Only cite a saved/visited thing when it really is alike: more than one theme in common, or a theme
  // that isn't everywhere ("Because you saved Ryoji Ikeda" for any contemporary art at all says nothing).
  const srcs = (p.sources.get(theme) ?? []).filter(
    (x) => (x.kind !== "saved" && x.kind !== "visited") || overlap(x.themes) >= 2 || !common(theme, share),
  );
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
const EVIDENCE = { guess: 0.85, details: 0.75, venue: 0.6 } as const;

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
    /** Things you've been to (not suggested again). */
    visited?: Set<string>;
    /** How common each theme is (themeShare) — tells a real connection from a shared broad theme. */
    share?: Map<string, number>;
    horizon?: number;
    limit?: number;
  },
): Match<WOEvent>[] {
  if (isEmpty(p)) return [];
  const horizon = o.horizon ?? 60;
  const cands: Match<WOEvent>[] = [];
  for (const e of events) {
    if (o.saved.has(e.id) || o.visited?.has(e.id) || o.follows.has(e.venueId) || e.people?.some((x) => o.people.has(x))) continue;
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
    // Like something you went to or saved (same artist, material, subject): worth up to twice as much.
    const c = connect(e, p, o.share);
    if (c) score *= 1 + 0.4 * Math.min(c.strength, 2.5);
    const why: Why = c ? { theme: m.theme, link: { kind: c.anchor.kind, title: c.anchor.title, shared: c.shared } } : explain(m.theme, e.themes ?? [], p, o.share);
    cands.push({ item: e, score, why });
  }
  return diversify(cands, p, o.limit ?? 24, (e) => e.venueId);
}

/** Places you don't follow that match you and have something on — one per interest. */
export function recommendVenues(p: Profile, venues: VenueLite[], onNow: Record<string, number>, follows: Set<string>, limit = 8, share?: Map<string, number>): Match<VenueLite>[] {
  if (isEmpty(p)) return [];
  const cands = venues
    .filter((v) => !follows.has(v.id) && (onNow[v.id] ?? 0) > 0)
    .map((v) => {
      const m = match(v.themes, p);
      return { item: v, score: m.score * fit(p.kinds, v.kind, 0.5) * (1 + 0.15 * Math.log1p(onNow[v.id] ?? 0)), why: explain(m.theme ?? "", v.themes ?? [], p, share) };
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
  // "Because you saved The 90s: Art and Fashion · Westwood, Fashion & textiles"
  if (w.link) {
    const what = w.link.shared
      .slice(0, 2)
      .map((x) => label(x) ?? x.charAt(0).toUpperCase() + x.slice(1))
      .join(", ");
    return `Because you ${w.link.kind === "visited" ? "went to" : "saved"} ${clip(w.link.title)}${what ? ` · ${what}` : ""}`;
  }
  if (s?.kind === "visited") return `Because you went to ${clip(s.title)}`;
  if (s?.kind === "saved") return `Because you saved ${clip(s.title)}`;
  if (s?.kind === "venue" || s?.kind === "person") return `Because you follow ${s.name}`;
  return `Because you like ${label(w.theme) ?? w.theme}`;
}
