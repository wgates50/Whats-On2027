"use client";

// Loads /data/app.json once per page load (the service worker keeps a copy for offline use).
import { useEffect, useState } from "react";
import type { AppData, PeopleData } from "./data";

let cached: AppData | null = null;
let pending: Promise<AppData> | null = null;

function fetchData(): Promise<AppData> {
  pending ??= fetch("/data/app.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<AppData>;
    })
    .then((d) => (cached = d))
    .finally(() => (pending = null));
  return pending;
}

export function useAppData(): { data: AppData | null; error: string | null } {
  const [data, setData] = useState<AppData | null>(cached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cached) return;
    let live = true;
    fetchData().then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);
  return { data, error };
}

let peopleCached: PeopleData | null = null;
let peoplePending: Promise<PeopleData> | null = null;

/** /data/people.json — only fetched when `enabled` (people pages, or you follow someone). */
export function usePeopleData(enabled = true): { people: PeopleData | null; error: string | null } {
  const [people, setPeople] = useState<PeopleData | null>(peopleCached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || peopleCached) {
      if (peopleCached) setPeople(peopleCached);
      return;
    }
    let live = true;
    peoplePending ??= fetch("/data/people.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PeopleData>;
      })
      .then((d) => (peopleCached = d))
      .finally(() => (peoplePending = null));
    peoplePending.then(
      (d) => live && setPeople(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return { people, error };
}
