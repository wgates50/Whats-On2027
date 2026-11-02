import { test } from "node:test";
import assert from "node:assert/strict";
import { eventFromForm, parseIssueForm } from "./add-event.ts";
import { loadVenues } from "./config.ts";
import { VenueIndex } from "./venues.ts";

// What GitHub renders for the "Add an event" issue form.
const BODY = `### Event title

The Rest Is Science: Live

### Venue

Southbank Centre

### Start date

21 November 2026

### End date (optional)

_No response_

### Start time (optional)

19:30

### Type

show

### Price

paid

### Link

https://www.southbankcentre.co.uk/whats-on/the-rest-is-science

### Notes (optional)

Royal Festival Hall`;

const venues = new VenueIndex(loadVenues());

test("parses the issue form into fields", () => {
  const f = parseIssueForm(BODY);
  assert.equal(f["event title"], "The Rest Is Science: Live");
  assert.equal(f["end date (optional)"], "");
  assert.equal(f["start time (optional)"], "19:30");
});

test("builds a manual event", () => {
  const ev = eventFromForm(parseIssueForm(BODY), venues, "2026-11-02");
  assert.ok(typeof ev !== "string", String(ev));
  assert.equal(ev.venueId, "southbank-centre");
  assert.equal(ev.startDate, "2026-11-21");
  assert.equal(ev.endDate, null);
  assert.equal(ev.startTime, "19:30");
  assert.equal(ev.type, "show");
  assert.equal(ev.category, "shows");
  assert.equal(ev.price, "paid");
  assert.equal(ev.sourceId, "manual");
  assert.equal(ev.description, "Royal Festival Hall");
});

test("venue can be matched by alias", () => {
  const body = BODY.replace("Southbank Centre", "Royal Festival Hall");
  const ev = eventFromForm(parseIssueForm(body), venues, "2026-11-02");
  assert.ok(typeof ev !== "string");
  assert.equal(ev.venueId, "southbank-centre");
});

test("explains unknown venues and bad dates", () => {
  assert.match(String(eventFromForm(parseIssueForm(BODY.replace("Southbank Centre", "Nowhere Hall")), venues, "2026-11-02")), /Couldn't match venue/);
  assert.match(String(eventFromForm(parseIssueForm(BODY.replace("21 November 2026", "soon")), venues, "2026-11-02")), /Couldn't read the dates/);
});
