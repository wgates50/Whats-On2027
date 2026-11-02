// Health checks on a source's normalised events that aren't about a single event.

import type { WOEvent } from "../lib/types.ts";
import { addDays } from "./dates.ts";

/**
 * Past events being read as current. In Nov 2026 a year glued to the next word ("9 December
 * 2018Strange Days") made 180 Studios' whole archive "end" this December: 33 of its 36 events had
 * started years ago. A few long runs are normal (West End shows, collection displays), so this only
 * fires when they're most of a source (5+ events). Returns the suspect events, or null if fine.
 */
export function staleEvents(events: WOEvent[], today: string): WOEvent[] | null {
  const yearAgo = addDays(today, -365);
  const stale = events.filter((e) => e.startDate && e.startDate < yearAgo && (e.endDate ?? "") >= today);
  return events.length >= 5 && stale.length > events.length / 2 ? stale : null;
}
