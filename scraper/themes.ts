// Themes for the daily maintenance task (MAINTAINING.md → "Themes"): what still needs tagging, and
// saving the answers to data/tags.json. No AI here — the task reads `todo` and writes the answers.
//
//   npm run themes -- todo [--events 250] [--people 50]   the theme list, then what to tag next
//   npm run themes -- apply <file>                        check the answers and save them
//   npm run themes -- check                               validate data/themes.json + data/tags.json
//
// Answers, one per line: "<kind> <id> <theme>,<theme>" — kind = venue | event | person, 1–3 theme ids
// (most telling first), or "-" when none fit. Lines naming an unknown thing or theme are rejected.

import { readFileSync, writeFileSync } from "node:fs";
import type { TagsFile, Theme, WOEvent } from "../lib/types.ts";
import { EMPTY_TAGS } from "../lib/themes.ts";
import { loadEvents, loadPeople, loadVenues, readJson } from "./config.ts";
import { todayLondon } from "./dates.ts";
import { applyAnswers, check, formatTags, themeList, todo, type Universe } from "./tagging.ts";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string, d: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};

const themes = readJson<Theme[]>("themes.json", []);
const tags: TagsFile = { ...EMPTY_TAGS, ...readJson<Partial<TagsFile>>("tags.json", {}) };
const universe = (): Universe => ({
  venues: loadVenues(),
  events: [...loadEvents().events, ...readJson<WOEvent[]>("manual-events.json", [])],
  people: loadPeople().people,
  today: todayLondon(),
});
const save = (t: TagsFile) => writeFileSync(new URL("../data/tags.json", import.meta.url), formatTags(t));

if (cmd === "todo") {
  const { lines, waiting } = todo(universe(), tags, themes, { events: flag("events", 250), people: flag("people", 50) });
  console.log(`# THEMES — use only these ids\n${themeList(themes).join("\n")}\n`);
  console.log(`# TO TAG — waiting: ${waiting.venues} venues, ${waiting.events} events, ${waiting.people} people (showing ${lines.length})`);
  console.log(`# Answer one per line: <kind> <id> <theme>,<theme>   (1–3 ids, most telling first; "-" if none fit)`);
  console.log(lines.join("\n"));
} else if (cmd === "apply") {
  if (!args[0]) throw new Error("usage: npm run themes -- apply <answers file>");
  const { tags: next, saved, rejected } = applyAnswers(readFileSync(args[0], "utf8"), tags, themes, universe());
  save(next);
  console.log(`saved ${saved.event} events, ${saved.venue} venues, ${saved.person} people → data/tags.json`);
  if (rejected.length) {
    console.log(`\nrejected ${rejected.length} line(s) — fix and apply them again:\n${rejected.join("\n")}`);
    process.exitCode = 1;
  }
} else if (cmd === "check") {
  const problems = check(themes, tags);
  console.log(problems.length ? problems.join("\n") : `ok: ${themes.length} themes · tagged ${Object.keys(tags.venues).length} venues, ${Object.keys(tags.events).length} events, ${Object.keys(tags.people).length} people`);
  if (problems.length) process.exitCode = 1;
} else {
  console.log("usage: npm run themes -- todo | apply <file> | check");
  process.exitCode = 1;
}
