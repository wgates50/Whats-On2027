// Matching venue names from aggregators ("Drury Lane, Theatre Royal", ".../venue/her-majestys-theatre/")
// to our venue ids. Deterministic: exact normalised name, then same set of words. No fuzzy guessing,
// so a wrong match can't happen silently — unknown names are reported in health.json instead.

import type { Venue } from "../lib/types.ts";

export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|london)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokenKey = (s: string) => normName(s).split(" ").filter(Boolean).sort().join(" ");

/** ".../venue/the-bridge-theatre-2/" → "the bridge theatre" */
function nameFromUrl(u: string): string {
  try {
    const seg = new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";
    return seg.replace(/-\d+$/, "").replace(/-/g, " ");
  } catch {
    return u;
  }
}

export class VenueIndex {
  private exact = new Map<string, string>();
  private tokens = new Map<string, string>();

  constructor(readonly venues: Venue[]) {
    for (const v of venues) {
      for (const n of [v.name, ...(v.aliases ?? [])]) {
        const e = normName(n);
        const t = tokenKey(n);
        if (e && !this.exact.has(e)) this.exact.set(e, v.id);
        if (t && !this.tokens.has(t)) this.tokens.set(t, v.id);
      }
    }
  }

  match(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const n = /^https?:\/\//.test(name) ? nameFromUrl(name) : name;
    return this.exact.get(normName(n)) ?? this.tokens.get(tokenKey(n));
  }

  get(id: string): Venue | undefined {
    return this.venues.find((v) => v.id === id);
  }
}
