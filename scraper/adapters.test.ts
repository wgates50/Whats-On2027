// Replays every recorded fixture (no network) and checks the adapter still produces exactly the
// recorded events. If you intentionally change a source's config, re-record it:
//   npm run fixture -- <sourceId>
// If you change classification/venue rules, recompute expectations from stored pages:
//   npm run fixture -- --rebaseline --all

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, produce, type Expected } from "./fixture.ts";
import { loadSources } from "./config.ts";

const dirs = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((d) => existsSync(join(FIXTURES, d, "expected.json"))) : [];
const sources = loadSources();

for (const id of dirs) {
  test(`fixture: ${id}`, async () => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, id, "expected.json"), "utf8")) as Expected;
    const source = sources.find((s) => s.id === id);
    assert.ok(source, `Fixture "${id}" has no matching source in data/sources.json — delete scraper/fixtures/${id}/ or restore the source`);
    assert.deepEqual(
      source.adapter,
      expected.adapter,
      `Source "${id}" config changed since its fixture was recorded — run \`npm run fixture -- ${id}\``,
    );
    const { rep, res } = await produce(id, "replay", expected.recordedAt, expected.limits);
    assert.ok(res.events.length > 0, "adapter extracts nothing from the recorded pages");
    if (expected.rawCount !== undefined) assert.equal(res.events.length, expected.rawCount, "number of extracted items changed");
    assert.deepEqual(rep.events, expected.events);
  });
}

test("every enabled source has a fixture", () => {
  // API sources (custom adapters needing keys) are covered by scraper/apis.test.ts instead.
  const missing = sources.filter((s) => s.enabled && s.adapter.type !== "custom" && !dirs.includes(s.id)).map((s) => s.id);
  assert.deepEqual(missing, [], `Record fixtures with: npm run fixture -- ${missing.join(" ")}`);
});
