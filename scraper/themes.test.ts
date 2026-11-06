import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TagsFile, Theme, Venue, WOEvent } from "../lib/types.ts";
import { compileThemes, guessEventThemes, guessPersonThemes, EMPTY_TAGS } from "../lib/themes.ts";
import { applyAnswers, check, formatTags, todo } from "./tagging.ts";
import { buildProfile, recommendEvents, recommendVenues, topThemes } from "../lib/profile.ts";
import { cleanDoc, mergeDocs } from "../lib/syncData.ts";

const themes = JSON.parse(readFileSync(new URL("../data/themes.json", import.meta.url), "utf8")) as Theme[];
const tags = JSON.parse(readFileSync(new URL("../data/tags.json", import.meta.url), "utf8")) as TagsFile;
const t = compileThemes(themes);
const ev = (o: Partial<WOEvent>): WOEvent => ({
  id: "v:x",
  venueId: "v",
  sourceId: "s",
  title: "Untitled",
  url: "https://example.org/x",
  type: "event",
  category: "art-events",
  startDate: "2026-11-10",
  endDate: null,
  firstSeen: "2026-11-01",
  ...o,
});

test("the theme list and the saved tags are valid", () => {
  assert.deepEqual(check(themes, tags), []);
  assert.ok(themes.length >= 40);
});

test("first guesses: the ticketing APIs' genres, then the title, the type, and the venue", () => {
  const g = (o: Partial<WOEvent>, venue: string[] = []) => guessEventThemes(ev(o), venue, t);
  assert.deepEqual(g({ genres: ["Music/Jazz"], type: "concert" }).themes, ["jazz"]);
  assert.deepEqual(g({ genres: ["Arts & Theatre/Theatre/Musical"], type: "show" }).themes, ["musicals"]);
  assert.deepEqual(g({ genres: ["Arts & Theatre/Comedy"], type: "show" }).themes, ["comedy"]);
  assert.deepEqual(g({ genres: ["Arts & Theatre/Theatre/Comedy"], type: "show" }).themes, ["plays"]); // a comic play isn't stand-up
  assert.equal(g({ genres: ["Music/Rock/Indie Rock"] }).from, "genres");
  assert.deepEqual(g({ title: "Hamlet", type: "show" }).themes, ["classics"]);
  assert.deepEqual(g({ title: "William Crozier: Dance of the Living", type: "exhibition" }, ["painting"]).themes, ["painting"]); // not dance
  assert.deepEqual(g({ title: "Family Space with Sadie", type: "family" }).themes, ["family"]); // "space" isn't science
  assert.deepEqual(g({ title: "In conversation: Zadie Smith", type: "talk" }).themes, ["talks"]);
  // Nothing about the subject: borrow the venue's themes that suit the event type.
  assert.deepEqual(g({ title: "Kevin Bridges", type: "show" }, ["comedy", "musicals"]).themes, ["comedy"]);
  assert.deepEqual(g({ title: "Night Songs", type: "concert" }, ["plays", "classical"]).themes, ["classical"]);
  assert.deepEqual(g({ title: "Late Medieval", type: "talk" }).themes, ["history", "talks"]); // not a museum late
  assert.deepEqual(g({ title: "Untitled", type: "exhibition" }, ["contemporary-art", "painting", "film"]).themes, ["contemporary-art", "painting"]);
  assert.equal(g({ title: "Untitled", type: "concert" }, ["plays"]).from, "none");
  assert.deepEqual(guessPersonThemes({ kind: "music", genres: ["Music/Hip-Hop/Rap"] }, t), ["hip-hop"]);
  assert.deepEqual(guessPersonThemes({ kind: "comedy" }, t), ["comedy"]);
});

