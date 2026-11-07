// "Is this the same exhibition/show?" — used to merge listings of one thing from two sources
// (e.g. Tate's own site and Art Fund). Deterministic: shared title words + overlapping dates.

import type { VenueKind, WOEvent } from "../lib/types.ts";
import { categoryFor } from "./classify.ts";
import { normName } from "./venues.ts";

const API_SOURCES = new Set(["ticketmaster", "skiddle"]);
/** What a ticketing API's classification can tell a default apart into. */
const API_TYPES = new Set<WOEvent["type"]>(["show", "concert", "talk", "screening"]);

/**
 * The venue's own listing wins de-duplication, but keeps what only the ticketing API knew: the
 * performance schedule, on-sale dates, performers, genres — and whether it's a gig, a show, a talk or a
 * film, which a gig venue's own site rarely says. Only a default type gives way (`typeGuessed`), never
 * one the listing showed: "… in Concert" stays a concert even where Ticketmaster files it under theatre.
 */
export function absorb(kept: WOEvent, dup: WOEvent, venueKind: VenueKind = "live-venue"): void {
  if (dup.schedule && !kept.schedule) kept.schedule = dup.schedule;
  if (dup.onSale && !kept.onSale) kept.onSale = dup.onSale;
  if (dup.people?.length) kept.people = [...new Set([...(kept.people ?? []), ...dup.people])];
  if (dup.genres?.length && !kept.genres) kept.genres = dup.genres;
  if (
    kept.typeGuessed &&
    !dup.typeGuessed &&
    API_SOURCES.has(dup.sourceId) &&
    API_TYPES.has(dup.type) &&
    (kept.type === "show" || kept.type === "concert" || kept.type === "event") &&
    kept.type !== dup.type
  ) {
    kept.type = dup.type;
    kept.category = categoryFor(dup.type, venueKind);
    delete kept.typeGuessed;
  }
}

const STOP = new Set(["exhibition", "and", "a", "an", "of", "at", "in", "the", "on", "to", "for", "with", "s"]);
const words = (t: string) => new Set(normName(t).split(" ").filter((w) => w && !STOP.has(w)));

type Dated = Pick<WOEvent, "title" | "startDate" | "endDate" | "ongoing">;

export function sameThing(a: Dated, b: Dated): boolean {
  const A = words(a.title);
  const B = words(b.title);
  if (!A.size || !B.size) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  const similar = shared / Math.min(A.size, B.size) >= 0.75 && shared >= Math.min(2, A.size, B.size);
  if (!similar) return false;
  const span = (e: Dated): [string, string] => [e.startDate ?? "0000", e.endDate ?? (e.ongoing ? "9999" : (e.startDate ?? "9999"))];
  const [as, ae] = span(a);
  const [bs, be] = span(b);
  return as <= be && bs <= ae;
}
