// Shared types for the scraper (writes data/*.json) and the app (reads it).
//
// Venues  = places you can follow (data/venues.json).
// Sources = where events come from (data/sources.json). A source is either one venue's own
//           website, or an aggregator (e.g. a theatre-listings site) that feeds many venues.
// Events  = what's on (data/events.json, generated; data/manual-events.json, hand-added).

export type Category = "exhibitions" | "shows" | "art-events";

export type EventType =
  | "exhibition"
  | "display" // free / collection displays
  | "show" // theatre, musicals, comedy, dance, opera, live podcasts
  | "concert"
  | "talk"
  | "tour"
  | "late"
  | "workshop"
  | "family"
  | "screening"
  | "event";

export type VenueKind =
  | "museum"
  | "public-gallery"
  | "commercial-gallery"
  | "arts-centre"
  | "theatre"
  | "concert-hall"
  | "live-venue" // podcasts, comedy, talks in big rooms (Apollo, Palladium, Union Chapel…)
  | "talks-venue"
  | "comedy-club"
  | "garden";

export interface Venue {
  id: string; // kebab-case, stable forever (follows are stored against it)
  name: string;
  aliases?: string[]; // other names aggregators use, for matching
  kind: VenueKind;
  area: string; // e.g. "South Bank", "Bloomsbury"
  website: string;
  lat?: number;
  lng?: number;
  closedDays?: number[]; // 0=Sun … 6=Sat, regular weekly closures
  /** The site blocks automated access, so events can only be added by hand. */
  manualOnly?: boolean;
  notes?: string;
}

export type AdapterConfig = PagesAdapterConfig | IcsAdapterConfig | CustomAdapterConfig;

export interface SourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** Single-venue source: every event belongs to this venue. */
  venueId?: string;
  /** Aggregator: events are matched to venues by name/aliases; unmatched ones are dropped. */
  aggregator?: boolean;
  adapter: AdapterConfig;
  defaults?: { type?: EventType; category?: Category };
  /** Keep only events whose title/url matches (regex string), e.g. to drop non-London sites. */
  include?: string;
  exclude?: string;
  /**
   * Keep only events whose venue text matches (regex string, case-insensitive), checked before venue
   * matching — e.g. ",\\s*London$" for a UK-wide aggregator, or "London" for a multi-city gallery
   * whose cards name the city. Events without venue text are dropped when this is set.
   */
  venueFilter?: string;
  /**
   * Only report unmatched venue names matching this regex (case-insensitive) in health/issues —
   * for city-wide APIs where most venues are irrelevant (pubs, clubs…) but missing theatres matter.
   */
  unmatchedReport?: string;
  notes?: string;
}

/** Listing page(s) → links → detail pages. JSON-LD Event data on any page is used first. */
export interface PagesAdapterConfig {
  type: "pages";
  /** Listing pages. `{page}` is replaced with 1..maxPages. */
  listUrls: string[];
  maxPages?: number;
  /**
   * Regex (string) for detail-page URLs, matched against absolute hrefs — and against <loc> entries,
   * so a sitemap.xml works as a listing page. Omit to use only listing-page JSON-LD / cards.
   */
  linkPattern?: string;
  /** Cap on detail pages fetched per run (politeness). Default 60. With `cacheDays`, cached pages don't count. */
  maxLinks?: number;
  /**
   * Remember what each detail page said for ~this many days (data/cache/<sourceId>.json), so daily runs
   * only fetch new pages plus a staggered trickle of refreshes. For big listings such as sitemaps.
   */
  cacheDays?: number;
  /**
   * Read events straight from repeated cards on the listing page — one request per page, no
   * detail pages. Selectors are relative to each card. (Run `npm run discover -- <url>` for suggestions.)
   */
  cards?: {
    item: string;
    /** Selector for the card's date text. Optional when `dateFromUrl` is given. */
    dates?: string;
    /**
     * Regex with named groups y, m, d (and optionally H, M) to read the date from the card's link,
     * e.g. "/whats-on/(?<y>\\d{4})(?<m>\\d{2})(?<d>\\d{2})(?<H>\\d{2})(?<M>\\d{2})$".
     */
    dateFromUrl?: string;
    title?: string; // default: first h1–h4 / [class*=title] in the card
    link?: string; // default: the card itself if it is an <a>, else its first a[href]
    venue?: string; // multi-venue sites / aggregators
    typeLabel?: string; // e.g. a "Exhibition" / "Talk" tag on the card
    image?: string; // default: first img
    description?: string;
  };
  /** CSS selectors on the detail page, used when it has no JSON-LD Event. */
  detail?: {
    title?: string; // default: og:title / h1
    dates?: string; // element whose text holds the date range
    timeElements?: string; // selector for <time datetime> elements (first = start, last = end)
    venue?: string; // aggregators: element whose text names the venue
    description?: string; // default: og:description / meta description
    price?: string;
  };
}

export interface IcsAdapterConfig {
  type: "ics";
  url: string;
}

export interface CustomAdapterConfig {
  type: "custom";
  module: string; // file in scraper/adapters/custom/<module>.ts
  options?: Record<string, unknown>;
}

export interface WOEvent {
  id: string; // `${venueId}:${slug}` — stable across runs
  venueId: string;
  sourceId: string; // "manual" for hand-added
  title: string;
  url: string;
  type: EventType;
  category: Category;
  /**
   * Date semantics:
   *  start & end         → runs start..end
   *  start, no end       → single day (or from start with no known end if `ongoing`)
   *  no start, end       → already on, until end
   *  neither + ongoing   → always on (permanent/free display)
   */
  startDate: string | null;
  endDate: string | null;
  ongoing?: boolean;
  startTime?: string; // HH:MM London time, single-session events only
  image?: string;
  description?: string;
  price?: "free" | "paid";
  firstSeen: string; // YYYY-MM-DD the app first saw it — drives the "new" feed
}

export type HealthStatus =
  | "ok"
  | "skipped" // not run: an API key isn't configured (not an error)
  | "error" // network/parse failure
  | "blocked" // 401/403/429 or robots.txt disallows — do NOT try to get around this
  | "empty" // 0 events where there were some
  | "dropped" // far fewer events than last time
  | "invalid"; // events failed validation (bad dates etc.)

export interface SourceHealth {
  sourceId: string;
  status: HealthStatus;
  count: number;
  previousCount: number;
  message?: string;
  checkedAt: string; // ISO timestamp
  lastOk?: string;
  lastOkCount?: number; // baseline for "dropped"
  consecutiveFailures: number;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  exhibitions: "Exhibitions",
  shows: "Shows",
  "art-events": "Art events",
};
