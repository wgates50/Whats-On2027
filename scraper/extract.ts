// Generic, deterministic extraction from HTML: schema.org JSON-LD events and page metadata.

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { OnSale, Person, Schedule } from "../lib/types.ts";
import { londonDateTime, parseDateRange, type ParsedRange } from "./dates.ts";

/** A performer as an API names them (becomes a Person, id = slug of the name). */
export interface RawPerson {
  name: string;
  kind?: Person["kind"];
  links?: Person["links"];
  tmId?: string;
  genres?: string[];
}

/** What an adapter produces, before venue matching / classification / ids. */
export interface RawEvent {
  url: string;
  title: string;
  dates: ParsedRange;
  image?: string;
  description?: string;
  price?: "free" | "paid";
  venueName?: string; // aggregators
  schemaType?: string; // e.g. "ExhibitionEvent", "TheaterEvent"
  typeLabel?: string; // a type tag shown on the site, e.g. "Display", "Talk"
  cancelled?: boolean;
  schedule?: Schedule;
  onSale?: OnSale;
  people?: RawPerson[];
  genres?: string[]; // ticketing APIs' classification, e.g. "Music/Rock/Indie Rock"
}

export function load(html: string): CheerioAPI {
  return cheerio.load(html);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", pound: "£" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const clean = (s: string | undefined | null) =>
  s ? decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

const BLOCKS = "address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,td,th,tr,ul";

/**
 * An element's text with a space between block-level children. Cheerio's .text() runs adjacent
 * blocks together — "<p>2 October – 9 December 2018</p><h3>Strange Days</h3>" reads as
 * "…2018Strange Days", which hides the year — and "Devon Turnbull<br>OJAS" as "Devon TurnbullOJAS".
 */
export function textOf(el: ReturnType<CheerioAPI>): string {
  if (!el.length) return "";
  const copy = el.first().clone();
  copy.find(BLOCKS).before(" ").after(" ");
  return clean(copy.text());
}

function truncate(s: string, n = 280) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ") > n * 0.6 ? cut.lastIndexOf(" ") : n).trim() + "…";
}

export function absolute(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ JSON-LD

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      // Common breakage: raw control characters (newlines/tabs) inside strings.
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      return null;
    }
  }
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

const isEventType = (t: string) => /Event$|^Festival$/.test(t) && t !== "EventSeries";

/** All schema.org Event-like nodes on a page, flattening @graph, ItemList, subEvent, etc. */
export function jsonLdEvents($: CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (n: unknown, depth: number) => {
    if (!n || typeof n !== "object" || depth > 8 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach((x) => visit(x, depth + 1));
    const node = n as Record<string, unknown>;
    if (typesOf(node).some(isEventType)) out.push(node);
    for (const k of ["@graph", "itemListElement", "item", "subEvent", "subEvents", "event", "events", "mainEntity", "hasPart"]) {
      if (k in node) visit(node[k], depth + 1);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => visit(parseJsonLoose($(el).text()), 0));
  return out;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return str(v[0]);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o.url ?? o["@id"] ?? o.contentUrl ?? o.name);
  }
  return undefined;
}

function priceFromOffers(node: Record<string, unknown>): "free" | "paid" | undefined {
  if (node.isAccessibleForFree === true || node.isAccessibleForFree === "true" || node.isAccessibleForFree === "True") return "free";
  const offers = ([] as unknown[]).concat(node.offers ?? []);
  const prices = offers
    .flatMap((o) => {
      if (!o || typeof o !== "object") return [];
      const r = o as Record<string, unknown>;
      return [r.price, r.lowPrice, r.highPrice];
    })
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map((p) => parseFloat(String(p).replace(/[^\d.]/g, "")))
    .filter((p) => Number.isFinite(p));
  if (!prices.length) return undefined;
  return Math.max(...prices) === 0 ? "free" : "paid";
}

