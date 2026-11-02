// The generic adapter: listing page(s) → detail-page links → events.
// Configured entirely from data/sources.json, so most venues need no code.

import type { PagesAdapterConfig } from "../../lib/types.ts";
import { BlockedError } from "../fetcher.ts";
import { londonDateTime, parseDateRange, type ParsedRange } from "../dates.ts";
import {
  absolute,
  clean,
  imageIn,
  jsonLdEvents,
  load,
  pageDescription,
  pageImage,
  pageTitle,
  rawFromJsonLd,
  textToPrice,
  type RawEvent,
} from "../extract.ts";
import type { AdapterContext, AdapterResult } from "./index.ts";
import type { CheerioAPI } from "cheerio";

/** URL identity for de-duplication: no hash, no trailing slash, no tracking params. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) x.searchParams.delete(k);
    x.hostname = x.hostname.toLowerCase();
    return x.toString().replace(/\/(?=$|\?)/, "");
  } catch {
    return u;
  }
}

/** Split a selector list on top-level commas ("a, b:is(c, d)" → ["a", "b:is(c, d)"]). */
function selectorList(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Text of the first match, trying each selector of a comma list in priority order (not document order). */
export function firstText($: CheerioAPI, sel: string, scope?: ReturnType<CheerioAPI>): string {
  for (const part of selectorList(sel)) {
    const el = (scope ? scope.find(part) : $(part)).first();
    const t = clean(el.text());
    if (t) return t;
  }
  return "";
}

/** Smallest range covering all the given ranges. */
export function spanOf(ranges: ParsedRange[]): ParsedRange {
  const starts = ranges.map((r) => r.startDate).filter((d): d is string => !!d).sort();
  const ends = ranges.map((r) => r.endDate ?? r.startDate).filter((d): d is string => !!d).sort();
  const startDate = ranges.some((r) => !r.startDate) ? null : starts[0] ?? null;
  const end = ends[ends.length - 1] ?? null;
  const ongoing = ranges.some((r) => r.ongoing) || undefined;
  if (startDate && end === startDate) return { startDate, endDate: null, startTime: ranges[0].startTime };
  return { startDate, endDate: end, ...(ongoing ? { ongoing } : {}) };
}

export async function runPages(cfg: PagesAdapterConfig, ctx: AdapterContext): Promise<AdapterResult> {
  const { fetcher, today } = ctx;
  const maxPages = ctx.limits?.maxPages ?? cfg.maxPages ?? 1;
  const maxLinks = ctx.limits?.maxLinks ?? cfg.maxLinks ?? 60;
  const linkRe = cfg.linkPattern ? new RegExp(cfg.linkPattern) : null;
  const warnings: string[] = [];

  const links: string[] = [];
  const linkSet = new Set<string>();
  const listingEvents = new Map<string, RawEvent>();
  let cardsSeen = 0;
  let skippedCards = 0;

  for (const [li, template] of cfg.listUrls.entries()) {
    const pages = template.includes("{page}") ? Array.from({ length: maxPages }, (_, i) => i + 1) : [0];
    for (const n of pages) {
      const url = n ? template.replaceAll("{page}", String(n)) : template;
      let res;
      try {
        res = await fetcher.get(url);
      } catch (e) {
        // The first listing page failing means the whole source failed.
        if (li === 0 && n <= 1) throw e;
        if (e instanceof BlockedError) throw e;
        // Running off the end of a paged listing is normal, not worth a warning.
        if (!(n > 1 && /HTTP 404/.test((e as Error).message))) warnings.push(`listing ${url}: ${(e as Error).message}`);
        break;
      }
      const $ = load(res.body);
      let fresh = 0;
      for (const node of jsonLdEvents($)) {
        const raw = rawFromJsonLd(node, res.url, today);
        if (raw && !listingEvents.has(normUrl(raw.url))) {
          listingEvents.set(normUrl(raw.url), raw);
          fresh++;
        }
      }
      if (cfg.cards) {
        const c = cfg.cards;
        $(c.item).each((_, el) => {
          const card = $(el);
          const linkEl = c.link ? card.find(c.link).first() : card.is("a[href]") ? card : card.find("a[href]").first();
          const url = absolute(linkEl.attr("href"), res.url);
          const title = firstText($, c.title ?? "h1, h2, h3, h4, [class*=title], [class*=heading]", card);
          const dates = parseDateRange(firstText($, c.dates, card), today);
          if (!url || !title) return;
          if (!dates) {
            skippedCards++;
            return;
          }
          const key = normUrl(url);
          if (listingEvents.has(key)) return;
          listingEvents.set(key, {
            url,
            title,
            dates,
            image: imageIn($, c.image ? card.find(c.image).first() : card, res.url),
            description: c.description ? firstText($, c.description, card) || undefined : undefined,
            venueName: c.venue ? firstText($, c.venue, card) || undefined : undefined,
            typeLabel: c.typeLabel ? firstText($, c.typeLabel, card) || undefined : undefined,
          });
          cardsSeen++;
          fresh++;
        });
      }
      if (linkRe) {
        $("a[href]").each((_, a) => {
          const abs = absolute($(a).attr("href"), res.url);
          if (!abs || !linkRe.test(abs)) return;
          const key = normUrl(abs);
          if (linkSet.has(key)) return;
          linkSet.add(key);
          links.push(abs);
          fresh++;
        });
      }
      if (n && fresh === 0) break; // paged past the end
    }
  }

  const events: RawEvent[] = [];
  let skippedNoDates = 0;
  const used = new Set<string>();

  for (const link of links.slice(0, maxLinks)) {
    const key = normUrl(link);
    const fromListing = listingEvents.get(key);
    // A card with a full date range is enough; one with only "Until …"/"Opens …" is worth a detail fetch.
    if (fromListing && fromListing.dates.startDate && (fromListing.dates.endDate || !fromListing.dates.ongoing)) {
      events.push({ ...fromListing, url: link });
      used.add(key);
      continue;
    }
    let res;
    try {
      res = await fetcher.get(link);
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      warnings.push(`detail ${link}: ${(e as Error).message}`);
      if (fromListing) {
        events.push({ ...fromListing, url: link });
        used.add(key);
      }
      continue;
    }
    if (fromListing) used.add(key);
    const $ = load(res.body);
    const ld = jsonLdEvents($)
      .map((n) => rawFromJsonLd(n, res.url, today))
      .filter((r): r is RawEvent => !!r);
    let raw =
      ld.find((r) => normUrl(r.url) === key || normUrl(r.url) === normUrl(res.url)) ?? (ld.length === 1 ? ld[0] : undefined);
    // Theatre pages often list every performance as its own Event: collapse them into one run.
    if (ld.length > 1) {
      const t = (raw ?? ld[0]).title.toLowerCase();
      const perfs = ld.filter((r) => r.title.toLowerCase() === t);
      if (perfs.length > 1) raw = { ...perfs[0], dates: spanOf(perfs.map((p) => p.dates)) };
    }

    if (raw) {
      raw = {
        ...raw,
        url: link,
        image: raw.image ?? fromListing?.image ?? pageImage($, res.url),
        description: raw.description ?? fromListing?.description ?? pageDescription($),
        venueName: raw.venueName ?? fromListing?.venueName,
        typeLabel: fromListing?.typeLabel,
      };
    } else {
      const d = cfg.detail ?? {};
      let dates: ParsedRange | null = null;
      if (d.timeElements) {
        const stamps = $(d.timeElements)
          .map((_, el) => $(el).attr("datetime"))
          .get()
          .map((v) => londonDateTime(String(v)))
          .filter((v): v is { date: string; time?: string } => !!v);
        if (stamps.length) {
          const s = stamps[0];
          const e = stamps[stamps.length - 1];
          const endDate = e.date !== s.date ? e.date : null;
          dates = { startDate: s.date, endDate, startTime: endDate ? undefined : s.time };
        }
      }
      if (!dates && d.dates) dates = parseDateRange(firstText($, d.dates), today);
      if (!dates) {
        if (fromListing) events.push({ ...fromListing, url: link });
        else skippedNoDates++;
        continue;
      }
      raw = {
        url: link,
        title: fromListing?.title ?? pageTitle($, d.title),
        dates,
        image: fromListing?.image ?? pageImage($, res.url),
        description: pageDescription($, d.description) ?? fromListing?.description,
        price: d.price ? textToPrice(firstText($, d.price)) : undefined,
        venueName: (d.venue ? firstText($, d.venue) || undefined : undefined) ?? fromListing?.venueName,
        typeLabel: fromListing?.typeLabel,
      };
    }
    if (raw.title) events.push(raw);
  }

  // Listing-page JSON-LD events that weren't reached through a link (or no linkPattern at all).
  for (const [key, raw] of listingEvents) if (!used.has(key)) events.push(raw);

  if (links.length > maxLinks) warnings.push(`${links.length - maxLinks} links over maxLinks (${maxLinks}) were skipped`);
  if (skippedCards) warnings.push(`${skippedCards} cards had no parseable dates (${cardsSeen} did)`);
  // Health's "no dates" rule only looks at detail pages: a card selector that also matches some
  // undated promo blocks isn't broken, and a broken date selector shows up as "empty" anyway.
  return { events, warnings, skippedNoDates, linksFound: links.length };
}
