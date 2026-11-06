"use client";

// Your follows and saved events, kept on this device (localStorage). Wrapped so the app still
// works if storage is unavailable (private browsing, blocked site data).

import { useCallback, useSyncExternalStore } from "react";
import type { Memo, WOEvent } from "./types";

export interface Prefs {
  follows: string[]; // venue ids
  people: string[]; // performer ids (data/people.json)
  saved: string[]; // event ids
  visited: string[]; // event ids you've been to
  /** What each saved or visited event was about, so your taste outlives the listing. */
  memo: Record<string, Memo>;
  likes: string[]; // theme ids you picked in Discover
  onlyMine: boolean; // calendar: only followed places and people
  /** "Mark all as seen": listings first seen on or before this day (YYYY-MM-DD) aren't new to you. */
  seenUpTo?: string;
  /** When follows/people/saved last changed (ISO), on this device or via sync. */
  updatedAt?: string;
}

/** The later of two YYYY-MM-DD days (either may be missing). */
export const laterDay = (a?: string, b?: string): string => (!a ? (b ?? "") : !b || a >= b ? a : b);

const KEY = "whatson:v1";
const EMPTY: Prefs = { follows: [], people: [], saved: [], visited: [], memo: {}, likes: [], onlyMine: true };

/** A saved or visited event, remembered (title, place, kind, themes, distinctive words, when). */
export const memoOf = (e: WOEvent, d: string): Memo => ({
  t: e.title.slice(0, 120),
  v: e.venueId,
  ty: e.type,
  ...(e.themes?.length ? { th: e.themes } : {}),
  ...(e.kw?.length ? { kw: e.kw } : {}),
  d,
});

/** Only keep memos for things still saved or visited. */
export const keepMemos = (memo: Record<string, Memo>, saved: string[], visited: string[]) => {
  const keep = new Set([...saved, ...visited]);
  return Object.fromEntries(Object.entries(memo).filter(([id]) => keep.has(id)));
};
let current: Prefs | null = null;
const listeners = new Set<() => void>();

function load(): Prefs {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Prefs>) } : EMPTY;
  } catch {
    current = EMPTY;
  }
  return current;
}

const localChangeListeners = new Set<() => void>();

function save(next: Prefs, touched = true) {
  current = touched ? { ...next, updatedAt: new Date().toISOString() } : next;
  if (touched) localChangeListeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory for this session */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, load, () => EMPTY);
  const toggle = useCallback((key: "follows" | "people" | "saved" | "likes" | "visited", id: string, memo?: Memo) => {
    const p = load();
    const has = p[key].includes(id);
    const next = { ...p, [key]: has ? p[key].filter((x) => x !== id) : [...p[key], id] };
    // Remember what a newly saved/visited event was; forget it once it's neither.
    const memos = !has && memo ? { ...p.memo, [id]: { ...p.memo[id], ...memo } } : p.memo;
    save({ ...next, memo: keepMemos(memos, next.saved, next.visited) });
  }, []);
  const set = useCallback((patch: Partial<Prefs>) => save({ ...load(), ...patch }), []);
  /** Remember (or refresh) what saved/visited events were about — only for ones still saved or visited. */
  const remember = useCallback((memos: Record<string, Memo>) => {
    const p = load();
    const next = keepMemos({ ...p.memo, ...memos }, p.saved, p.visited);
    if (JSON.stringify(next) !== JSON.stringify(p.memo)) save({ ...p, memo: next });
  }, []);
  /** Everything first seen up to this day is no longer new (never moves backwards). */
  const markSeen = useCallback((upTo: string) => {
    const p = load();
    if (laterDay(p.seenUpTo, upTo) !== p.seenUpTo) save({ ...p, seenUpTo: laterDay(p.seenUpTo, upTo) });
  }, []);
  return {
    prefs,
    toggleFollow: (id: string) => toggle("follows", id),
    togglePerson: (id: string) => toggle("people", id),
    toggleSaved: (id: string, memo?: Memo) => toggle("saved", id, memo),
    /** "I've been": the strongest signal for Discover (and kept after the listing has gone). */
    toggleVisited: (id: string, memo?: Memo) => toggle("visited", id, memo),
    toggleLike: (id: string) => toggle("likes", id),
    remember,
    set,
    markSeen,
  };
}

/** True once the component has hydrated (avoids flashing server-rendered empty prefs as real). */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// For device sync (lib/sync.ts): read and replace the lists outside React, and hear about changes.
export const readPrefs = (): Prefs => load();
/** Replace prefs with what sync agreed on, keeping its updatedAt (so it doesn't count as a new change). */
export const writeSyncedPrefs = (next: Prefs) => save(next, false);
/** Changes made on this device (not ones that arrived by sync). */
export function onLocalChange(l: () => void): () => void {
  localChangeListeners.add(l);
  return () => localChangeListeners.delete(l);
}
