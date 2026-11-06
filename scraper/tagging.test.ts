// Regression tests from the review of themes and tagging (each case was a real wrong guess).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EventType, Theme, Venue, WOEvent } from "../lib/types.ts";
import { compileThemes, genreThemes, guessEventThemes, isAct, EMPTY_TAGS } from "../lib/themes.ts";
import { todo } from "./tagging.ts";
import { notAnEvent } from "./classify.ts";

const themes = JSON.parse(readFileSync(new URL("../data/themes.json", import.meta.url), "utf8")) as Theme[];
const t = compileThemes(themes);
const guess = (title: string, type: EventType, venue: string[] = []) => guessEventThemes({ title, type }, venue, t).themes;

test("title words don't misfire", () => {
  assert.ok(!guess("Phantom Of The Opera", "show").includes("opera")); // a musical
  assert.ok(!guess("TINA - The Tina Turner Musical", "show").includes("old-masters"));
  assert.ok(!guess("Guildhall Big Band: Harlem Renaissance", "concert").includes("old-masters"));
  assert.ok(!guess("Natural History Prints", "exhibition").includes("history"));
  assert.ok(!guess("Georgian National Ballet ‘Sukhishvili’", "show").includes("history"));
  assert.ok(!guess("The Magic Numbers", "concert").includes("cabaret")); // a band
  assert.ok(!guess("Metamorphoses: The Swing", "event").includes("jazz")); // Fragonard's painting
  assert.ok(!guess("Spiritualized: Acoustic Mainlines", "show").includes("folk"));
  assert.ok(!guess("Film Writer/Director Ideas Lab", "event").includes("books"));
  assert.ok(!guess("Sleeping Beauty", "show").includes("ballet")); // panto season
  assert.ok(!guess("Ocean Of A Droplet", "show").includes("nature"));
  assert.ok(!guess("Late Medieval", "talk").includes("lates"));
  // …and still fire when they should
  assert.ok(guess("Paddington Opera Gala", "concert").includes("opera"));
  assert.ok(guess("Painting the French Riviera", "exhibition").includes("painting"));
  assert.ok(guess("A History of London: 1066–1666", "talk").includes("history"));
  assert.ok(guess("Skate at Somerset House", "event").includes("outdoors"));
  assert.ok(guess("The Simon & Garfunkel Story", "concert").includes("tributes"));
  assert.ok(guess("Allstars: The Music of ABBA", "concert").includes("tributes"));
  assert.ok(guess("Churchill’s Palate: A Talk and Tasting Event", "talk").includes("food-drink"));
});

test("a venue's themes are borrowed only where the venue is mainly that kind of place", () => {
  const unionChapel = ["folk", "rock", "comedy"];
  const barbican = ["contemporary-art", "classical", "film", "plays"];
  assert.deepEqual(guess("CARA DILLON ‘Upon A Winter’s Night’", "show", unionChapel), []); // a gig typed as a show isn't comedy
  assert.deepEqual(guess("Joan As Police Woman", "concert", unionChapel), ["folk"]);
  assert.deepEqual(guess("Ronnie Scott's 100th Birthday", "concert", barbican), []); // not classical
  assert.deepEqual(guess("Robert Ryman: The Real Thing", "exhibition", barbican), ["contemporary-art", "classical"].slice(0, 1));
  assert.deepEqual(guess("Kevin Bridges", "show", ["comedy", "musicals"]), ["comedy"]);
  assert.deepEqual(guess("Lantern trail", "event", ["nature", "outdoors"]), ["nature"]); // one kind of place ("And also" doesn't count)
  assert.deepEqual(guess("Dani Sylvia", "event", ["digital-art", "pop", "rock"]), []); // a mixed venue: can't tell
});

