// Type rules that aren't covered by a recorded venue page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyType } from "./classify.ts";

const at = (title: string, venueKind: Parameters<typeof classifyType>[0]["venueKind"], typeLabel?: string) =>
  classifyType({ url: "https://example.org/whats-on/x", title, typeLabel, venueKind, oneOff: true });

test("a touring act's 'World Tour' isn't a guided tour; real guided tours still are", () => {
  // Touring acts → whatever the label/venue says.
  assert.equal(at("The Kid LAROI - A Perfect World Tour", "live-venue"), "show");
  assert.equal(at("Tony Hadley - The Christmas Big Band Tour 2026", "theatre", "Music"), "concert");
  assert.equal(at("THE SLOW SHOW: WHITE WATER ANNIVERSARY LIVE TOUR", "concert-hall", "Gig"), "concert");
  assert.equal(at("GothamChess: The GothamChess Europe Tour 2026", "theatre", "Comedy"), "show");
  assert.equal(at("Mikel Erentxun – Duncan Dhu Tour 2026", "live-venue"), "show");
  // Guided tours.
  for (const t of ["Globe Theatre Guided Tour", "Behind the Scenes Tour", "History Tours", "Tea and Tour", "Union Chapel Guided Tour | December 2026", "Curator Tour: 2026 Acquisitions"])
    assert.equal(at(t, "theatre"), "tour", t);
  assert.equal(at("Exhibition tour", "museum"), "tour");
});
