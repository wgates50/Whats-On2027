import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateRange, londonDateTime, addDays } from "./dates.ts";

const TODAY = "2026-11-02";
const p = (s: string) => parseDateRange(s, TODAY);

test("full range with years", () => {
  assert.deepEqual(p("8 October 2026 – 14 February 2027"), { startDate: "2026-10-08", endDate: "2027-02-14", startTime: undefined });
});

test("start borrows year from end", () => {
  assert.deepEqual(p("4 March – 30 May 2027"), { startDate: "2027-03-04", endDate: "2027-05-30", startTime: undefined });
});

test("range crossing new year without start year", () => {
  assert.deepEqual(p("8 October – 14 February 2027"), { startDate: "2026-10-08", endDate: "2027-02-14", startTime: undefined });
});

test("bare day range", () => {
  assert.deepEqual(p("3–9 May 2027"), { startDate: "2027-05-03", endDate: "2027-05-09", startTime: undefined });
  assert.deepEqual(p("Wednesday 4 – Saturday 7 November 2026"), { startDate: "2026-11-04", endDate: "2026-11-07", startTime: undefined });
});

test("weekday ranges without years (Barbican style)", () => {
  assert.deepEqual(p("Fri 23 Oct — Mon 30 Nov 2026"), { startDate: "2026-10-23", endDate: "2026-11-30", startTime: undefined });
  assert.deepEqual(p("Fri 23 Oct — Mon 30 Nov"), { startDate: "2026-10-23", endDate: "2026-11-30", startTime: undefined });
});

test("until / now on until", () => {
  assert.deepEqual(p("Until 3 May 2027"), { startDate: null, endDate: "2027-05-03" });
  assert.deepEqual(p("Now on until 3 May 2027"), { startDate: null, endDate: "2027-05-03" });
});

test("opens (no end)", () => {
  assert.deepEqual(p("Opens 3 May 2027"), { startDate: "2027-05-03", endDate: null, ongoing: true });
});

test("single date with time", () => {
  assert.deepEqual(p("Sat 7 Nov 2026, 7.30pm"), { startDate: "2026-11-07", endDate: null, startTime: "19:30" });
  assert.deepEqual(p("23 Oct 2026 19:30"), { startDate: "2026-10-23", endDate: null, startTime: "19:30" });
  assert.deepEqual(p("Thursday 12 November, 7pm"), { startDate: "2026-11-12", endDate: null, startTime: "19:00" });
});

test("time is not mistaken for a day", () => {
  assert.deepEqual(p("10.30am, 23 November 2026"), { startDate: "2026-11-23", endDate: null, startTime: "10:30" });
});

test("price is not mistaken for a time", () => {
  assert.deepEqual(p("23 November 2026 · £12.50"), { startDate: "2026-11-23", endDate: null, startTime: undefined });
});

test("month-only ranges", () => {
  assert.deepEqual(p("October 2026 – January 2027"), { startDate: "2026-10-01", endDate: "2027-01-31", startTime: undefined });
  assert.deepEqual(p("October – December 2026"), { startDate: "2026-10-01", endDate: "2026-12-31", startTime: undefined });
  assert.deepEqual(p("March 2027"), { startDate: "2027-03-01", endDate: "2027-03-31" });
});

test("missing year infers next occurrence", () => {
  assert.deepEqual(p("23 January"), { startDate: "2027-01-23", endDate: null, startTime: undefined });
  assert.deepEqual(p("Until 3 May"), { startDate: null, endDate: "2027-05-03" });
});

test("ordinals and US style", () => {
  assert.deepEqual(p("Saturday 21st November 2026"), { startDate: "2026-11-21", endDate: null, startTime: undefined });
  assert.deepEqual(p("November 21, 2026"), { startDate: "2026-11-21", endDate: null, startTime: undefined });
});

test("words containing month abbreviations are ignored", () => {
  assert.equal(p("Decorative arts, Junior tickets"), null);
  assert.equal(p("Room 1"), null);
});

