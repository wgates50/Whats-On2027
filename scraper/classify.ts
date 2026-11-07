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
  [/\b(screening|film (season|festival|programme))\b/i, "screening"],
  [/\b(skate|skating|ice rink)\b/i, "event"],
];

/** "… World Tour", "UK Tour 2026", "Anniversary Live Tour": a touring act, not a guided tour… */
const TOURING_ACT =
  /\b(world|uk|eu|euro|europe|european|europa|international|arena|stadium|farewell|reunion|anniversary|headline|live|concert|comedy|stand-?up|christmas|band|album|greatest hits)\s+tour\b|\btour\s*[-–:]?\s*20\d\d\b|\b20\d\d\s+tour\b/i;
/** …unless it says it's the guided kind. */
const GUIDED =
  /\b(guided|backstage|behind the scenes|walking|building|architecture|architectural|heritage|history|historic|bsl|audio[- ]described|touch|curators?|exhibition|gallery|highlights|spotlight|members'?|private)\b/i;

const LABEL_RULES: Rules = [
  [/\bexhibition views?\b/i, "event"], // members' previews of an exhibition, not the exhibition
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
  [/\b(study days?|conferences?)\b/i, "talk"],
  // Recurring activities across a season, not exhibitions (the V&A's "Drop-in", "Open studio").
  [/\b(drop[- ]ins?|open studios?|special events?)\b/i, "event"],
  [/\b(art|design|visual arts?)\b/i, "exhibition"], // generic section labels like "Art & design"
];

const TITLE_WEAK: Rules = [
  [/\b(concert|orchestra|symphony|recital|string quartet|choir)\b/i, "concert"],
  // Gig billing, for venues whose listings don't say gig or comedy: "+ support", "with special guests",
  // "all night long", "DJ set". Weak, so a label still wins (a comedian's "+ special guests", the V&A's
  // DJ-set drop-ins), as does "stand-up"/"comedy" in the title.
  [/(\+|\bplus)\s*(support|(very )?special guests?)\b|\bwith (very )?special guests?\b|\ball night( long)?\b|\bdj sets?\b/i, "concert"],
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

export interface TypeInput {
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
}

/** What the listing itself says the type is (its URL, structured data, title or label), if anything. */
export function typeEvidence(opts: TypeInput): EventType | undefined {
  let path = "";
  try {
    path = new URL(opts.url).pathname.toLowerCase() + "/";
  } catch {
    /* ignore */
  }
  const schema = opts.schemaType ? SCHEMA_RULES[opts.schemaType] : undefined;
  const touring = TOURING_ACT.test(opts.title) && !GUIDED.test(opts.title);
  return (
    first(URL_RULES, path) ??
    schema ??
    first(touring ? TITLE_STRONG.filter(([, type]) => type !== "tour") : TITLE_STRONG, opts.title) ??
    first(LABEL_RULES, opts.typeLabel) ??
    (opts.schemaType === "ExhibitionEvent" || opts.schemaType === "VisualArtsEvent" ? "exhibition" : undefined) ??
    first(TITLE_WEAK, opts.title)
  );
}

/** The listing's own evidence, else the source's default, else a guess from the kind of venue. */
export function classifyType(opts: TypeInput): EventType {
  const t = typeEvidence(opts) ?? opts.sourceDefault;
  if (t) return t;
  if (ART_KINDS.has(opts.venueKind)) {
    if (opts.oneOff) return "event"; // a one-night thing at a gallery isn't an exhibition
    if ((opts.spanDays ?? 0) >= 21) return "exhibition";
  }
  return KIND_DEFAULT[opts.venueKind];
}

/** Courses you enrol on — the V&A Academy's, astronomy courses, "short course", teachers' CPD. */
const COURSE_TITLE =
  /\b(year|short|online|evening|weekend|one-day|day|foundation|intermediate|introductory|beginners'?|professional development)\s+courses?\b|\bcpd\b/i;
const FOR_SCHOOLS = /\bschools?\s*(&|and)\s*colleges\b|\bschools:\s|\bschools'?\s+(screen|workshops?|sessions?|programme)\b|\bks[1-5]\b|\beyfs\b/i;
/** Sport isn't what the app is for: "Haringey Huskies v Oxford Stars", darts, snooker… */
const SPORT = /\b(darts|snooker|ice hockey|boxing|wrestling)\b|^(?!.*\b(concert|live|show|musical|play|film|screening|comedy)\b)[^:]{2,40}\sv\s[^:]{2,40}$/i;
const ONLINE = /^\s*online\b|\(\s*(online|livestream|live stream)\s*\)|\blivestream\b|\bevento online\b|\bonline (event|talk|lecture|session|workshop)\b/i;

/**
 * Listings that aren't things to go to on a day: enrolment courses, sessions for school groups, a
 * season's overview page, sport, and online-only events (often a livestream of a talk listed in person too).
 * Returns why (they're left out), or null.
 */
export function notAnEvent(r: { url: string; title: string; typeLabel?: string }): string | null {
  const label = r.typeLabel?.trim() ?? "";
  let path = "";
  try {
    path = new URL(r.url).pathname.toLowerCase() + "/";
  } catch {
    /* ignore */
  }
  if (/\bcourses?\b|professional development|\bcpd\b/i.test(label) || COURSE_TITLE.test(r.title) || /\/(courses?|[\w-]+-courses)\//.test(path)) return "course";
  if (/^seasons?$/i.test(label)) return "season overview";
  if (FOR_SCHOOLS.test(r.title)) return "for schools";
  if (ONLINE.test(r.title)) return "online";
  if (SPORT.test(r.title)) return "sport";
  return null;
}

export function categoryFor(type: EventType, venueKind: VenueKind): Category {
  if (type === "exhibition" || type === "display") return "exhibitions";
  if (type === "show" || type === "concert" || type === "screening") return "shows";
  return PERFORMANCE_KINDS.has(venueKind) ? "shows" : "art-events";
}
