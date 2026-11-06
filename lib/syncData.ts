// What a device syncs (follows, people, saved events, what you've seen) and how two copies are merged. Shared by the
// /api/sync route and the app, and unit-tested in scraper/sync.test.ts.

export interface SyncDoc {
  v: 1;
  updatedAt: string; // ISO — when the lists last changed on any device
  follows: string[];
  people: string[];
  saved: string[];
  /** Themes you picked in Discover. */
  likes?: string[];
  /** Listings first seen up to this day (YYYY-MM-DD) are no longer "new" (Mark all as seen). */
  seenUpTo?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The later of two YYYY-MM-DD days (either may be missing). */
const later = (a?: string, b?: string) => (!a ? b : !b || a >= b ? a : b);

/** 12 characters of Crockford base32 (no I, L, O, U), shown as XXXX-XXXX-XXXX: ~60 bits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function newCode(random: (n: number) => Uint8Array): string {
  const bytes = random(12);
  const s = [...bytes].map((b) => ALPHABET[b % 32]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Forgiving input: any case, spaces, missing dashes, O for 0 and I/L for 1. Null if it isn't a code. */
export function normaliseCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== 12 || /U/.test(s)) return null;
  const code = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  return CODE_RE.test(code) ? code : null;
}

const ID = /^[~\w][\w:~.-]{0,299}$/;
const list = (x: unknown): string[] | null =>
  Array.isArray(x) && x.length <= 5000 && x.every((s) => typeof s === "string" && ID.test(s)) ? [...new Set(x as string[])] : null;

/** A well-formed SyncDoc from untrusted JSON, or null. */
export function cleanDoc(x: unknown): SyncDoc | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const follows = list(o.follows);
  const people = list(o.people ?? []);
  const saved = list(o.saved);
  const likes = list(o.likes ?? []);
  const updatedAt = typeof o.updatedAt === "string" && !isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : null;
  if (!follows || !people || !saved || !likes || !updatedAt) return null;
  const seenUpTo = typeof o.seenUpTo === "string" && DAY.test(o.seenUpTo) ? o.seenUpTo : undefined;
  return { v: 1, updatedAt, follows, people, saved, ...(likes.length ? { likes } : {}), ...(seenUpTo ? { seenUpTo } : {}) };
}

/** Both devices changed since they last agreed: keep everything either of them has (and seen = the later). */
export function mergeDocs(a: Omit<SyncDoc, "v" | "updatedAt">, b: Omit<SyncDoc, "v" | "updatedAt">, updatedAt: string): SyncDoc {
  const union = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  const seenUpTo = later(a.seenUpTo, b.seenUpTo);
  const likes = union(a.likes ?? [], b.likes ?? []);
  return {
    v: 1,
    updatedAt,
    follows: union(a.follows, b.follows),
    people: union(a.people, b.people),
    saved: union(a.saved, b.saved),
    ...(likes.length ? { likes } : {}),
    ...(seenUpTo ? { seenUpTo } : {}),
  };
}
