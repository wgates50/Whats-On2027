// Add a hand-entered event from an "Add an event" GitHub issue form to data/manual-events.json.
// Run by .github/workflows/add-event.yml (no AI). Only the repo owner's issues are accepted.
//
// Reads the issue from $GITHUB_EVENT_PATH (or a JSON file passed as the first argument, for testing).
// Prints a result line that the workflow posts back as a comment.

import { appendFileSync, readFileSync } from "node:fs";
import type { EventType, WOEvent } from "../lib/types.ts";
import { categoryFor } from "./classify.ts";
import { loadVenues, readJson, writeJson } from "./config.ts";
import { parseDateRange, todayLondon } from "./dates.ts";
import { slugify } from "./normalize.ts";
import { VenueIndex } from "./venues.ts";

/** GitHub issue forms render as "### Label\n\nvalue" blocks. */
export function parseIssueForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const key = p.slice(0, nl).trim().toLowerCase();
    const value = p.slice(nl + 1).trim();
    out[key] = value === "_No response_" ? "" : value;
  }
  return out;
}

const TYPES: EventType[] = ["exhibition", "display", "show", "concert", "talk", "tour", "late", "workshop", "family", "screening", "event"];

export function eventFromForm(f: Record<string, string>, venues: VenueIndex, today: string): WOEvent | string {
  const title = f["event title"]?.trim();
  if (!title) return "Missing event title.";
  const venueText = f["venue"]?.trim() ?? "";
  const venueId = venues.get(venueText)?.id ?? venues.match(venueText);
  if (!venueId) return `Couldn't match venue "${venueText}" — use the venue's name as shown in the app (or request the venue first).`;
  const venue = venues.get(venueId)!;
  const start = f["start date"]?.trim();
  const end = f["end date (optional)"]?.trim();
  const dates = parseDateRange([start, end].filter(Boolean).join(" – "), today);
  if (!dates || (!dates.startDate && !dates.endDate)) return `Couldn't read the dates "${start}" / "${end}" — use e.g. 2026-11-21 or 21 November 2026.`;
  const timeRaw = f["start time (optional)"]?.trim();
  const time = timeRaw?.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  const typeRaw = (f["type"] ?? "").toLowerCase().trim();
  const type: EventType = TYPES.includes(typeRaw as EventType) ? (typeRaw as EventType) : "event";
  const priceRaw = (f["price"] ?? "").toLowerCase();
  let url = f["link"]?.trim() ?? "";
  try {
    url = new URL(url).toString();
  } catch {
    url = venue.website;
  }
  const ev: WOEvent = {
    id: `${venueId}:manual-${slugify(`${title}-${dates.startDate ?? dates.endDate}`)}`,
    venueId,
    sourceId: "manual",
    title,
    url,
    type,
    category: categoryFor(type, venue.kind),
    startDate: dates.startDate,
    endDate: dates.endDate,
    firstSeen: today,
  };
  if (time && !dates.endDate) ev.startTime = `${time[1].padStart(2, "0")}:${time[2]}`;
  if (priceRaw === "free" || priceRaw === "paid") ev.price = priceRaw;
  const notes = f["notes (optional)"]?.trim();
  if (notes) ev.description = notes.slice(0, 280);
  return ev;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("No GITHUB_EVENT_PATH");
  const payload = JSON.parse(readFileSync(eventPath, "utf8"));
  const issue = payload.issue;
  const owner = payload.repository?.owner?.login;
  const setOutput = (k: string, v: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<EOF\n${v}\nEOF\n`);

  if (!issue || issue.user?.login !== owner) {
    setOutput("result", "Ignored: only the repository owner can add events.");
    setOutput("ok", "false");
    process.exit(0);
  }
  const venues = new VenueIndex(loadVenues());
  const ev = eventFromForm(parseIssueForm(issue.body ?? ""), venues, todayLondon());
  if (typeof ev === "string") {
    setOutput("result", `⚠️ ${ev} Edit the issue to try again.`);
    setOutput("ok", "false");
    console.log(ev);
    process.exit(0);
  }
  const list = readJson<WOEvent[]>("manual-events.json", []);
  const i = list.findIndex((e) => e.id === ev.id);
  if (i >= 0) list[i] = { ...ev, firstSeen: list[i].firstSeen };
  else list.push(ev);
  list.sort((a, b) => (a.startDate ?? a.endDate ?? "").localeCompare(b.startDate ?? b.endDate ?? ""));
  writeJson("manual-events.json", list);
  const when = ev.endDate ? `${ev.startDate ?? "now"} → ${ev.endDate}` : `${ev.startDate}${ev.startTime ? ` ${ev.startTime}` : ""}`;
  setOutput("result", `✅ Added **${ev.title}** at ${venues.get(ev.venueId)!.name} (${when}). It will appear in the app after the next deploy.`);
  setOutput("ok", "true");
  console.log(`added ${ev.id}`);
}
