// "Is this the same exhibition/show?" — used to merge listings of one thing from two sources
// (e.g. Tate's own site and Art Fund). Deterministic: shared title words + overlapping dates.

import type { WOEvent } from "../lib/types.ts";
import { normName } from "./venues.ts";

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
