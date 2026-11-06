// Fill in what listing cards leave out: an event's description and image, read from the event's own
// page (its JSON-LD, or the og:description / og:image every site sets for link previews). Run after
// the merge in the daily scrape, for events from venue sites only (not the ticketing APIs).
//
// Polite: each page is fetched once and remembered in data/cache/enrich.json (a miss is retried after
// a month); at most `perHost` new pages per site per run, within a time budget; robots.txt and blocks
// are respected by the fetcher, and a site that refuses us is left alone for the rest of the run.

import type { WOEvent } from "../lib/types.ts";
import { clean, jsonLdEvents, load, pageDescription, pageImage, rawFromJsonLd, textOf } from "./extract.ts";
import { BlockedError, type Fetcher } from "./fetcher.ts";

export interface EnrichEntry {
  d?: string; // description
  i?: string; // image
  at: string; // YYYY-MM-DD fetched
}
export type EnrichCache = Record<string, EnrichEntry>;

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

/** "https://site/https://cdn/x.jpg" (a CMS gluing a full URL onto its own base) → the real one. */
const fixUrl = (u?: string) => (u ? u.slice(u.lastIndexOf("https://")) : undefined);

/**
 * What one event page says about itself: a configured description selector (the source's
 * `enrich.description`, paragraphs joined), else its JSON-LD event, else og/meta description.
 */
export function readEventPage(html: string, url: string, today: string, descSelector?: string): Omit<EnrichEntry, "at"> {
  const $ = load(html);
  let picked = "";
  if (descSelector)
    for (const el of $(descSelector).toArray()) {
      const t = textOf($(el));
      if (!t) continue;
      picked = picked ? `${picked} ${t}` : t;
      if (picked.length >= 300) break;
    }
  const ld = jsonLdEvents($)
    .map((n) => rawFromJsonLd(n, url, today))
    .find((r) => r?.description);
  const d = picked || ld?.description || pageDescription($);
  const i = fixUrl(ld?.image ?? pageImage($, url));
  return { ...(d && clean(d).length >= 40 ? { d: clean(d) } : {}), ...(i ? { i } : {}) };
}

/**
 * Site-wide boilerplate isn't a description: the same text (or image) on 3+ different pages of one
 * site is its generic blurb or logo.
 */
function boilerplate(cache: EnrichCache): { d: Set<string>; i: Set<string> } {
  const count = (field: "d" | "i") => {
    const seen = new Map<string, Set<string>>();
    for (const [url, e] of Object.entries(cache)) {
      const v = e[field];
      if (!v) continue;
      const k = `${hostOf(url)}|${v}`;
      seen.set(k, new Set([...(seen.get(k) ?? []), url]));
    }
    return new Set([...seen].filter(([, urls]) => urls.size >= 3).map(([k]) => k));
  };
  return { d: count("d"), i: count("i") };
}

export async function enrich(
  events: WOEvent[],
  opts: {
    fetcher: Fetcher;
    cache: EnrichCache;
    today: string;
    deadline: number;
    perHost?: number;
    eligible: (e: WOEvent) => boolean;
    /** The event's source's description selector for its pages, if it has one. */
    descSelector?: (url: string) => string | undefined;
  },
): Promise<{ fetched: number; filled: number; blockedHosts: string[] }> {
  const { fetcher, cache, today, deadline } = opts;
  const perHost = opts.perHost ?? 25;
  const wants = (e: WOEvent) => (!e.description || !e.image) && opts.eligible(e) && /^https?:\/\//.test(e.url);
  const fresh = (e?: EnrichEntry) => !!e && days(e.at, today) < (e.d || e.i ? 120 : 30);

  // Pages to fetch, grouped by site.
  const queue = new Map<string, string[]>();
  for (const e of events) {
    if (!wants(e) || fresh(cache[e.url])) continue;
    const h = hostOf(e.url);
    const list = queue.get(h) ?? [];
    if (!list.includes(e.url) && list.length < perHost) queue.set(h, [...list, e.url]);
  }

  let fetched = 0;
  const blockedHosts: string[] = [];
  const doHost = async (host: string, urls: string[]) => {
    let errors = 0;
    for (const url of urls) {
      if (Date.now() > deadline || errors >= 2) return;
      try {
        const res = await fetcher.get(url);
        cache[url] = { ...readEventPage(res.body, res.url, today, opts.descSelector?.(url)), at: today };
        fetched++;
      } catch (e) {
        if (e instanceof BlockedError) {
          blockedHosts.push(host);
          return;
        }
        errors++;
        cache[url] = { at: today }; // retry in a month
      }
    }
  };
  // A few sites at a time; the fetcher already spaces requests to any one site.
  const hosts = [...queue];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, hosts.length) }, async () => {
      while (next < hosts.length) {
        const [host, urls] = hosts[next++];
        await doHost(host, urls);
      }
    }),
  );

  // Apply what we know, minus boilerplate.
  const generic = boilerplate(cache);
  let filled = 0;
  for (const e of events) {
    if (!wants(e)) continue;
    const c = cache[e.url];
    if (!c) continue;
    const h = hostOf(e.url);
    let changed = false;
    if (!e.description && c.d && !generic.d.has(`${h}|${c.d}`)) {
      e.description = c.d.length > 280 ? `${c.d.slice(0, 277).replace(/\s+\S*$/, "")}…` : c.d;
      changed = true;
    }
    if (!e.image && c.i && !generic.i.has(`${h}|${c.i}`)) {
      e.image = c.i;
      changed = true;
    }
    if (changed) filled++;
  }
  return { fetched, filled, blockedHosts: [...new Set(blockedHosts)] };
}