test("the maintenance task's answers are checked before they're saved", () => {
  const u = {
    venues: [{ id: "tate-modern", name: "Tate Modern", kind: "public-gallery", area: "Bankside", website: "https://tate.org.uk" } as Venue],
    events: [ev({ id: "tate-modern:a", venueId: "tate-modern" }), ev({ id: "tate-modern:b", venueId: "tate-modern" })],
    people: [],
  };
  const old: TagsFile = { ...EMPTY_TAGS, events: { "gone:old": ["jazz"] } };
  const r = applyAnswers(
    ["# comment", "venue tate-modern contemporary-art,modern-art", "event tate-modern:a photography", "event tate-modern:b -", "event nope:x jazz", "event tate-modern:a made-up", "person nobody jazz"].join("\n"),
    old,
    themes,
    u,
  );
  assert.deepEqual(r.saved, { venue: 1, event: 2, person: 0 });
  assert.equal(r.rejected.length, 3);
  assert.deepEqual(r.tags.venues["tate-modern"], ["contemporary-art", "modern-art"]);
  assert.deepEqual(r.tags.events["tate-modern:b"], []); // "none fit" is remembered, so it isn't asked again
  assert.equal(r.tags.events["gone:old"], undefined); // pruned: that event has gone
  assert.match(formatTags(r.tags), /\n    "tate-modern:a": \["photography"\],\n/);
  // Tagged things drop out of the to-do list; untagged ones are listed.
  const left = todo({ ...u, today: "2026-11-06" }, r.tags, themes).lines;
  assert.deepEqual(left, []);
  assert.equal(todo({ ...u, today: "2026-11-06" }, EMPTY_TAGS, themes).lines.length, 3);
});

test("Discover: a profile from what you follow, save and pick, and what else matches it", () => {
  const venues = new Map([
    ["photo-gallery", ["photography", "contemporary-art"]],
    ["jazz-club", ["jazz"]],
  ]);
  const events = [
    ev({ id: "a:1", venueId: "photo-gallery", themes: ["photography"] }),
    ev({ id: "b:1", venueId: "other-gallery", themes: ["photography", "contemporary-art"] }),
    ev({ id: "b:2", venueId: "other-gallery", themes: ["photography"] }),
    ev({ id: "b:3", venueId: "other-gallery", themes: ["photography"] }),
    ev({ id: "c:1", venueId: "club", themes: ["jazz"] }),
    ev({ id: "d:1", venueId: "theatre", themes: ["musicals"] }),
    ev({ id: "e:1", venueId: "old", themes: ["photography"], startDate: "2026-01-01", endDate: "2026-02-01" }),
  ];
  const byId = new Map(events.map((e) => [e.id, e]));
  const p = buildProfile({ likes: ["jazz"], follows: ["photo-gallery"], saved: ["b:1"], people: [] }, (id) => venues.get(id), (id) => byId.get(id)?.themes, () => undefined);
  assert.deepEqual(new Set(topThemes(p, 2)), new Set(["photography", "jazz"]));
  const picks = recommendEvents(p, events, { today: "2026-11-06", follows: new Set(["photo-gallery"]), people: new Set(), saved: new Set(["b:1"]), perVenue: 1 });
  const ids = picks.map((x) => x.item.id);
  assert.ok(!ids.includes("a:1"), "not from places you already follow");
  assert.ok(!ids.includes("b:1"), "not what you already saved");
  assert.ok(!ids.includes("d:1"), "nothing that doesn't match");
  assert.ok(!ids.includes("e:1"), "nothing that's over");
  assert.equal(ids.filter((id) => id.startsWith("b:")).length, 1, "one per place");
  assert.equal(picks.find((x) => x.item.id === "c:1")?.reason, "jazz");
  const places = recommendVenues(p, [{ id: "jazz-club", name: "Jazz Club", area: "Soho", kind: "live-venue", website: "", coverage: "auto", themes: ["jazz"] }], { "jazz-club": 3 }, new Set());
  assert.equal(places[0]?.reason, "jazz");
  assert.deepEqual(recommendEvents(new Map(), events, { today: "2026-11-06", follows: new Set(), people: new Set(), saved: new Set() }), []);
});

test("themes you pick sync too", () => {
  const base = { updatedAt: "2026-11-06T10:00:00.000Z", follows: [], people: [], saved: [] };
  assert.deepEqual(cleanDoc({ ...base, likes: ["jazz"] })?.likes, ["jazz"]);
  assert.equal(cleanDoc({ ...base, likes: ["<x>"] }), null);
  assert.deepEqual(mergeDocs({ ...base, likes: ["jazz"] }, { ...base, likes: ["opera"] }, base.updatedAt).likes, ["jazz", "opera"]);
});
