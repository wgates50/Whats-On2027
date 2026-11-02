import { test } from "node:test";
import assert from "node:assert/strict";
import { staleEvents } from "./health.ts";
import type { WOEvent } from "../lib/types.ts";

const ev = (startDate: string, endDate: string | null, i = 0): WOEvent =>
  ({ id: `v:${i}`, venueId: "v", sourceId: "s", title: `E${i}`, url: "u", type: "exhibition", category: "exhibitions", startDate, endDate, firstSeen: "2026-11-01" }) as WOEvent;

test("a source whose events mostly started years ago is flagged (past events read as current)", () => {
  const archive = ["2016-09-09", "2017-10-05", "2018-10-02", "2019-10-01", "2026-10-14"].map((s, i) => ev(s, "2026-12-09", i));
  assert.equal(staleEvents(archive, "2026-11-02")?.length, 4);
  // A theatre aggregator with a few decades-long runs among many new shows is fine.
  const westEnd = [ev("1952-11-25", "2027-07-17"), ...Array.from({ length: 6 }, (_, i) => ev("2026-10-01", "2027-01-01", i + 1))];
  assert.equal(staleEvents(westEnd, "2026-11-02"), null);
  // Too few events to judge.
  assert.equal(staleEvents(archive.slice(0, 4), "2026-11-02"), null);
});
