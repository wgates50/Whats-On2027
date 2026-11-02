// Deterministic (no AI) parsing of the date text found on London venue sites.
//
// Handled, for example:
//   "8 October 2026 – 14 February 2027"     "4 March – 30 May 2027"     "3–9 May 2027"
//   "Until 3 May 2027" / "Now on until …"     "Opens 3 May 2027"          "Fri 23 Oct — Mon 30 Nov 2026"
//   "23 Oct 2026, 7.30pm"                     "October 2026 – January 2027"
//   "2026-10-08" / "2026-10-08 – 2027-01-03"  "Ongoing" / "Permanent collection"
//
// Missing years are inferred relative to `today` (YYYY-MM-DD, London).

export interface ParsedRange {
  startDate: string | null; // null = already open (start unknown / not given)
  endDate: string | null; // null = single day, or no known end when `ongoing`
  ongoing?: boolean; // no known end date
  startTime?: string; // HH:MM, only for single-day events
}

const MONTH_RE =
  "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
// Same list, non-capturing, for use inside lookaheads (keeps capture-group numbering stable).
const MONTH_NC = MONTH_RE.replace("(", "(?:");
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const monthNum = (s: string) => MONTHS[s.slice(0, 3)];

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

interface Token {
  d?: number;
  m?: number;
  y?: number;
  at: number; // position in text
}

// One regex, alternatives tried left-to-right at each position:
//   1) "23 oct 2026" / "23 october"        2) "october 23, 2026" (US style)
//   3) "october 2026"                      4) bare day before a dash: "3 – 9 may"
//   5) bare month before a dash: "october – december 2026"
// A year may run straight into the next word when a page puts the date and the title in adjacent
// elements ("9 December 2018Strange Days…"), so years end at a non-digit rather than a word boundary.
const TOKEN_RE = new RegExp(
  [
    `\\b(\\d{1,2})\\s+${MONTH_RE}\\.?(?:,?\\s+(20\\d{2})(?!\\d)|\\b)`,
    `\\b${MONTH_RE}\\.?\\s+(\\d{1,2})\\b(?:,?\\s+(20\\d{2})(?!\\d))?`,
    `\\b${MONTH_RE}\\.?,?\\s+(20\\d{2})(?!\\d)`,
    `\\b(\\d{1,2})(?=\\s*[–—-]\\s*(?:[a-z]+\\s+)?\\d{1,2}\\s+${MONTH_NC})`,
    `\\b${MONTH_RE}\\b(?=\\s*[–—-])`,
  ].join("|"),
  "g",
);

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    const g = m.slice(1);
    let t: Token | null = null;
    if (g[0]) t = { d: +g[0], m: monthNum(g[1]), y: g[2] ? +g[2] : undefined, at };
    else if (g[3]) t = { m: monthNum(g[3]), d: +g[4], y: g[5] ? +g[5] : undefined, at };
    else if (g[6]) t = { m: monthNum(g[6]), y: +g[7], at };
    else if (g[8]) t = { d: +g[8], at };
    else if (g[9]) t = { m: monthNum(g[9]), at };
    if (t && (t.d === undefined || (t.d >= 1 && t.d <= 31))) out.push(t);
  }
  return out;
}

// Only when the keyword sits right before the date (optionally a weekday in between):
// "until 3 May", "Closes Sunday, 17 January" — but not "Open to all · Monday 2 November".
const WD = "(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?";
const END_ONLY = new RegExp(`\\b(until|till|to|ends?|ending|closes|closing|through)\\s+${WD}$`);
const START_ONLY = new RegExp(`\\b(from|opens|opening|starts|starting|launches|begins)\\s+${WD}$`);
const ONGOING = /\b(ongoing|permanent|always on|open now|open daily|collection display|free display)\b/;

/** The year an undated day most plausibly refers to: this year, unless that is >60 days ago. */
function inferYear(m: number, d: number, today: string): number {
  const ty = +today.slice(0, 4);
  const t = Date.parse(today + "T00:00:00Z");
  return Date.parse(isoDate(ty, m, d) + "T00:00:00Z") < t - 60 * 864e5 ? ty + 1 : ty;
}

