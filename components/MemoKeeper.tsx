"use client";

import { useEffect } from "react";
import { memoOf, readPrefs, usePrefs, useHydrated } from "@/lib/store";
import type { Memo } from "@/lib/types";
import { useAppData } from "@/lib/useData";
import { londonToday } from "@/lib/when";

/**
 * Keeps what you saved or went to remembered, and up to date: when a listing is still around (and its
 * themes have since been tagged better), its memo is refreshed. Memos keep counting for Discover after
 * the listing has gone. Renders nothing.
 */
export function MemoKeeper() {
  const hydrated = useHydrated();
  const { data } = useAppData();
  const { prefs, remember } = usePrefs();
  useEffect(() => {
    if (!hydrated || !data) return;
    const p = readPrefs();
    const byId = new Map(data.events.map((e) => [e.id, e]));
    const today = londonToday();
    const updates: Record<string, Memo> = {};
    for (const id of new Set([...p.saved, ...p.visited])) {
      const e = byId.get(id);
      if (!e) continue;
      const had = p.memo[id];
      // Keep the day you went; otherwise when it's on.
      const m = memoOf(e, had?.d ?? (e.startDate && e.startDate > today ? e.startDate : today));
      if (JSON.stringify(m) !== JSON.stringify(had)) updates[id] = m;
    }
    if (Object.keys(updates).length) remember(updates);
  }, [hydrated, data, prefs.saved, prefs.visited, remember]);
  return null;
}
