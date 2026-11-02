// Survey a site to decide how to configure its adapter (used by humans and by the Claude
// maintenance task when processing venue requests).
//
//   npm run discover -- https://www.example.org/whats-on [more urls…]
//   npm run discover -- --json https://…        (machine-readable)
//
// Reports: HTTP status / blocking, robots.txt, JSON-LD events, RSS/ICS feeds,
// what's-on style links, and the most common link path patterns (for `linkPattern`).

import { BlockedError, createFetcher } from "./fetcher.ts";
import { absolute, jsonLdEvents, load, rawFromJsonLd } from "./extract.ts";
import { parseDateRange, todayLondon } from "./dates.ts";
import type { CheerioAPI } from "cheerio";

export interface Discovery {
  url: string;
  finalUrl?: string;
  status: "ok" | "blocked" | "error";
  message?: string;
  jsonLdEvents: number;
  sampleEvents: { title: string; start: string | null; end: string | null; url: string }[];
  feeds: string[];
  whatsOnLinks: string[];
  linkPatterns: { prefix: string; count: number; example: string }[];
  /** Elements whose text parses as a date — candidates for `detail.dates`. */
  dateElements: { selector: string; text: string; parsed: string }[];
  cards: ReturnType<typeof findCards>;
  timeElements: { selector: string; datetime: string }[];
}

/** A short, reasonably stable CSS selector for an element: tag + up to two classes, with one parent. */
function selectorFor($: CheerioAPI, el: Parameters<CheerioAPI>[0]): string {
  const part = (e: any) => stableStep(e.tagName ?? e.name ?? "*", $(e).attr("class") ?? "");
  const e = el as any;
  const parent = e.parent && e.parent.type === "tag" ? part(e.parent) + " > " : "";
  return parent + part(e);
}

/**
 * One selector step for an element, avoiding class names that change on every site deploy:
 * styled-components ("EventCard-sc-1gq4rkg-5" → [class*="EventCard-sc-"]), CSS-module hashes and
 * random short names ("iScFvn") are replaced or skipped; utility classes with ":" "/" "[" are skipped.
 */
export function stableStep(tag: string, classAttr: string): string {
  const parts: string[] = [];
  for (const c of classAttr.split(/\s+/).filter(Boolean)) {
    if (parts.length >= 2) break;
    const sc = c.match(/^(.+?-sc-)[a-z0-9]+-\d+$/i);
    if (sc) parts.push(`[class*="${sc[1].replace(/-sc-$/, "")}"]`);
    else if (/^(js-|is-|has-)|\d{3,}|[:/[\]!@%]|__[A-Za-z0-9]{5,}__|_[a-z0-9]{5}_\d+$/.test(c)) continue;
    else if (/^[A-Za-z]{5,7}$/.test(c) && /[A-Z]/.test(c) && /[a-z]/.test(c) && !/^[A-Z][a-z]+$/.test(c)) continue; // "iScFvn"
    else parts.push("." + c);
  }
  return tag + parts.join("");
}
const partSel = ($: CheerioAPI, e: any) => stableStep(e.tagName ?? e.name ?? "*", $(e).attr("class") ?? "");

/**
 * Repeated "cards" on a listing page that each hold a link + a date — candidates for `cards` config.
 * Returns item selector, the date selector inside it, and a sample.
 */
export function findCards($: CheerioAPI, pageUrl: string, today: string) {
  const found = new Map<string, { item: string; dates: string; count: number; sampleTitle: string; sampleDate: string; sampleLink: string }>();
  $("body *").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 2) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text.length < 5 || text.length > 70) return;
    const r = parseDateRange(text, today);
    if (!r || (!r.startDate && !r.endDate)) return;
    let cur = $el;
    for (let i = 0; i < 7; i++) {
      const p = cur.parent();
      if (!p.length || (p[0] as any).type !== "tag") break;
      cur = p;
      const link = cur.is("a[href]") ? cur : cur.find("a[href]").first();
      if (!link.length) continue;
      const item = partSel($, cur[0]);
      if (/^(body|main|section|ul|html)/.test(item)) break;
      const dates = partSel($, el);
      const key = item + "|" + dates;
      const prev = found.get(key);
      if (prev) prev.count++;
      else {
        const title = cur.find("h1,h2,h3,h4,[class*=title],[class*=heading]").first().text().replace(/\s+/g, " ").trim();
        found.set(key, { item, dates, count: 1, sampleTitle: title.slice(0, 60), sampleDate: text, sampleLink: absolute(link.attr("href"), pageUrl) ?? "" });
      }
      break;
    }
  });
  return [...found.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 6);
}

export function findDateElements($: CheerioAPI, today: string) {
  const out = new Map<string, { selector: string; text: string; parsed: string }>();
  $("body *").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 3) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text.length < 6 || text.length > 90) return;
    const r = parseDateRange(text, today);
    if (!r || (!r.startDate && !r.endDate)) return;
    // Skip wrappers whose single child holds the same text.
    const kids = $el.children();
    if (kids.length === 1 && kids.first().text().replace(/\s+/g, " ").trim() === text) return;
    const selector = selectorFor($, el);
    if (!out.has(selector)) out.set(selector, { selector, text, parsed: `${r.startDate ?? "…"} → ${r.endDate ?? (r.ongoing ? "ongoing" : "")}` });
  });
  return [...out.values()].slice(0, 10);
}

