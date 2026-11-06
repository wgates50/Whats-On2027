// What a device syncs (follows, people, saved and visited events, what you've seen) and how two copies
// are merged. Shared by the
// /api/sync route and the app, and unit-tested in scraper/sync.test.ts.

import type { Memo } from "./types";

export interface SyncDoc {
  v: 1;
  updatedAt: string; // ISO — when the lists last changed on any device
  follows: string[];
  people: string[];
  saved: string[];
  /** Themes you picked in Discover. */
  likes?: string[];
  /** Events you've been to. */
  visited?: string[];
  /** What saved/visited events were about (kept after they leave the listings). */
  memo?: Record<string, Memo>;
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

const WORD = /^[a-z0-9][a-z0-9-]{0,39}$/;
const words = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === "string" && WORD.test(w)).slice(0, max) : undefined);
/** Memos from untrusted JSON: well-formed entries only (bad ones are dropped, not the whole document). */
function cleanMemo(x: unknown): Record<string, Memo> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out: Record<string, Memo> = {};
  for (const [id, m] of Object.entries(x as Record<string, unknown>).slice(0, 3000)) {
    if (!ID.test(id) || !m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.t !== "string" || !o.t.trim() || typeof o.v !== "string" || (o.v && !ID.test(o.v))) continue;
    const th = words(o.th, 4);
    const kw = words(o.kw, 12);
    out[id] = {
      t: o.t.slice(0, 200),
      v: o.v,
      ...(typeof o.ty === "string" && /^[a-z]{2,20}$/.test(o.ty) ? { ty: o.ty as Memo["ty"] } : {}),
      ...(th?.length ? { th } : {}),
      ...(kw?.length ? { kw } : {}),
      ...(typeof o.d === "string" && DAY.test(o.d) ? { d: o.d } : {}),
    };
  }
  return out;
}

/** A well-formed SyncDoc from untrusted JSON, or null. */
export function cleanDoc(x: unknown): SyncDoc | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const follows = list(o.follows);
  const people = list(o.people ?? []);
  const saved = list(o.saved);
  const likes = list(o.likes ?? []);
  const visited = list(o.visited ?? []);
  const memo = cleanMemo(o.memo);
  const updatedAt = typeof o.updatedAt === "string" && !isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : null;
  if (!follows || !people || !saved || !likes || !visited || !updatedAt) return null;
  const seenUpTo = typeof o.seenUpTo === "string" && DAY.test(o.seenUpTo) ? o.seenUpTo : undefined;
  return {
    v: 1,
    updatedAt,
    follows,
    people,
    saved,
    ...(likes.length ? { likes } : {}),
    ...(visited.length ? { visited } : {}),
    ...(Object.keys(memo).length ? { memo } : {}),
    ...(seenUpTo ? { seenUpTo } : {}),
  };
}

/** Both devices changed since they last agreed: keep everything either of them has (and seen = the later). */
export function mergeDocs(a: Omit<SyncDoc, "v" | "updatedAt">, b: Omit<SyncDoc, "v" | "updatedAt">, updatedAt: string): SyncDoc {
  const union = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  const seenUpTo = later(a.seenUpTo, b.seenUpTo);
  const likes = union(a.likes ?? [], b.likes ?? []);
  const visited = union(a.visited ?? [], b.visited ?? []);
  const saved = union(a.saved, b.saved);
  // Memos: everything either side remembers (the fuller entry when both have one), for what's still kept.
  const memo: Record<string, Memo> = { ...a.memo };
  for (const [id, m] of Object.entries(b.memo ?? {})) if (!memo[id] || (m.th?.length ?? 0) >= (memo[id].th?.length ?? 0)) memo[id] = { ...memo[id], ...m };
  const keep = new Set([...saved, ...visited]);
  for (const id of Object.keys(memo)) if (!keep.has(id)) delete memo[id];
  return {
    v: 1,
    updatedAt,
    follows: union(a.follows, b.follows),
    people: union(a.people, b.people),
    saved,
    ...(likes.length ? { likes } : {}),
    ...(visited.length ? { visited } : {}),
    ...(Object.keys(memo).length ? { memo } : {}),
    ...(seenUpTo ? { seenUpTo } : {}),
  };
}
