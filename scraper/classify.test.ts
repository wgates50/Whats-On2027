// Type rules that aren't covered by a recorded venue page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyType, notAnEvent, typeEvidence } from "./classify.ts";

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

test("courses, schools sessions, season pages and online-only events aren't events to go to", () => {
  const no = (title: string, url = "https://example.org/event/x", typeLabel?: string) => notAnEvent({ title, url, typeLabel });
  assert.equal(no("A History of London: 1066–1666 (In-person)", undefined, "V&A Academy year course"), "course");
  assert.equal(no("Pearls", undefined, "V&A Academy online course"), "course");
  assert.equal(no("Foundation Astrophysics", "https://www.rmg.co.uk/whats-on/astronomy-courses/foundation-astrophysics"), "course");
  assert.equal(no("Life Drawing Short Course"), "course");
  assert.equal(no("Online CPD: Teaching Macbeth at Key Stage 4"), "course");
  assert.equal(no("Christmas 2026", undefined, "Season"), "season overview");
  assert.equal(no("Young V&A Schools: Design Takeover – KS3 (Autumn 2026)"), "for schools");
  assert.equal(no("V&A East Schools and Colleges: In-person workshops"), "for schools");
  assert.equal(no("I Am Roland Mouret (Livestream - Rescheduled)"), "online");
  assert.equal(no("ONLINE – Two Women: Book Launch with Jacqueline Rose"), "online");
  // …but not these
  for (const t of ["School of Rock", "Guildhall School: Autumn Opera Scenes", "Life Drawing at the Museum", "Love Online", "Of Course I Can"])
    assert.equal(no(t, `https://example.org/shows/${t.toLowerCase().replace(/\W+/g, "-")}`), null, t);
  assert.equal(no("Schiaparelli: Fashion Becomes Art", "https://www.vam.ac.uk/exhibitions/schiaparelli", "Exhibition"), null);
});

test("the V&A's drop-ins and open studios are events, not exhibitions", () => {
  const at = (title: string, typeLabel: string) => classifyType({ url: "https://www.vam.ac.uk/event/x/y", title, typeLabel, venueKind: "museum", spanDays: 90 });
  assert.equal(at("Play Saturdays (Sept-Dec 2026)", "Drop-in"), "event");
  assert.equal(at("Makers Club", "Open studio"), "event");
  assert.equal(at("Members' Preview Day: Constantinople to Istanbul", "V&A Membership exhibition view"), "event");
  assert.equal(at("Upstart presents: Creative Frequencies", "Conferences and study days"), "talk");
});

test("gig billing means a concert where the listing doesn't say; a label or 'stand-up' still wins", () => {
  for (const t of ["Actress + support", "The Avalanches + Logic1000 + very special guest", "OATHBREAKER with special guests", "Djrum: All Night Long", "HUNEE – Hunchin’ All Night", "Ben UFO (DJ set)", "Fat Dog plus support"])
    assert.equal(at(t, "live-venue"), "concert", t);
  assert.equal(at("Sam Campbell + special guests", "live-venue", "Comedy"), "show"); // the venue's label wins
  assert.equal(at("Stand-up night + special guests", "live-venue"), "show");
  assert.equal(at("upperground: DJ sets", "museum", "Drop-in"), "event"); // the V&A's DJ-set drop-ins
  assert.equal(at("Yuko Mohri: In Concert", "arts-centre", "Exhibition"), "exhibition"); // an exhibition's title
  assert.equal(at("Matt Mathews", "live-venue"), "show"); // nothing to go on: the kind of venue decides
  // A touring film festival is films, not a guided tour or a gig.
  assert.equal(at("Banff Mountain Film Festival World Tour - Red Film Programme - 9 March 27", "live-venue"), "screening");
});

test("a type is the listing's evidence only when the listing shows it, not a default", () => {
  const base = { url: "https://example.org/whats-on/x", venueKind: "live-venue" as const, oneOff: true };
  assert.equal(classifyType({ ...base, title: "Matt Mathews", sourceDefault: "concert" }), "concert");
  assert.equal(typeEvidence({ ...base, title: "Matt Mathews", sourceDefault: "concert" }), undefined);
  assert.equal(typeEvidence({ ...base, title: "Matt Mathews", schemaType: "ComedyEvent" }), "show");
  assert.equal(typeEvidence({ ...base, title: "The Muppet Christmas Carol in Concert" }), "concert");
  assert.equal(typeEvidence({ ...base, title: "Matt Mathews", typeLabel: "Comedy" }), "show");
});