test("ticketing genres map sensibly", () => {
  assert.deepEqual(genreThemes(["Music/Religious/Gospel"], t), ["hip-hop"]); // gospel, not classical
  assert.deepEqual(genreThemes(["Music/Hip Hop"], t), ["hip-hop"]); // Skiddle spells it without the hyphen
  assert.deepEqual(genreThemes(["Music/Dance"], t), ["electronic"]);
  assert.deepEqual(genreThemes(["Music/Acoustic"], t), ["folk"]);
  assert.deepEqual(genreThemes(["Arts & Theatre/Spectacular"], t), []);
  // From the first real scrape with genres: Ticketmaster files most pop acts as Rock/Pop.
  assert.deepEqual(genreThemes(["Music/Rock/Pop"], t), ["rock", "pop"]);
  assert.deepEqual(genreThemes(["Arts & Theatre/Theatre/Podcast"], t), ["podcasts"]);
  assert.deepEqual(genreThemes(["Music/Covers Band/Tribute Act"], t), ["tributes"]);
  assert.deepEqual(genreThemes(["Music/Orchestral"], t), ["classical"]);
  assert.deepEqual(genreThemes(["Music/African"], t), ["global-music"]);
  assert.deepEqual(genreThemes(["Arts & Theatre/Performance Art/Drag"], t), ["cabaret"]);
  assert.deepEqual(genreThemes(["Music/UK Garage"], t), ["electronic"]);
  assert.deepEqual(genreThemes(["Music/Rock/Garage Rock"], t), ["rock"]);
  assert.deepEqual(genreThemes(["Arts & Theatre/Theatre/Mystery"], t), ["plays"]);
});

test("sport isn't listed", () => {
  for (const title of ["Haringey Huskies v Oxford Stars", "Paddy Power World Darts Championship 2026/2027", "Johnstone’s Paint Masters Snooker 2027"])
    assert.equal(notAnEvent({ title, url: "https://example.org/e" }), "sport", title);
  for (const title of ["Godzilla v Kong in Concert", "Kramer vs. Kramer", "The Good, The Bad & The Rugby Podcast", "Love v Hate: a comedy"])
    assert.equal(notAnEvent({ title, url: "https://example.org/e" }), null, title);
});

test("people: performers only", () => {
  assert.ok(isAct({ name: "Dylan Moran", kind: "comedy" }));
  for (const [name, kind] of [["A Christmas Carol", "theatre"], ["The Best in Stand Up", "comedy"], ["Big Belly Comedy Club", "comedy"], ["Old Rope Comedy Night", "comedy"], ["The Bon Jovi Tribute", "music"]] as const)
    assert.ok(!isAct({ name, kind }), name);
});

test("the to-tag list: venue themes as context, only real evidence as a guess, no productions or comedians", () => {
  const venue = { id: "union-chapel", name: "Union Chapel", kind: "live-venue", area: "Islington", website: "https://unionchapel.org.uk" } as Venue;
  const ev = (id: string, title: string, type: EventType, people?: string[]): WOEvent => ({ id, venueId: venue.id, sourceId: "s", title, url: "https://x.org/" + id, type, category: "shows", startDate: "2026-11-20", endDate: null, firstSeen: "2026-11-01", ...(people ? { people } : {}) });
  const tags = { ...EMPTY_TAGS, venues: { "union-chapel": ["folk", "rock", "comedy"] } };
  const people = [
    { id: "cara-dillon", name: "Cara Dillon", kind: "music" as const },
    { id: "a-christmas-carol", name: "A Christmas Carol", kind: "theatre" as const },
    { id: "tim-key", name: "Tim Key", kind: "comedy" as const },
  ];
  const { lines } = todo(
    { venues: [venue], events: [ev("u:1", "CARA DILLON", "show", ["cara-dillon", "a-christmas-carol", "tim-key"]), ev("u:2", "Christmas Carols by Candlelight", "concert")], people, today: "2026-11-06" },
    tags,
    themes,
  );
  const gig = lines.find((l) => l.includes("CARA DILLON"))!;
  assert.match(gig, /Union Chapel \(folk,rock,comedy\)/);
  assert.doesNotMatch(gig, /guess:/);
  assert.match(lines.find((l) => l.includes("Candlelight"))!, /guess: festive/);
  assert.deepEqual(lines.filter((l) => l.startsWith("person")).map((l) => l.split("\t")[1]), ["cara-dillon"]);
});
