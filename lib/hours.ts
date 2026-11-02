// OpenStreetMap opening_hours → a simple weekly schedule. Deterministic and deliberately partial:
// it understands the weekday/time rules venues actually use ("Tu-Su 10:00-18:00; Th 10:00-21:00",
// "Sa-Th 10:00-18:00", "Mo off", "24/7") and skips month/holiday/comment rules (flagged `partial`),
// so the app can say "Closed Mondays" but still tells people to check holidays on the venue's site.
//
// Week index 0 = Sunday … 6 = Saturday. A day is a string like "10:00–18:00" (or several ranges,
// comma-separated), or null when closed. Days no rule mentions are closed (OSM semantics).

export type Week = (string | null)[];
export interface ParsedHours {
  week: Week;
  partial: boolean; // some rules (holidays, months, comments) were ignored
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_ITEM = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:\\[[^\\]]*\\])?(?:\\s*-\\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?";
const DAY_SELECTOR = new RegExp(`^(${DAY_ITEM}(?:\\s*,\\s*${DAY_ITEM})*)(?=\\s|$|:)\\s*:?\\s*(.*)$`);

function expand(item: string): number[] | null {
  if (/^(PH|SH)/.test(item) || item.includes("[")) return null; // holidays / "first Monday" — not modelled
  const [a, b] = item.split(/\s*-\s*/);
  const from = DAYS.indexOf(a);
  if (from < 0) return null;
  if (!b) return [from];
  const to = DAYS.indexOf(b);
  if (to < 0) return null;
  const out: number[] = [];
  for (let d = from; ; d = (d + 1) % 7) {
    out.push(d);
    if (d === to) break;
  }
  return out;
}

const pad = (t: string) => t.replace(/^(\d):/, "0$1:");

export function parseOpeningHours(src: string | null | undefined): ParsedHours | null {
  const s = (src ?? "").trim();
  if (!s) return null;
  if (/^24\/7$/.test(s)) return { week: Array(7).fill("00:00–24:00"), partial: false };

  const week: (string | null | undefined)[] = Array(7).fill(undefined);
  let partial = false;
  let any = false;

  for (let rule of s.split(";")) {
    rule = rule.trim();
    if (!rule) continue;
    if (rule.includes("||")) {
      partial = true;
      rule = rule.split("||")[0].trim();
    }
    if (rule.includes('"')) {
      partial = true;
      rule = rule.replace(/"[^"]*"/g, "").trim();
    }
    // Month/date/week/easter rules aren't modelled.
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|week|easter)\b/i.test(rule)) {
      partial = true;
      continue;
    }
    let days = [0, 1, 2, 3, 4, 5, 6];
    let rest = rule;
    const m = rule.match(DAY_SELECTOR);
    if (m) {
      days = [];
      for (const item of m[1].split(/\s*,\s*/)) {
        const d = expand(item.trim());
        if (d) days.push(...d);
        else partial = true;
      }
      rest = m[2].trim();
      if (!days.length) continue; // e.g. "PH off"
    }
    if (/^(off|closed)$/i.test(rest)) {
      for (const d of days) week[d] = null;
      any = true;
      continue;
    }
    const ranges = rest.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\+?|\d{1,2}:\d{2}\+/g);
    if (!ranges) {
      partial = true; // "sunrise-sunset", "by appointment"…
      continue;
    }
    const text = ranges.map((r) => r.replace(/\s/g, "").split("-").map(pad).join("–")).join(", ");
    for (const d of days) week[d] = text;
    any = true;
  }
  if (!any) return null;
  return { week: week.map((v) => (v === undefined ? null : v)), partial };
}

/** "Closed Mondays", "Closed Mon & Tue" — or null if open every day / unknown. */
export function closedDaysText(week: Week | undefined): string | null {
  if (!week) return null;
  const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const closed = week.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (!closed.length || closed.length === 7) return null;
  if (closed.length === 1) return `Closed ${names[closed[0]]}`;
  return `Closed ${closed.map((i) => names[i].slice(0, 3)).join(" & ")}`;
}