test("lists of dates become a range", () => {
  assert.deepEqual(p("Fri 6 Nov, Sat 7 Nov, Sun 8 Nov 2026"), { startDate: "2026-11-06", endDate: "2026-11-08", startTime: undefined });
});

test("ISO dates", () => {
  assert.deepEqual(p("2026-10-08"), { startDate: "2026-10-08", endDate: null, startTime: undefined });
  assert.deepEqual(p("2026-10-08 – 2027-01-03"), { startDate: "2026-10-08", endDate: "2027-01-03", startTime: undefined });
});

test("ongoing", () => {
  assert.deepEqual(p("Ongoing"), { startDate: null, endDate: null, ongoing: true });
  assert.deepEqual(p("Permanent collection display"), { startDate: null, endDate: null, ongoing: true });
});

test("garbage", () => {
  assert.equal(p(""), null);
  assert.equal(p("Book now"), null);
  assert.equal(p("Every Friday"), null);
});

test("HTML entities from raw markup", () => {
  assert.deepEqual(p("4 March &#x2013; 30 May 2027"), { startDate: "2027-03-04", endDate: "2027-05-30", startTime: undefined });
});

test("londonDateTime converts to London time", () => {
  assert.deepEqual(londonDateTime("2026-07-01T23:30:00Z"), { date: "2026-07-02", time: "00:30" });
  assert.deepEqual(londonDateTime("2026-12-01T19:30:00Z"), { date: "2026-12-01", time: "19:30" });
  assert.deepEqual(londonDateTime("2026-12-01T00:00:00Z"), { date: "2026-12-01", time: undefined });
  assert.deepEqual(londonDateTime("2027-09-18"), { date: "2027-09-18" });
  assert.equal(londonDateTime("not a date"), null);
});

test("addDays", () => {
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("keywords only count right before the date", () => {
  assert.deepEqual(p("London and online · Open to all · Monday 2 November 2026"), { startDate: "2026-11-02", endDate: null, startTime: undefined });
  assert.deepEqual(p("Closes Sunday, 17 January 2027"), { startDate: null, endDate: "2027-01-17" });
  assert.deepEqual(p("Opens Saturday, 18 September 2027"), { startDate: "2027-09-18", endDate: null, ongoing: true });
  assert.deepEqual(p("Free to visit until 3 May 2027"), { startDate: null, endDate: "2027-05-03" });
});

test("a year glued to the next word still counts (date and title in adjacent elements)", () => {
  assert.deepEqual(p("2 October 2018 – 9 December 2018Strange Days — Memories of the Future→"), { startDate: "2018-10-02", endDate: "2018-12-09", startTime: undefined });
  assert.deepEqual(p("12 June 2026 – 30 August 2026GENER8ION: VISIONS OF 2034→"), { startDate: "2026-06-12", endDate: "2026-08-30", startTime: undefined });
  assert.deepEqual(p("October 23, 2026Doors 7pm"), { startDate: "2026-10-23", endDate: null, startTime: "19:00" });
  assert.equal(p("9 marathons")?.startDate, undefined); // a month needs to end at a word boundary
});

test("a year on the start carries to an end without one", () => {
  assert.deepEqual(p("2 October 2018 – 9 December"), { startDate: "2018-10-02", endDate: "2018-12-09", startTime: undefined });
  assert.deepEqual(p("15 October 2025 – 1 February"), { startDate: "2025-10-15", endDate: "2026-02-01", startTime: undefined });
  // No year anywhere: still placed relative to today.
  assert.deepEqual(p("2 October – 9 December"), { startDate: "2026-10-02", endDate: "2026-12-09", startTime: undefined });
});

test("asides like (closed …) aren't the end of the range", () => {
  assert.deepEqual(p("2 December 2026 - 20 January 2027 (closed 24-26 December)"), { startDate: "2026-12-02", endDate: "2027-01-20", startTime: undefined });
  assert.deepEqual(p("Until 3 May 2027 (except Mondays)"), { startDate: null, endDate: "2027-05-03" });
  assert.deepEqual(p("Sat 7 Nov 2026 (7.30pm)"), { startDate: "2026-11-07", endDate: null, startTime: "19:30" }); // other brackets stay
});
