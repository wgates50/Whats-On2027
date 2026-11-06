import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TagsFile, Theme, Venue, WOEvent } from "../lib/types.ts";
import { compileThemes, guessEventThemes, guessPersonThemes, EMPTY_TAGS } from "../lib/themes.ts";
import { applyAnswers, check, formatTags, todo } from "./tagging.ts";
import { buildProfile, recommendEvents, recommendPeople, recommendVenues, whyText } from "../lib/profile.ts";
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

test("Discover: a profile from what you follow, save and pick, and picks spread across it", () => {
  const venue = (id: string, kind: string, themes: string[]) => ({ id, name: id, area: "", kind, website: "", coverage: "auto", themes }) as never;
  const venues = new Map<string, ReturnType<typeof venue>>([
    ["tate", venue("tate", "public-gallery", ["contemporary-art", "modern-art"])],
    ["design-museum", venue("design-museum", "museum", ["design", "architecture"])],
    ["o2", venue("o2", "live-venue", ["pop", "rock", "comedy"])],
    ["kids-museum", venue("kids-museum", "museum", ["family", "design"])],
    ["gallery-a", venue("gallery-a", "public-gallery", ["contemporary-art"])],
    ["gallery-b", venue("gallery-b", "public-gallery", ["contemporary-art"])],
    ["home", venue("home", "museum", ["design", "history"])],
  ]);
  const events = [
    ev({ id: "s:1", venueId: "tate", type: "exhibition", themes: ["fashion", "design"], title: "The 90s: Art and Fashion" }),
    ev({ id: "a:1", venueId: "gallery-a", type: "exhibition", themes: ["contemporary-art"] }),
    ev({ id: "a:2", venueId: "gallery-a", type: "exhibition", themes: ["contemporary-art"] }),
    ev({ id: "b:1", venueId: "gallery-b", type: "exhibition", themes: ["contemporary-art"], themesFrom: "venue" }),
    ev({ id: "h:1", venueId: "home", type: "exhibition", themes: ["design", "history"] }),
    ev({ id: "h:2", venueId: "home", type: "workshop", themes: ["design"] }),
    ev({ id: "k:1", venueId: "kids-museum", type: "exhibition", themes: ["design"] }),
    ev({ id: "t:1", venueId: "tate", type: "exhibition", themes: ["contemporary-art"] }),
    ev({ id: "x:1", venueId: "theatre", type: "show", themes: ["musicals"] }),
    ev({ id: "old:1", venueId: "gallery-a", type: "exhibition", themes: ["contemporary-art"], startDate: "2026-01-01", endDate: "2026-02-01" }),
  ];
  const byId = new Map(events.map((e) => [e.id, e]));
  const p = buildProfile(
    { likes: [], follows: ["tate", "design-museum", "o2"], saved: ["s:1"], people: [] },
    { venue: (id) => venues.get(id), event: (id) => byId.get(id), person: () => undefined },
  );
  // A saved exhibition outweighs following a big venue that does a bit of everything.
  assert.ok(p.themes.get("fashion")! > p.themes.get("rock")!);
  const picks = recommendEvents(p, events, { today: "2026-11-06", follows: new Set(["tate", "design-museum", "o2"]), people: new Set(), saved: new Set(["s:1"]), venue: (id) => venues.get(id) });
  const ids = picks.map((x) => x.item.id);
  assert.ok(!ids.includes("t:1"), "not from places you already follow");
  assert.ok(!ids.includes("x:1") && !ids.includes("old:1"), "nothing that doesn't match, or that's over");
  assert.ok(!ids.includes("k:1"), "nothing for children unless families are your thing");
  assert.ok(new Set(picks.map((x) => x.why.theme)).size >= 2, "spread across your interests, not just the strongest");
  const three = recommendEvents(p, events, { today: "2026-11-06", follows: new Set(["tate", "design-museum", "o2"]), people: new Set(), saved: new Set(["s:1"]), venue: (id) => venues.get(id), limit: 3 });
  assert.equal(three.filter((x) => x.item.venueId === "gallery-a").length, 1, "one per place while there's other choice");
  assert.ok(ids.indexOf("h:1") < ids.indexOf("h:2") || !ids.includes("h:2"), "the kind of thing you go to (exhibitions) first");
  assert.ok(ids.indexOf("a:1") < ids.indexOf("b:1") || !ids.includes("b:1"), "themes we're sure of beat ones borrowed from the venue");
  const label = (t: string) => ({ design: "Design", "contemporary-art": "Contemporary art" })[t];
  const h = picks.find((x) => x.item.id === "h:1")!;
  assert.equal(whyText(h.why, label), "Because you saved The 90s: Art and Fashion"); // the most similar thing of yours
  const a = picks.find((x) => x.item.id.startsWith("a:"))!;
  assert.equal(whyText(a.why, label), "Because you follow tate");
  assert.equal(whyText({ theme: "design", source: { kind: "liked" } }, label), "Because you like Design");
  // Places: one per interest; people: acts, not shows or club nights.
  const places = recommendVenues(p, [...venues.values()] as never, { home: 2, "gallery-a": 2 }, new Set(["tate", "design-museum", "o2"]));
  assert.deepEqual(new Set(places.map((x) => x.why.theme)).size, places.length);
  const person = (id: string, name: string, kind: string) => ({ id, name, kind, themes: ["comedy"] }) as never;
  const acts = recommendPeople(p, [person("a", "A Christmas Carol", "theatre"), person("b", "The Best in Stand Up", "comedy"), person("c", "Dylan Moran", "comedy")], new Map([["a", 5], ["b", 40], ["c", 2]]), new Set());
  assert.deepEqual(acts.map((x) => x.item.name), ["Dylan Moran"]);
  assert.deepEqual(recommendEvents(buildProfile({ likes: [], follows: [], saved: [], people: [] }, { venue: () => undefined, event: () => undefined, person: () => undefined }), events, { today: "2026-11-06", follows: new Set(), people: new Set(), saved: new Set(), venue: () => undefined }), []);
});

test("themes you pick sync too", () => {
  const base = { updatedAt: "2026-11-06T10:00:00.000Z", follows: [], people: [], saved: [] };
  assert.deepEqual(cleanDoc({ ...base, likes: ["jazz"] })?.likes, ["jazz"]);
  assert.equal(cleanDoc({ ...base, likes: ["<x>"] }), null);
  assert.deepEqual(mergeDocs({ ...base, likes: ["jazz"] }, { ...base, likes: ["opera"] }, base.updatedAt).likes, ["jazz", "opera"]);
});