export function rawFromJsonLd(node: Record<string, unknown>, pageUrl: string, today: string): RawEvent | null {
  const title = clean(str(node.name));
  if (!title) return null;
  const s = typeof node.startDate === "string" ? londonDateTime(node.startDate) : null;
  const e = typeof node.endDate === "string" ? londonDateTime(node.endDate) : null;
  let dates: ParsedRange | null = null;
  if (s || e) {
    const startDate = s?.date ?? null;
    const endDate = e && e.date !== startDate ? e.date : null;
    // Times with non-zero seconds (e.g. "09:10:24") are CMS timestamps, not performance times.
    const realTime = typeof node.startDate === "string" && !/T\d{2}:\d{2}:(?!00)\d{2}/.test(node.startDate);
    dates = { startDate, endDate, startTime: !endDate && realTime ? s?.time : undefined };
    if (startDate && endDate && endDate < startDate) dates = null;
  } else if (typeof node.startDate === "string") {
    dates = parseDateRange(node.startDate, today);
  }
  if (!dates) return null;

  const loc = node.location as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const firstLoc = Array.isArray(loc) ? loc[0] : loc;
  // Some sites (e.g. Official London Theatre) put a URL in location.name and the name in location.title.
  const locName = firstLoc && typeof firstLoc === "object" ? clean(str(firstLoc.name)) : "";
  const locTitle = firstLoc && typeof firstLoc === "object" && typeof firstLoc.title === "string" ? clean(firstLoc.title) : "";
  const venueName = (/^https?:/.test(locName) ? locTitle || locName : locName || locTitle) || undefined;
  const status = String(node.eventStatus ?? "");
  const desc = clean(str(node.description));
  return {
    url: absolute(str(node.url), pageUrl) ?? pageUrl,
    title,
    dates,
    image: absolute(str(node.image), pageUrl),
    description: desc ? truncate(desc) : undefined,
    price: priceFromOffers(node),
    venueName,
    schemaType: typesOf(node).find(isEventType),
    cancelled: /EventCancelled/i.test(status),
  };
}

// ------------------------------------------------------------------ page metadata

export function meta($: CheerioAPI, name: string): string | undefined {
  const v =
    $(`meta[property="${name}"]`).attr("content") ??
    $(`meta[name="${name}"]`).attr("content");
  return v ? clean(v) : undefined;
}

/** Remove a trailing " | Site name" from a <title>/og:title. */
export function stripSiteSuffix(title: string): string {
  return title.replace(/\s+[|·•]\s+[^|·•]+$/, "").trim();
}

export function pageTitle($: CheerioAPI, selector?: string): string {
  if (selector) {
    for (const part of selector.split(",")) {
      const t = textOf($(part.trim()).first());
      if (t) return t;
    }
  }
  const h1 = textOf($("h1").first());
  if (h1) return h1;
  return stripSiteSuffix(meta($, "og:title") ?? clean($("title").first().text()));
}

export function pageDescription($: CheerioAPI, selector?: string): string | undefined {
  const t = selector ? textOf($(selector).first()) : "";
  const d = t || meta($, "og:description") || meta($, "description");
  return d ? truncate(d) : undefined;
}

/** First usable image URL in an element: src, data-src, or the first srcset candidate. */
export function imageIn($: CheerioAPI, scope: ReturnType<CheerioAPI>, pageUrl: string): string | undefined {
  const img = scope.is("img") ? scope : scope.find("img").first();
  if (!img.length) return undefined;
  const src = img.attr("src");
  const cand = [img.attr("data-src"), src && !src.startsWith("data:") ? src : undefined, (img.attr("srcset") ?? img.attr("data-srcset"))?.split(",")[0]?.trim().split(/\s+/)[0]];
  for (const c of cand) {
    const a = absolute(c, pageUrl);
    if (a) return a;
  }
  return undefined;
}

export function pageImage($: CheerioAPI, pageUrl: string): string | undefined {
  return absolute(meta($, "og:image") ?? meta($, "twitter:image"), pageUrl);
}

export function textToPrice(text: string): "free" | "paid" | undefined {
  const t = text.toLowerCase();
  if (/£\s?\d/.test(t) || /\b(tickets?|from) £/.test(t)) return "paid";
  if (/\bfree\b/.test(t) && !/free for members/.test(t)) return "free";
  return undefined;
}
