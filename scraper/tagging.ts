// Tagging venues, events and people with themes (data/themes.json) — the pure parts of `npm run themes`:
// what's waiting to be tagged, reading the maintenance task's answers, and checking data/tags.json.

import type { Person, TagsFile, Theme, Venue, WOEvent } from "../lib/types.ts";
import { compileThemes, guessEventThemes, guessPersonThemes, isAct, MAX_THEMES, venueThemes } from "../lib/themes.ts";

export type Kind = "venue" | "event" | "person";
const KINDS: Kind[] = ["venue", "event", "person"];
const field = (k: Kind) => (k === "venue" ? "venues" : k === "event" ? "events" : "people") as keyof TagsFile;

export interface Universe {
  venues: Venue[];
  events: WOEvent[]; // scraped + hand-added
  people: Person[];
  today: string;
}

const isCurrent = (e: WOEvent, today: string) => {
  const last = e.endDate ?? (e.ongoing ? null : e.startDate);
  return !last || last >= today;
};
const oneLine = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t;
};
const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** Untagged things, most worth tagging first, as lines for the maintenance task to answer. */
export function todo(u: Universe, tags: TagsFile, themes: Theme[], opts: { events?: number; people?: number; venues?: number } = {}) {
  const t = compileThemes(themes);
  const venueById = new Map(u.venues.map((v) => [v.id, v]));
  const current = u.events.filter((e) => isCurrent(e, u.today) && venueById.has(e.venueId));
  const lines: string[] = [];

  // Venues: what they're known for. A few of their current titles help.
  const titlesAt = new Map<string, string[]>();
  for (const e of current) {
    const l = titlesAt.get(e.venueId) ?? [];
    if (l.length < 4) titlesAt.set(e.venueId, [...l, e.title]);
  }
  const venues = u.venues.filter((v) => !tags.venues[v.id]);
  for (const v of venues.slice(0, opts.venues ?? 400)) {
    const on = titlesAt.get(v.id)?.map((x) => quote(oneLine(x, 60))).join("; ");
    lines.push(`venue\t${v.id}\t${v.name} · ${v.kind} · ${v.area} · ${v.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}${on ? ` · on now: ${on}` : ""}`);
  }

  // Events: those the rules know least about first (no genres, no telling title), then the soonest.
  const tier = { none: 0, venue: 1, type: 1, details: 1, title: 2, genres: 3 } as const;
  const waiting = current
    .filter((e) => !tags.events[e.id])
    .map((e) => ({ e, g: guessEventThemes(e, venueThemes(venueById.get(e.venueId)!, tags), t) }))
    .sort(
      (a, b) =>
        tier[a.g.from] - tier[b.g.from] ||
        (a.e.startDate && a.e.startDate > u.today ? a.e.startDate : u.today).localeCompare(b.e.startDate && b.e.startDate > u.today ? b.e.startDate : u.today) ||
        b.e.firstSeen.localeCompare(a.e.firstSeen),
    );
  for (const { e, g } of waiting.slice(0, opts.events ?? 250)) {
    const when = e.startDate && e.endDate && e.endDate !== e.startDate ? `${e.startDate} → ${e.endDate}` : (e.startDate ?? (e.endDate ? `until ${e.endDate}` : "ongoing"));
    const v = venueById.get(e.venueId)!;
    const vt = venueThemes(v, tags);
    const bits = [quote(oneLine(e.title, 100)), e.type, `${v.name}${vt.length ? ` (${vt.join(",")})` : ""}`, when];
    if (e.genres?.length) bits.push(`genres: ${e.genres.join(", ")}`);
    // Only real evidence as a hint: a theme borrowed from the venue is what this step is here to check.
    if (g.from === "genres" || g.from === "title") bits.push(`guess: ${g.themes.join(",")}`);
    if (e.description) bits.push(quote(oneLine(e.description, 300)));
    lines.push(`event\t${e.id}\t${bits.join(" · ")}`);
  }

  // People: acts on at venues we list (not productions or club nights), when neither their genres nor
  // what kind of act they are (a comedian is comedy) says anything.
  const gigs = new Map<string, string[]>();
  for (const e of current)
    for (const p of e.people ?? []) {
      const l = gigs.get(p) ?? [];
      if (l.length < 2) gigs.set(p, [...l, `${oneLine(e.title, 50)} @ ${venueById.get(e.venueId)!.name}`]);
    }
  const people = u.people.filter((p) => gigs.has(p.id) && !tags.people[p.id] && isAct({ ...p, kind: p.kind === "other" ? "music" : p.kind }) && !guessPersonThemes(p, t).length);
  for (const p of people.slice(0, opts.people ?? 50)) {
    lines.push(`person\t${p.id}\t${p.name} · ${p.kind}${p.genres?.length ? ` · genres: ${p.genres.join(", ")}` : ""} · on: ${gigs.get(p.id)!.map(quote).join("; ")}`);
  }

  return {
    lines,
    waiting: { venues: venues.length, events: waiting.length, people: people.length },
  };
}

