// Discover: what you seem to be into, as a weight per theme, worked out on your device from the
// themes of what you follow and save (and the themes you pick yourself) — then what else matches.
// No AI and no server: the themes come with the app's data (see lib/themes.ts).

import type { VenueLite } from "./data";
import type { Person, WOEvent } from "./types";

/** How much each signal counts: a theme you picked, a saved event, a followed act, a followed place. */
export const WEIGHT = { liked: 3, saved: 2, person: 1.5, venue: 1 } as const;
/** Something's first theme is its most telling. */
const POSITION = [1, 0.7, 0.5, 0.4];
const pos = (i: number) => POSITION[i] ?? 0.3;

export type Profile = Map<string, number>;

export interface Signals {
  likes: string[];
  follows: string[];
  saved: string[];
  people: string[];
}

export function buildProfile(
  s: Signals,
  venueThemes: (id: string) => string[] | undefined,
  eventThemes: (id: string) => string[] | undefined,
  personThemes: (id: string) => string[] | undefined,
): Profile {
  const p: Profile = new Map();
  const add = (themes: string[] | undefined, w: number) => themes?.forEach((t, i) => p.set(t, (p.get(t) ?? 0) + w * pos(i)));
  for (const t of s.likes) p.set(t, (p.get(t) ?? 0) + WEIGHT.liked);
  for (const id of s.saved) add(eventThemes(id), WEIGHT.saved);
  for (const id of s.people) add(personThemes(id), WEIGHT.person);
  for (const id of s.follows) add(venueThemes(id), WEIGHT.venue);
  return p;
}

export function topThemes(p: Profile, n = 8): string[] {
  return [...p.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/** How well a thing's themes match you (0 = not at all). Lots of loosely matching themes don't beat one strong one. */
export function affinity(themes: string[] | undefined, p: Profile): number {
  if (!themes?.length) return 0;
  return themes.reduce((s, t, i) => s + (p.get(t) ?? 0) * pos(i), 0) / Math.sqrt(themes.length);
}

/** The theme that best explains a match ("Because you like Photography"). */
export function because(themes: string[] | undefined, p: Profile): string | undefined {
  let best: string | undefined;
  let score = 0;
  themes?.forEach((t, i) => {
    const s = (p.get(t) ?? 0) * pos(i);
    if (s > score) [best, score] = [t, s];
  });
  return best;
}

export interface Match<T> {
  item: T;
  score: number;
  reason?: string; // theme id
}

const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : (e.startDate ?? "9999"));
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/**
 * Events you might like that you wouldn't otherwise see: not already saved, not at places you follow
 * and not by people you follow (those are in your feed). On now or within `horizon` days; a nudge for
 * things closing soon, starting soon or just announced; at most `perVenue` from one place.
 */
export function recommendEvents(
  p: Profile,
  events: WOEvent[],
  o: { today: string; follows: Set<string>; people: Set<string>; saved: Set<string>; horizon?: number; limit?: number; perVenue?: number },
): Match<WOEvent>[] {
  if (!p.size) return [];
  const horizon = o.horizon ?? 60;
  const scored: Match<WOEvent>[] = [];
  for (const e of events) {
    if (o.saved.has(e.id) || o.follows.has(e.venueId) || e.people?.some((x) => o.people.has(x))) continue;
    if (lastDay(e) < o.today || (e.startDate && days(o.today, e.startDate) > horizon)) continue;
    let score = affinity(e.themes, p);
    if (score <= 0) continue;
    const end = e.endDate && e.endDate !== e.startDate ? days(o.today, e.endDate) : Infinity;
    if (end <= 14) score *= 1.15; // last chance
    if (e.startDate && e.startDate >= o.today && days(o.today, e.startDate) <= 14) score *= 1.1;
    if (days(e.firstSeen, o.today) <= 7) score *= 1.1;
    scored.push({ item: e, score, reason: because(e.themes, p) });
  }
  scored.sort((a, b) => b.score - a.score || (a.item.startDate ?? "").localeCompare(b.item.startDate ?? ""));
  const perVenue = new Map<string, number>();
  const out: Match<WOEvent>[] = [];
  for (const s of scored) {
    const n = perVenue.get(s.item.venueId) ?? 0;
    if (n >= (o.perVenue ?? 2)) continue;
    perVenue.set(s.item.venueId, n + 1);
    out.push(s);
    if (out.length >= (o.limit ?? 30)) break;
  }
  return out;
}

/** Places you don't follow that match you and have something on. */
export function recommendVenues(p: Profile, venues: VenueLite[], onNow: Record<string, number>, follows: Set<string>, limit = 8): Match<VenueLite>[] {
  if (!p.size) return [];
  return venues
    .filter((v) => !follows.has(v.id) && (onNow[v.id] ?? 0) > 0)
    .map((v) => ({ item: v, score: affinity(v.themes, p) * (1 + 0.1 * Math.log1p(onNow[v.id] ?? 0)), reason: because(v.themes, p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Performers you don't follow, with London dates coming up, who match you. */
export function recommendPeople(p: Profile, people: Person[], hasDates: Set<string>, following: Set<string>, limit = 8): Match<Person>[] {
  if (!p.size) return [];
  return people
    .filter((x) => !following.has(x.id) && hasDates.has(x.id))
    .map((x) => ({ item: x, score: affinity(x.themes, p), reason: because(x.themes, p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