function parseTime(text: string): string | undefined {
  const m =
    text.match(/(?<![£$€\d.])\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/i) ??
    text.match(/(?<![£$€\d.])\b(1[0-2]|0?[1-9])()\s*(am|pm)\b/i);
  if (!m) return undefined;
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${pad(h)}:${m[2] || "00"}`;
}

export function parseDateRange(raw: string | null | undefined, today: string): ParsedRange | null {
  if (!raw) return null;
  const text = raw
    .replace(/&#x2013;|&#8211;|&ndash;/g, "–")
    .replace(/&#x2014;|&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;| /g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "2 December – 20 January 2027 (closed 24–26 December)": the aside isn't part of the range.
  const aside = /\(\s*(?:closed|except|excluding|not open|no (?:performances?|shows?|events?))\b[^)]*\)/gi;
  if (aside.test(text)) {
    const r = parseDateRange(text.replace(aside, " "), today);
    if (r) return r;
  }
  const lower = text.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");

  // ISO dates (from <time datetime>, JSON-LD, or text): first = start, last = end.
  const isoMatches = lower.match(/\b20\d{2}-\d{2}-\d{2}\b/g);
  if (isoMatches) {
    const s = isoMatches[0];
    const e = isoMatches[isoMatches.length - 1];
    if (e < s) return null;
    return { startDate: s, endDate: e === s ? null : e, startTime: e === s ? parseTime(lower) : undefined };
  }

  // Strip times so "10.30am" can't be read as the 10th.
  const startTime = parseTime(lower);
  const noTimes = lower
    .replace(/(?<![£$€\d.])\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/g, " ")
    .replace(/\b\d{1,2}\s*(am|pm)\b/g, " ");

  const toks = tokenize(noTimes);
  if (toks.length === 0) {
    return ONGOING.test(lower) ? { startDate: null, endDate: null, ongoing: true } : null;
  }

  // Fill months/years right-to-left: "4 March – 30 May 2027", "3 – 9 May 2027", "Fri 23 Oct — Mon 30 Nov".
  const last = toks[toks.length - 1];
  if (last.m === undefined) return null;
  for (let i = toks.length - 2; i >= 0; i--) toks[i].m ??= toks[i + 1].m;
  // A year given only on an earlier date carries forward ("2 October 2018 – 9 December" ends in
  // December 2018, not this December); only a range with no year at all is placed relative to today.
  const anchor = toks.map((t) => t.y !== undefined).lastIndexOf(true);
  if (last.y === undefined && anchor >= 0) {
    for (let i = anchor + 1; i < toks.length; i++) {
      const prev = toks[i - 1];
      const t = toks[i];
      const wraps = t.m! < prev.m! || (t.m === prev.m && (t.d ?? 1) < (prev.d ?? 1));
      t.y = prev.y! + (wraps ? 1 : 0);
    }
  }
  last.y ??= inferYear(last.m, last.d ?? 1, today);
  for (let i = toks.length - 2; i >= 0; i--) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.y === undefined) {
      const later = (t.m! > next.m!) || (t.m === next.m && (t.d ?? 1) > (next.d ?? 1));
      t.y = later ? next.y! - 1 : next.y;
    }
  }

  const first = toks[0];
  const start = isoDate(first.y!, first.m!, first.d ?? 1);
  const end = isoDate(last.y!, last.m!, last.d ?? lastDay(last.y!, last.m!));
  if (end < start) return null;

  const before = noTimes.slice(0, first.at);
  if (toks.length === 1) {
    if (END_ONLY.test(before)) return { startDate: null, endDate: end };
    if (START_ONLY.test(before)) return { startDate: start, endDate: null, ongoing: true };
    if (first.d === undefined) return { startDate: start, endDate: end }; // "October 2026" = whole month
    return { startDate: start, endDate: null, startTime };
  }
  return { startDate: start, endDate: end === start ? null : end, startTime: end === start ? startTime : undefined };
}

/** ISO datetime (any offset) → London calendar date (+ time unless midnight). */
export function londonDateTime(value: string): { date: string; time?: string } | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const time = `${g("hour")}:${g("minute")}`;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: time === "00:00" ? undefined : time };
}

export function todayLondon(now = new Date()): string {
  return londonDateTime(now.toISOString())!.date;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