const WHATS_ON = /what-?s-?on|whatson|exhibitions?|events?|programme|shows?|calendar|listings/i;

export async function discover(url: string, fetcher = createFetcher({ mode: "live", minDelayMs: 1000 })): Promise<Discovery> {
  const today = todayLondon();
  const base: Discovery = { url, status: "ok", jsonLdEvents: 0, sampleEvents: [], feeds: [], whatsOnLinks: [], linkPatterns: [], dateElements: [], cards: [], timeElements: [] };
  let res;
  try {
    res = await fetcher.get(url);
  } catch (e) {
    return { ...base, status: e instanceof BlockedError ? "blocked" : "error", message: (e as Error).message };
  }
  const $ = load(res.body);
  const evs = jsonLdEvents($)
    .map((n) => rawFromJsonLd(n, res.url, today))
    .filter((r) => !!r);
  const host = new URL(res.url).host;
  const feeds = new Set<string>();
  $('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="text/calendar"]').each((_, el) => {
    const h = absolute($(el).attr("href"), res.url);
    if (h) feeds.add(h);
  });
  const hrefs: string[] = [];
  $("a[href]").each((_, a) => {
    const h = absolute($(a).attr("href"), res.url);
    if (!h) return;
    if (/\.ics(\?|$)|webcal:|\/feed\/?$|\.rss(\?|$)/i.test(h)) feeds.add(h);
    if (new URL(h).host === host) hrefs.push(h);
  });
  const whatsOn = [...new Set(hrefs.filter((h) => WHATS_ON.test(new URL(h).pathname)))].slice(0, 12);

  // Group same-host links by their path minus the last segment → candidate linkPatterns.
  const groups = new Map<string, { count: number; example: string; seen: Set<string> }>();
  for (const h of hrefs) {
    const path = new URL(h).pathname.replace(/\/$/, "");
    const segs = path.split("/").filter(Boolean);
    if (segs.length < 2) continue;
    const prefix = "/" + segs.slice(0, -1).join("/") + "/";
    const g = groups.get(prefix) ?? { count: 0, example: h, seen: new Set() };
    if (!g.seen.has(path)) {
      g.seen.add(path);
      g.count++;
    }
    groups.set(prefix, g);
  }
  const linkPatterns = [...groups.entries()]
    .map(([prefix, g]) => ({ prefix, count: g.count, example: g.example }))
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    ...base,
    finalUrl: res.url,
    jsonLdEvents: evs.length,
    sampleEvents: evs.slice(0, 3).map((e) => ({ title: e!.title, start: e!.dates.startDate, end: e!.dates.endDate, url: e!.url })),
    feeds: [...feeds].slice(0, 6),
    whatsOnLinks: whatsOn,
    linkPatterns,
    dateElements: findDateElements($, today),
    cards: findCards($, res.url, today),
    timeElements: $("time[datetime]")
      .slice(0, 6)
      .map((_, el) => ({ selector: selectorFor($, el), datetime: $(el).attr("datetime") ?? "" }))
      .get(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const urls = args.filter((a) => !a.startsWith("--"));
  if (!urls.length) {
    console.error("usage: npm run discover -- [--json] <url> [url…]");
    process.exit(2);
  }
  const fetcher = createFetcher({ mode: "live", minDelayMs: 1000 });
  const results = await Promise.all(urls.map((u) => discover(u, fetcher)));
  if (json) console.log(JSON.stringify(results, null, 2));
  else
    for (const r of results) {
      console.log(`\n== ${r.url}${r.finalUrl && r.finalUrl !== r.url ? ` → ${r.finalUrl}` : ""}`);
      console.log(`   status: ${r.status}${r.message ? ` (${r.message})` : ""}`);
      if (r.status !== "ok") continue;
      console.log(`   JSON-LD events: ${r.jsonLdEvents}`);
      for (const e of r.sampleEvents) console.log(`     • ${e.title} [${e.start ?? "…"} → ${e.end ?? ""}] ${e.url}`);
      if (r.feeds.length) console.log(`   feeds: ${r.feeds.join("  ")}`);
      if (r.whatsOnLinks.length) console.log(`   what's-on links: ${r.whatsOnLinks.slice(0, 6).join("  ")}`);
      for (const g of r.linkPatterns) console.log(`   links ${String(g.count).padStart(3)} × ${g.prefix}   e.g. ${g.example}`);
      for (const c of r.cards) console.log(`   cards ${String(c.count).padStart(3)} × item "${c.item}" dates "${c.dates}"  e.g. "${c.sampleTitle}" | "${c.sampleDate}" | ${c.sampleLink}`);
      for (const d of r.dateElements) console.log(`   date  ${d.selector}  "${d.text}"  ⇒ ${d.parsed}`);
      for (const t of r.timeElements) console.log(`   time  ${t.selector}  datetime="${t.datetime}"`);
    }
}
