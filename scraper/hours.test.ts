import { test } from "node:test";
import assert from "node:assert/strict";
import { closedDaysText, parseOpeningHours } from "../lib/hours.ts";

const W = (s: string) => parseOpeningHours(s)?.week;

test("real London venue strings from OpenStreetMap", () => {
  // Tate Modern
  assert.deepEqual(W("Su-Th 10:00-18:00; Fr-Sa 10:00-21:00"), [
    "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–21:00", "10:00–21:00",
  ]);
  // National Gallery — a range that wraps around the week
  assert.deepEqual(W("Sa-Th 10:00-18:00; Fr 10:00-21:00"), [
    "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–18:00", "10:00–21:00", "10:00–18:00",
  ]);
  // Whitechapel — Monday not mentioned, so closed
  const wc = W("Tu-We,Fr-Su 11:00-18:00; Th 11:00-21:00")!;
  assert.equal(wc[1], null);
  assert.equal(wc[4], "11:00–21:00");
  assert.equal(closedDaysText(wc), "Closed Mondays");
});

test("off, several ranges, holidays and months", () => {
  const w = parseOpeningHours("Mo-Fr 9:30-13:00,14:00-17:30; Sa 10:00-16:00; Su off; PH off; Dec 25 off")!;
  assert.equal(w.week[1], "09:30–13:00, 14:00–17:30");
  assert.equal(w.week[6], "10:00–16:00");
  assert.equal(w.week[0], null);
  assert.equal(w.partial, true); // the Dec 25 rule was ignored
  assert.equal(closedDaysText(w.week), "Closed Sundays");
  assert.deepEqual(W("Tu-Su,PH 10:00-17:00")?.[1], null);
});

test("all-days forms", () => {
  assert.deepEqual(W("24/7"), Array(7).fill("00:00–24:00"));
  assert.deepEqual(W("10:00-17:30"), Array(7).fill("10:00–17:30"));
  assert.equal(closedDaysText(W("10:00-17:30")), null);
});

test("things it doesn't understand", () => {
  assert.equal(parseOpeningHours(""), null);
  assert.equal(parseOpeningHours('"by appointment"'), null);
  assert.equal(parseOpeningHours("sunrise-sunset"), null);
  assert.equal(parseOpeningHours("Mo[1] 10:00-12:00"), null); // only rule is "first Monday"
});
