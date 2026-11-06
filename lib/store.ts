"use client";

// Your follows and saved events, kept on this device (localStorage). Wrapped so the app still
// works if storage is unavailable (private browsing, blocked site data).

import { useCallback, useSyncExternalStore } from "react";

export interface Prefs {
  follows: string[]; // venue ids
  people: string[]; // performer ids (data/people.json)
  saved: string[]; // event ids
  onlyMine: boolean; // calendar: only followed places and people
  /** When follows/people/saved last changed (ISO), on this device or via sync. */
  updatedAt?: string;
}

const KEY = "whatson:v1";
const EMPTY: Prefs = { follows: [], people: [], saved: [], onlyMine: true };
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
  const toggle = useCallback((key: "follows" | "people" | "saved", id: string) => {
    const p = load();
    const has = p[key].includes(id);
    save({ ...p, [key]: has ? p[key].filter((x) => x !== id) : [...p[key], id] });
  }, []);
  const set = useCallback((patch: Partial<Prefs>) => save({ ...load(), ...patch }), []);
  return {
    prefs,
    toggleFollow: (id: string) => toggle("follows", id),
    togglePerson: (id: string) => toggle("people", id),
    toggleSaved: (id: string) => toggle("saved", id),
    set,
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
