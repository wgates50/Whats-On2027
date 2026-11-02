// Date logic shared by the client components. All dates are London calendar days (YYYY-MM-DD).

import type { WOEvent } from "./types";

export function londonToday(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(day + "T12:00:00Z"));

export const weekdayShort = (d: string) => fmt(d, { weekday: "short" });
export const weekdayLong = (d: string) => fmt(d, { weekday: "long" });
export const dayNum = (d: string) => fmt(d, { day: "numeric" });
export const monthShort = (d: string) => fmt(d, { month: "short" });
export const longDate = (d: string) => fmt(d, { day: "numeric", month: "long" });
export const shortDate = (d: string, withYear = false) => fmt(d, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

/** Is the event on (open/performing) on this day? */
export function isOnDay(e: WOEvent, day: string, today: string): boolean {
  const { startDate: s, endDate: end } = e;
  if (!s && !end) return !!e.ongoing && day >= today;
  if (s && !end) return e.ongoing ? s <= day : s === day;
  if (!s && end) return day >= today && day <= end;
  return s! <= day && day <= end!;
}

/** One-offs and short runs go in "Happening"; long runs go in "On now". */
export function isOneOff(e: WOEvent): boolean {
  if (e.ongoing) return false;
  if (e.startDate && !e.endDate) return true;
  if (e.startDate && e.endDate) return daysBetween(e.startDate, e.endDate) <= 3 && e.type !== "exhibition" && e.type !== "display";
  return false;
}

export type Badge = "new" | "opens-today" | "opening-soon" | "last-days" | "closes-today" | "free";

export function badges(e: WOEvent, day: string, today: string): Badge[] {
  const out: Badge[] = [];
  if (daysBetween(e.firstSeen, today) <= 7 && daysBetween(today, e.firstSeen) <= 0) out.push("new");
  if (!isOneOff(e)) {
    if (e.startDate === day) out.push("opens-today");
    else if (e.startDate && e.startDate > day && daysBetween(day, e.startDate) <= 7) out.push("opening-soon");
    if (e.endDate === day) out.push("closes-today");
    else if (e.endDate && daysBetween(day, e.endDate) <= 7 && daysBetween(day, e.endDate) > 0) out.push("last-days");
  }
  if (e.price === "free") out.push("free");
  return out;
}

export const BADGE_LABEL: Record<Badge, string> = {
  new: "New",
  "opens-today": "Opens today",
  "opening-soon": "Opening soon",
  "last-days": "Last days",
  "closes-today": "Closes today",
  free: "Free",
};

/** The short "when" text for a listing row, relative to the day being viewed. */
export function whenText(e: WOEvent, day: string): string {
  if (isOneOff(e)) {
    if (e.startDate && e.endDate) return `${shortDate(e.startDate)} – ${shortDate(e.endDate)}`;
    return e.startTime ?? "";
  }
  if (e.startDate && e.startDate > day) return `Opens ${shortDate(e.startDate)}`;
  if (e.endDate) {
    const yr = e.endDate.slice(0, 4) !== day.slice(0, 4);
    return `Until ${shortDate(e.endDate, yr)}`;
  }
  return "Ongoing";
}

export function rangeText(e: WOEvent): string {
  const s = e.startDate;
  const end = e.endDate;
  if (s && end) {
    const sameYear = s.slice(0, 4) === end.slice(0, 4);
    return `${shortDate(s, !sameYear)} – ${shortDate(end, true)}`;
  }
  if (s && !end) return e.ongoing ? `From ${shortDate(s, true)}` : `${weekdayShort(s)} ${shortDate(s, true)}${e.startTime ? `, ${e.startTime}` : ""}`;
  if (!s && end) return `Until ${shortDate(end, true)}`;
  return "Ongoing";
}

/** Minimal .ics for "add to calendar" (all-day for runs, 2h block for timed events). */
export function icsFor(e: WOEvent, venueName: string, day: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const d = (x: string) => x.replace(/-/g, "");
  let when: string[];
  if (isOneOff(e) && e.startTime) {
    const [h, m] = e.startTime.split(":").map(Number);
    const endH = String((h + 2) % 24).padStart(2, "0");
    const start = e.startDate ?? day;
    when = [`DTSTART;TZID=Europe/London:${d(start)}T${e.startTime.replace(":", "")}00`, `DTEND;TZID=Europe/London:${d(h + 2 >= 24 ? addDays(start, 1) : start)}T${endH}${String(m).padStart(2, "0")}00`];
  } else {
    const start = isOneOff(e) ? e.startDate ?? day : day;
    when = [`DTSTART;VALUE=DATE:${d(start)}`, `DTEND;VALUE=DATE:${d(addDays(start, 1))}`];
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//whats-on//EN",
    "BEGIN:VEVENT",
    `UID:${e.id.replace(/[^a-z0-9]/gi, "-")}-${d(day)}@whats-on`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(venueName)}`,
    `URL:${e.url}`,
    `DESCRIPTION:${esc(`${rangeText(e)} — ${e.url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Day of week (0 = Sunday) for a London calendar day. */
export const dayOfWeek = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();

/** True when the venue's regular hours say it's shut that day (unknown hours → false). */
export function venueClosedOn(hours: (string | null)[] | undefined, day: string): boolean {
  return !!hours && hours[dayOfWeek(day)] === null && hours.some((h) => h !== null);
}