/** The theme list as the maintenance task reads it. */
export function themeList(themes: Theme[]): string[] {
  return themes.map((t) => `${t.id} — ${t.label}: ${t.about}`);
}

export interface Applied {
  tags: TagsFile;
  saved: Record<Kind, number>;
  rejected: string[];
}

/**
 * Read answers ("<kind> <id> <theme>,<theme>"; "-" = none fit) into the tags. Lines naming an unknown
 * thing or theme are rejected (and reported); everything else is saved.
 */
export function applyAnswers(text: string, tags: TagsFile, themes: Theme[], u: Omit<Universe, "today">): Applied {
  const known = new Set(themes.map((t) => t.id));
  const exists: Record<Kind, Set<string>> = {
    venue: new Set(u.venues.map((v) => v.id)),
    event: new Set(u.events.map((e) => e.id)),
    person: new Set(u.people.map((p) => p.id)),
  };
  const next: TagsFile = { venues: { ...tags.venues }, events: { ...tags.events }, people: { ...tags.people } };
  const saved: Record<Kind, number> = { venue: 0, event: 0, person: 0 };
  const rejected: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [kind, id, ...rest] = line.split(/\s+/);
    const list = rest.join("");
    const ids = list === "-" ? [] : [...new Set(list.split(",").map((x) => x.trim()).filter(Boolean))];
    const why = !KINDS.includes(kind as Kind)
      ? `unknown kind "${kind}"`
      : !id || !exists[kind as Kind].has(id)
        ? `no ${kind} "${id}"`
        : list !== "-" && !ids.length
          ? "no themes (use - when none fit)"
          : ids.length > MAX_THEMES
            ? `more than ${MAX_THEMES} themes`
            : ids.filter((x) => !known.has(x)).map((x) => `unknown theme "${x}"`).join(", ");
    if (why) {
      rejected.push(`${line}  ← ${why}`);
      continue;
    }
    next[field(kind as Kind)][id] = ids;
    saved[kind as Kind]++;
  }
  return { tags: prune(next, u), saved, rejected };
}

/** Drop tags for things that have gone (past events, removed venues, performers no longer on). */
export function prune(tags: TagsFile, u: Omit<Universe, "today">): TagsFile {
  const keep = (m: Record<string, string[]>, ids: Set<string>) => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id)));
  return {
    venues: keep(tags.venues, new Set(u.venues.map((v) => v.id))),
    events: keep(tags.events, new Set(u.events.map((e) => e.id))),
    people: keep(tags.people, new Set(u.people.map((p) => p.id))),
  };
}

/** Problems with the theme list or the tags (empty = fine). */
export function check(themes: Theme[], tags: TagsFile): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const groups = new Set(["art", "ideas", "stage", "music", "screen", "more"]);
  for (const t of themes) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) problems.push(`theme id "${t.id}" isn't kebab-case`);
    if (ids.has(t.id)) problems.push(`theme "${t.id}" is listed twice`);
    ids.add(t.id);
    if (!t.label || !t.about) problems.push(`theme "${t.id}" needs a label and an about`);
    if (!groups.has(t.group)) problems.push(`theme "${t.id}" has unknown group "${t.group}"`);
    for (const re of [t.match, t.genres])
      if (re)
        try {
          new RegExp(re, "i");
        } catch {
          problems.push(`theme "${t.id}": bad regex ${re}`);
        }
  }
  for (const f of ["venues", "events", "people"] as const)
    for (const [id, list] of Object.entries(tags[f] ?? {})) {
      if (!Array.isArray(list)) problems.push(`tags.${f}["${id}"] isn't a list`);
      else if (list.length > MAX_THEMES) problems.push(`tags.${f}["${id}"] has more than ${MAX_THEMES} themes`);
      else for (const x of list) if (!ids.has(x)) problems.push(`tags.${f}["${id}"]: unknown theme "${x}"`);
    }
  return problems;
}

/** data/tags.json with one line per thing, sorted, so daily diffs stay small and readable. */
export function formatTags(tags: TagsFile): string {
  const block = (m: Record<string, string[]>) => {
    const rows = Object.keys(m)
      .sort()
      .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(m[id])}`);
    return rows.length ? `{\n${rows.join(",\n")}\n  }` : "{}";
  };
  return `{\n  "venues": ${block(tags.venues)},\n  "events": ${block(tags.events)},\n  "people": ${block(tags.people)}\n}\n`;
}

