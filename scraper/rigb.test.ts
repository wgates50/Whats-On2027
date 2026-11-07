// The Royal Institution's what's-on file (scraper/adapters/custom/rigb.ts), with entries shaped like the
// real ones. The live file is also recorded as a fixture (scraper/fixtures/royal-institution).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRiEvent, type RiEvent } from "./adapters/custom/rigb.ts";

const ev = (o: Partial<RiEvent>): RiEvent => ({
  title: "The neuroscience of sadness",
  excerpt: "Parastoo Hashemi explores the chemistry of our brains&#039; moods",
  link: "/whats-on/neuroscience-sadness",
  vocabOne: [{ label: "Adults" }],
  vocabTwo: [{ label: "In-person" }],
  hiddenNodeRefs: [{ label: "Biology and the human body" }, { label: "Talks and shows" }],
  content: '<article><img src="/sites/default/files/styles/teaser_thumb/public/images/x.jpg.webp?itok=1" alt=""></article>',
  calculated_start_date: "2026-11-07 19:00:00",
  calculated_end_date: "",
  ...o,
});

test("Royal Institution: an evening lecture, in London time", () => {
  assert.deepEqual(mapRiEvent(ev({})), {
    url: "https://www.rigb.org/whats-on/neuroscience-sadness",
    title: "The neuroscience of sadness",
    dates: { startDate: "2026-11-07", endDate: null, startTime: "19:00" },
    typeLabel: "Talk",
    image: "https://www.rigb.org/sites/default/files/styles/teaser_thumb/public/images/x.jpg.webp?itok=1",
    // No description: the file's excerpts are cut off, so the scrape reads it from the event's page.
  });
  // The file's times are UTC: a summer lecture listed at 18:00 starts at 7pm.
  assert.deepEqual(mapRiEvent(ev({ calculated_start_date: "2027-06-10 18:00:00" }))!.dates, { startDate: "2027-06-10", endDate: null, startTime: "19:00" });
});

test("Royal Institution: runs, family events, topics and livestream-only events", () => {
  // A live podcast recorded over several nights is a run.
  const run = mapRiEvent(ev({ title: "No Such Thing As A Fish: Live Podcast Recording", calculated_start_date: "2027-07-21 17:30:00", calculated_end_date: "2027-07-25 19:00:00" }))!;
  assert.deepEqual(run.dates, { startDate: "2027-07-21", endDate: "2027-07-25" });
  // Family shows say so; a topic alone ("Art, culture and society") isn't passed on as a label.
  const family = mapRiEvent(ev({ title: "How to build a chocolate bridge (family)", vocabOne: [{ label: "Children 12 and under" }, { label: "Families" }] }))!;
  assert.equal(family.typeLabel, "Family");
  assert.equal(mapRiEvent(ev({ hiddenNodeRefs: [{ label: "Art, culture and society" }] }))!.typeLabel, undefined);
  // In person and livestreamed is kept; livestream only isn't something to go to.
  assert.ok(mapRiEvent(ev({ vocabTwo: [{ label: "In-person" }, { label: "Livestream" }] })));
  assert.equal(mapRiEvent(ev({ vocabTwo: [{ label: "Livestream" }] })), null);
  // No date or link: unusable.
  assert.equal(mapRiEvent(ev({ calculated_start_date: "" })), null);
  assert.equal(mapRiEvent(ev({ link: "" })), null);
});
