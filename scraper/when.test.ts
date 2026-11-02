// The app's date helpers for on-sale times (lib/when.ts): London time either side of the clocks changing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { londonParts, notOnSaleYet, whenInstant } from "../lib/when.ts";

test("on-sale instants read in London time, relative to today", () => {
  assert.deepEqual(londonParts("2026-11-06T09:00:00Z"), { day: "2026-11-06", time: "09:00" }); // GMT
  assert.deepEqual(londonParts("2027-06-01T09:00:00Z"), { day: "2027-06-01", time: "10:00" }); // BST
  assert.deepEqual(londonParts("2026-10-31T23:30:00Z"), { day: "2026-10-31", time: "23:30" });
  assert.equal(whenInstant("2026-11-02T10:00:00Z", "2026-11-02"), "today 10:00");
  assert.equal(whenInstant("2026-11-03T09:30:00Z", "2026-11-02"), "tomorrow 09:30");
  assert.equal(whenInstant("2026-11-06T09:00:00Z", "2026-11-02"), "Fri 6 Nov, 09:00");
  assert.equal(whenInstant("2027-01-15T10:00:00Z", "2026-11-02"), "Fri 15 Jan 2027, 10:00");
  assert.equal(notOnSaleYet({ onSale: { start: "2026-11-06T09:00:00Z" } }, "2026-11-02T12:00:00Z"), true);
  assert.equal(notOnSaleYet({ onSale: { start: "2026-11-06T09:00:00Z" } }, "2026-11-06T09:00:01Z"), false);
  assert.equal(notOnSaleYet({}, "2026-11-02T12:00:00Z"), false);
});
