// iCalendar (.ics) feeds — common for galleries, community venues and Meetup-style groups.

import type { IcsAdapterConfig } from "../../lib/types.ts";
import { addDays, londonDateTime } from "../dates.ts";
import { absolute, clean, textToPrice, type RawEvent } from "../extract.ts";
import type { AdapterContext, AdapterResult } from "./index.ts";

interface Prop {
  params: Record<string, string>;
  value: string;
}

export function parseIcs(text: string): Record<string, Prop>[] {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: Record<string, Prop>[] = [];
  let cur: Record<string, Prop> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]+)*):(.*)$/);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (const p of m[2].split(";").filter(Boolean)) {
        const [k, v] = p.split("=");
        params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, "");
      }
      const value = m[3].replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
      if (!(m[1] in cur)) cur[m[1]] = { params, value };
    }
  }
  return out;
}

/** ICS date/datetime → London date (+time). Floating & TZID=Europe/London times are already local. */
function icsDate(p: Prop | undefined): { date: string; time?: string; allDay: boolean } | null {
  if (!p) return null;
  const v = p.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date, allDay: true };
  if (m[7] === "Z") {
    const l = londonDateTime(`${date}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
    return l ? { ...l, allDay: false } : null;
  }
  // TZID other than London is rare for London venues; treat as local wall-clock time.
  const time = `${m[4]}:${m[5]}`;
  return { date, time: time === "00:00" ? undefined : time, allDay: false };
}

export async function runIcs(cfg: IcsAdapterConfig, ctx: AdapterContext): Promise<AdapterResult> {
  const res = await ctx.fetcher.get(cfg.url);
  const events: RawEvent[] = [];
  let skippedNoDates = 0;
  for (const ev of parseIcs(res.body)) {
    const s = icsDate(ev.DTSTART);
    let e = icsDate(ev.DTEND);
    if (!s) {
      skippedNoDates++;
      continue;
    }
    // All-day DTEND is exclusive.
    if (e?.allDay) e = { ...e, date: addDays(e.date, -1) };
    const endDate = e && e.date > s.date ? e.date : null;
    const title = clean(ev.SUMMARY?.value);
    if (!title) continue;
    const desc = clean(ev.DESCRIPTION?.value);
    events.push({
      url: absolute(ev.URL?.value, res.url) ?? res.url,
      title,
      dates: { startDate: s.date, endDate, startTime: endDate ? undefined : s.time },
      description: desc ? desc.slice(0, 280) : undefined,
      price: desc ? textToPrice(desc) : undefined,
      venueName: clean(ev.LOCATION?.value) || undefined,
      cancelled: ev.STATUS?.value === "CANCELLED",
    });
  }
  return { events, warnings: [], skippedNoDates, linksFound: events.length };
}
