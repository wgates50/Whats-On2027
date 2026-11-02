// Deterministic event type + category rules (no AI).
//
// Evidence, strongest first:
//   1. URL path words            (/exhibitions/…, /talks/…)
//   2. specific schema.org type  (TheaterEvent, MusicEvent… — not ExhibitionEvent, which sites over-use)
//   3. strong title words        ("Exhibition Tour", "Friday Late", "In Conversation", "Workshop")
//   4. the site's own type label ("Display", "Talk"; then generic ones like "Art & design")
//   5. ExhibitionEvent schema type, weak title words ("concert", "exhibition")
//   6. source default, then venue kind — with long runs at museums/galleries treated as exhibitions

import type { Category, EventType, VenueKind } from "../lib/types.ts";

type Rules = [RegExp, EventType][];

const URL_RULES: Rules = [
  [/\/exhibitions?\//, "exhibition"],
  [/\/(lates?|after-hours)\//, "late"],
  [/\/(tours?)\//, "tour"],
  [/\/(talks?|lectures?|in-conversation)\//, "talk"],
  [/\/(workshops?|courses?|classes)\//, "workshop"],
  [/\/(families|family|kids|children)\//, "family"],
  [/\/(films?|cinema|screenings?)\//, "screening"],
  [/\/(concerts?|gigs?)\//, "concert"],
  // Not "/shows/": gallery sites use it for exhibitions.
  [/\/(productions?|theatre|performances?|comedy|dance|opera|ballet)\//, "show"],
];

const SCHEMA_RULES: Record<string, EventType> = {
  TheaterEvent: "show",
  ComedyEvent: "show",
  DanceEvent: "show",
  MusicEvent: "concert",
  ScreeningEvent: "screening",
  ChildrensEvent: "family",
  LiteraryEvent: "talk",
};

const TITLE_STRONG: Rules = [
  [/\b(lates|late opening|late night|friday late|museum late|late at|after hours)\b/i, "late"],
  [/(?<!grand )\b(tours?|guided walk)\b/i, "tour"],
  [/\b(talks?|in conversation|lecture|panel discussion|symposium|book launch|q ?& ?a|discussion)\b/i, "talk"],
  [/\b(podcast|live recording|stand-?up|comedy)\b/i, "show"],
  [/\b(workshops?|masterclass|life drawing|course)\b/i, "workshop"],
  [/\b(for families|family (day|fun|trail|workshop)|kids|toddlers?|half[- ]term)\b/i, "family"],
  [/\b(screening|film season)\b/i, "screening"],
  [/\b(skate|skating|ice rink)\b/i, "event"],
];

const LABEL_RULES: Rules = [
  [/\bexhibitions?\b/i, "exhibition"],
  [/\b(display|installation|collection)\b/i, "display"],
  [/\blates?\b/i, "late"],
  [/\btours?\b/i, "tour"],
  [/\b(talks?|lectures?|conversations?|discussions?|books?|debates?)\b/i, "talk"],
  [/\b(workshops?|courses?|class(es)?)\b/i, "workshop"],
  [/\b(famil(y|ies)|kids|children)\b/i, "family"],
  [/\b(films?|cinema|screenings?)\b/i, "screening"],
  [/\b(theatre|dance|opera|ballet|performance|comedy|musicals?|circus|podcasts?|cabaret)\b/i, "show"],
  [/\b(concerts?|classical|music|gigs?|jazz)\b/i, "concert"],
  [/\b(art|design|visual arts?)\b/i, "exhibition"], // generic section labels like "Art & design"
];

const TITLE_WEAK: Rules = [
  [/\b(concert|orchestra|symphony|recital|string quartet|choir)\b/i, "concert"],
  [/\bexhibition\b/i, "exhibition"],
];

const KIND_DEFAULT: Record<VenueKind, EventType> = {
  museum: "exhibition",
  "public-gallery": "exhibition",
  "commercial-gallery": "exhibition",
  garden: "exhibition",
  "arts-centre": "event",
  theatre: "show",
  "concert-hall": "concert",
  "live-venue": "show",
  "talks-venue": "talk",
  "comedy-club": "show",
};

/** Venues whose talks/tours/events are performances ("Shows") rather than art events. */
const PERFORMANCE_KINDS = new Set<VenueKind>(["theatre", "concert-hall", "live-venue", "talks-venue", "comedy-club"]);
const ART_KINDS = new Set<VenueKind>(["museum", "public-gallery", "commercial-gallery", "garden", "arts-centre"]);

const first = (rules: Rules, s: string | undefined) => (s ? rules.find(([re]) => re.test(s))?.[1] : undefined);

export function classifyType(opts: {
  url: string;
  title: string;
  typeLabel?: string;
  schemaType?: string;
  sourceDefault?: EventType;
  venueKind: VenueKind;
  /** Length of the run in days, if known (used for the "long run = exhibition" fallback). */
  spanDays?: number;
  /** A single date (or ≤3-day) event rather than a run. */
  oneOff?: boolean;
}): EventType {
  let path = "";
  try {
    path = new URL(opts.url).pathname.toLowerCase() + "/";
  } catch {
    /* ignore */
  }
  const schema = opts.schemaType ? SCHEMA_RULES[opts.schemaType] : undefined;
  const t =
    first(URL_RULES, path) ??
    schema ??
    first(TITLE_STRONG, opts.title) ??
    first(LABEL_RULES, opts.typeLabel) ??
    (opts.schemaType === "ExhibitionEvent" || opts.schemaType === "VisualArtsEvent" ? "exhibition" : undefined) ??
    first(TITLE_WEAK, opts.title) ??
    opts.sourceDefault;
  if (t) return t;
  if (ART_KINDS.has(opts.venueKind)) {
    if (opts.oneOff) return "event"; // a one-night thing at a gallery isn't an exhibition
    if ((opts.spanDays ?? 0) >= 21) return "exhibition";
  }
  return KIND_DEFAULT[opts.venueKind];
}

export function categoryFor(type: EventType, venueKind: VenueKind): Category {
  if (type === "exhibition" || type === "display") return "exhibitions";
  if (type === "show" || type === "concert" || type === "screening") return "shows";
  return PERFORMANCE_KINDS.has(venueKind) ? "shows" : "art-events";
}
